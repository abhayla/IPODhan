/**
 * #928 (OD-69 / OD-71 / OD-35 class, #903): a record `resolveIpoRow` declined to
 * bind (CIN differs, slug holder WITHDRAWN, another segment, beyond 180 days)
 * reached `IPORepository.create()` with the slug an existing row already holds.
 * Before this fix the insert failed on `ipos.slug`'s unique constraint on every
 * cycle, wrapped as a DatabaseError: no row, no audit_logs record, nothing for
 * the nightly `i_identity_held` check to read. The class is now a durable hold
 * (OD-68 "held for review instead of creating a second row"; OD-85 read rule 3
 * "a failed check writes nothing and holds the record").
 *
 * Drives the real `create()` against a stub db. The stub's ipos INSERT rejects the
 * way Postgres does on a taken slug, so a create that reaches it is a DatabaseError.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository, slugTakenReason } from './ipo-repository';
import { IdentityHeldForReviewError, DatabaseError } from '../errors/repository-errors';
import { ipos, auditLogs } from '../db/schema';
import { PgDialect } from 'drizzle-orm/pg-core';

// Real identities. Rays of Belief's CIN is the one seeded from prod in
// identity-matching-od68.integration.test.ts; IC Electricals' CIN is quoted in OD-83.
const RAYS_CIN = 'U85110DL2017PLC322623';
const IC_ELECTRICALS_CIN = 'U31909DL2005PLC139412';

type Row = Record<string, unknown>;

function stubDb(iposRows: Row[]) {
  const auditInserts: Row[] = [];
  const iposInserts: Row[] = [];
  // The stub HONOURS a single-column equality: `where(eq(ipos.<col>, v))` is rendered to
  // SQL and only rows whose <col> equals v come back (review round 1: a stub returning every
  // row let `eq(ipos.id, data.slug)` pass). Any other condition (the OD-68 fold query) gets
  // every row, and every rendered ipos query is recorded for assertion.
  const iposQueries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const camel = (col: string) => col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const select = vi.fn().mockImplementation(() => ({
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        let rows: Row[] = [];
        if (table === ipos) {
          const q = dialect.sqlToQuery(cond as never);
          iposQueries.push({ sql: q.sql, params: q.params });
          const m = /^"ipos"\."(\w+)" = \$1$/.exec(q.sql);
          rows = m ? iposRows.filter((r) => r[camel(m[1])] === q.params[0]) : iposRows;
        }
        return Object.assign(Promise.resolve(rows), { limit: async () => [] });
      },
    }),
  }));
  const insert = vi.fn().mockImplementation((table: unknown) => ({
    values: (v: Row) => {
      if (table === auditLogs) {
        auditInserts.push(v);
        return Promise.resolve(undefined);
      }
      iposInserts.push(v);
      const taken = iposRows.some((r) => r.slug === v.slug);
      return {
        returning: taken
          ? vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint "ipos_slug_unique"'), { code: '23505', constraint: 'ipos_slug_unique' }))
          : vi.fn().mockResolvedValue([{ id: 'new-row', ...v }]),
      };
    },
  }));
  return { db: { select, insert } as unknown as ConstructorParameters<typeof IPORepository>[0], auditInserts, iposInserts, iposQueries };
}

function makeRepo(iposRows: Row[]) {
  const s = stubDb(iposRows);
  const redis = { get: vi.fn(), setex: vi.fn(), del: vi.fn(), keys: vi.fn().mockResolvedValue([]) };
  return { repo: new IPORepository(s.db, redis as unknown as ConstructorParameters<typeof IPORepository>[1]), ...s };
}

const RAYS_ROW = {
  id: 'rays-row',
  slug: 'rays-of-belief-ltd',
  companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
  openDate: '2026-09-01',
  priceRangeMin: 227,
  status: 'LISTED',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  cin: RAYS_CIN,
};

describe('#928: a declined bind whose slug is taken is HELD, never a silent unique-constraint failure', () => {
  it('OD-69: same name + slug, DIFFERENT CIN -> IdentityHeldForReviewError, no ipos insert, one audit_logs hold naming the CIN', async () => {
    const { repo, auditInserts, iposInserts, iposQueries } = makeRepo([RAYS_ROW]);
    const err = await repo
      .create({
        companyName: 'Rays of Belief Limited',
        slug: 'rays-of-belief-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'LISTED',
        openDate: '2026-09-01',
        priceRangeMin: '227',
        cin: IC_ELECTRICALS_CIN,
      } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect(iposQueries).toContainEqual({ sql: '"ipos"."slug" = $1', params: ['rays-of-belief-ltd'] });
    expect((err as IdentityHeldForReviewError).candidates.map((c) => c.slug)).toEqual(['rays-of-belief-ltd']);
    expect(iposInserts).toHaveLength(0);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      actionType: 'IDENTITY_HELD_FOR_REVIEW',
      ipoId: 'rays-row',
      newValue: 'rays-of-belief-ltd',
      oldValue: 'rays-of-belief-ltd',
      success: false,
    });
    const details = auditInserts[0].details as { rule: string; reason: string };
    expect(details.reason).toBe(`slug_taken: CIN differs (${IC_ELECTRICALS_CIN} vs ${RAYS_CIN})`);
    expect(details.rule).toBe('OD-69');
  });

  it('OD-71: the slug holder is WITHDRAWN (Polymatech refile shape) -> held with the WITHDRAWN reason, not a DatabaseError', async () => {
    const withdrawn = {
      id: 'poly-2023', slug: 'polymatech-electronics-ltd', companyName: 'Polymatech Electronics Ltd',
      openDate: null, priceRangeMin: null, status: 'WITHDRAWN', segment: 'MAINBOARD', offeringType: 'IPO', cin: null,
    };
    const { repo, auditInserts, iposInserts } = makeRepo([withdrawn]);
    const err = await repo
      .create({ companyName: 'Polymatech Electronics Ltd', slug: 'polymatech-electronics-ltd', segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING' } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect(iposInserts).toHaveLength(0);
    expect((auditInserts[0].details as { reason: string; rule: string })).toMatchObject({
      rule: 'OD-71',
      reason: 'slug_taken: the slug holder is WITHDRAWN (a refiling is a new offering)',
    });
  });

  it('a slug nobody holds is created normally (the guard never holds a free slug)', async () => {
    const { repo, auditInserts, iposInserts } = makeRepo([RAYS_ROW]);
    const created = await repo.create({
      companyName: 'Himalaya Nutravedics India Limited', slug: 'himalaya-nutravedics-india-limited',
      segment: 'SME', offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-09-22',
    } as never);
    expect(created.id).toBe('new-row');
    expect(iposInserts).toHaveLength(1);
    expect(auditInserts).toHaveLength(0);
  });

  it('an admin override does NOT go through the slug hold (a human decided; the insert runs)', async () => {
    const { repo, iposInserts } = makeRepo([RAYS_ROW]);
    const err = await repo
      .create(
        { companyName: 'Rays of Belief Limited', slug: 'rays-of-belief-ltd', segment: 'MAINBOARD', offeringType: 'IPO', cin: IC_ELECTRICALS_CIN } as never,
        { identityHoldOverride: { by: 'admin@test', reason: 'checked MCA: different company' } }
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect(iposInserts).toHaveLength(1);
  });
});

describe('slugTakenReason names the rule that refused the bind', () => {
  it.each([
    [{ segment: 'MAINBOARD' }, { segment: 'SME', status: 'UPCOMING' }, 'OD-68', 'slug_taken: segment differs (MAINBOARD vs SME)'],
    [{ offeringType: 'RIGHTS' }, { offeringType: 'IPO' }, 'OD-70', 'slug_taken: offering type differs (RIGHTS vs IPO)'],
    [{ openDate: '2026-09-01' }, { openDate: '2025-12-01' }, 'OD-35', 'slug_taken: open date beyond 180 days (2026-09-01 vs 2025-12-01)'],
    [{ openDate: '2026-09-01' }, { openDate: '2026-08-01' }, 'OD-68', 'slug_taken: identity resolution did not bind the row holding this slug'],
    [{ cin: RAYS_CIN }, { cin: RAYS_CIN, status: 'WITHDRAWN' }, 'OD-71', 'slug_taken: the slug holder is WITHDRAWN (a refiling is a new offering)'],
  ])('%j vs %j -> %s', (incoming, holder, rule, reason) => {
    expect(slugTakenReason(incoming as never, holder as never)).toEqual({ rule, reason });
  });
});
