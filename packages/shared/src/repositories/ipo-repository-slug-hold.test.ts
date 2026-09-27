/**
 * #928 (OD-69 / OD-71 / OD-35 class, #903): a record `resolveIpoRow` declined to
 * bind (CIN differs, slug holder WITHDRAWN, another segment, beyond 180 days)
 * reached `IPORepository.create()` with the slug an existing row already holds.
 * Before contract 1 (#1123) the insert failed on `ipos.slug`'s unique constraint
 * on every cycle, wrapped as a DatabaseError: no row, no audit_logs record,
 * nothing for the nightly `i_identity_held` check to read.
 *
 * OD-130 (2026-09-27, docs/design/data-sourcing-pull-model.md §0.0.1): three of
 * those declines (OD-69 CIN differs, OD-70 offering type differs, OD-71
 * WITHDRAWN holder) are a spec-stated NEW ROW, not an ambiguous one, so the
 * create now MINTS `<slug>-<open-year>` (then `<slug>-<open-year>-<segment>`)
 * and proceeds, instead of holding forever. The remaining declines (the OD-68
 * catch-all, OD-35) are still a durable hold (OD-68 "held for review instead of
 * creating a second row"; OD-85 read rule 3 "a failed check writes nothing and
 * holds the record").
 *
 * Drives the real `create()` against a stub db. The stub's ipos INSERT rejects the
 * way Postgres does on a taken slug, so a create that reaches it with a still-taken
 * slug is a DatabaseError.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository, slugTakenReason, deriveSeparateOfferingSlugCandidates, SEPARATE_OFFERING_SLUG_RULES } from './ipo-repository';
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

describe('OD-130: a genuinely separate offering (OD-69/OD-70/OD-71) gets a minted slug, not a hold', () => {
  it('(a) OD-69: same name + slug, DIFFERENT CIN, a known open date -> creates under <slug>-<open-year>, no hold', async () => {
    const { repo, auditInserts, iposInserts, iposQueries } = makeRepo([RAYS_ROW]);
    const created = await repo.create({
      companyName: 'Rays of Belief Limited',
      slug: 'rays-of-belief-ltd',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      status: 'LISTED',
      openDate: '2026-09-01',
      priceRangeMin: '227',
      cin: IC_ELECTRICALS_CIN,
    } as never);

    expect(created.id).toBe('new-row');
    expect(iposInserts).toHaveLength(1);
    expect(iposInserts[0].slug).toBe('rays-of-belief-ltd-2026');
    // both the original-slug lookup and the minted-candidate lookup ran
    expect(iposQueries).toContainEqual({ sql: '"ipos"."slug" = $1', params: ['rays-of-belief-ltd'] });
    expect(iposQueries).toContainEqual({ sql: '"ipos"."slug" = $1', params: ['rays-of-belief-ltd-2026'] });
    // (c) the first row's slug never changes: only ONE ipos insert happened, and
    // it is not an update of the holder row.
    expect(iposInserts.every((v) => v.slug !== RAYS_ROW.slug)).toBe(true);
    // recorded for transparency, not as a hold
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      actionType: 'IDENTITY_SEPARATE_OFFERING_CREATED',
      oldValue: 'rays-of-belief-ltd',
      newValue: 'rays-of-belief-ltd-2026',
      success: true,
    });
    expect((auditInserts[0].details as { rule: string }).rule).toBe('OD-69');
  });

  it('(b) both <slug>-<year> and the base slug are taken -> falls to <slug>-<open-year>-<segment>', async () => {
    const yearTaken = { ...RAYS_ROW, id: 'rays-2026', slug: 'rays-of-belief-ltd-2026' };
    const { repo, iposInserts } = makeRepo([RAYS_ROW, yearTaken]);
    const created = await repo.create({
      companyName: 'Rays of Belief Limited',
      slug: 'rays-of-belief-ltd',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      status: 'LISTED',
      openDate: '2026-09-01',
      priceRangeMin: '227',
      cin: IC_ELECTRICALS_CIN,
    } as never);

    expect(created.id).toBe('new-row');
    expect(iposInserts).toHaveLength(1);
    expect(iposInserts[0].slug).toBe('rays-of-belief-ltd-2026-mainboard');
  });

  it('OD-70: offering type differs, a known open date -> minted, not held', async () => {
    const rightsHolder = { ...RAYS_ROW, offeringType: 'IPO', cin: null };
    const { repo, iposInserts } = makeRepo([rightsHolder]);
    const created = await repo.create({
      companyName: 'Rays of Belief Limited',
      slug: 'rays-of-belief-ltd',
      segment: 'MAINBOARD',
      offeringType: 'RIGHTS',
      status: 'UPCOMING',
      openDate: '2026-09-01',
    } as never);
    expect(created.id).toBe('new-row');
    expect(iposInserts[0].slug).toBe('rays-of-belief-ltd-2026');
  });

  it('OD-71: the slug holder is WITHDRAWN, incoming record has a known open date -> minted, not held', async () => {
    const withdrawn = {
      id: 'poly-2023', slug: 'polymatech-electronics-ltd', companyName: 'Polymatech Electronics Ltd',
      openDate: null, priceRangeMin: null, status: 'WITHDRAWN', segment: 'MAINBOARD', offeringType: 'IPO', cin: null,
    };
    const { repo, iposInserts, auditInserts } = makeRepo([withdrawn]);
    const created = await repo.create({
      companyName: 'Polymatech Electronics Ltd', slug: 'polymatech-electronics-ltd', segment: 'MAINBOARD',
      offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-06-30',
    } as never);
    expect(created.id).toBe('new-row');
    expect(iposInserts[0].slug).toBe('polymatech-electronics-ltd-2026');
    expect(auditInserts[0]).toMatchObject({ actionType: 'IDENTITY_SEPARATE_OFFERING_CREATED' });
  });

  it('OD-71: the slug holder is WITHDRAWN but NEITHER record carries an open date -> still HELD (no year to mint)', async () => {
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

  it('a slug nobody holds is created normally (the guard never holds or mints for a free slug)', async () => {
    const { repo, auditInserts, iposInserts } = makeRepo([RAYS_ROW]);
    const created = await repo.create({
      companyName: 'Himalaya Nutravedics India Limited', slug: 'himalaya-nutravedics-india-limited',
      segment: 'SME', offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-09-22',
    } as never);
    expect(created.id).toBe('new-row');
    expect(iposInserts).toHaveLength(1);
    expect(auditInserts).toHaveLength(0);
  });

  it('(e) an admin override releasing a held case mints a slug too, instead of failing on the unique constraint', async () => {
    const { repo, iposInserts, auditInserts } = makeRepo([RAYS_ROW]);
    const created = await repo.create(
      { companyName: 'Rays of Belief Limited', slug: 'rays-of-belief-ltd', segment: 'MAINBOARD', offeringType: 'IPO', openDate: '2026-09-01', cin: IC_ELECTRICALS_CIN } as never,
      { identityHoldOverride: { by: 'admin@test', reason: 'checked MCA: different company' } }
    );
    expect(created.id).toBe('new-row');
    expect(iposInserts).toHaveLength(1);
    expect(iposInserts[0].slug).toBe('rays-of-belief-ltd-2026');
    expect(auditInserts.map((a) => a.actionType)).toContain('IDENTITY_HOLD_OVERRIDDEN');
  });

  it('an admin override with NO computable year and a still-taken slug throws a clear error, not a raw DatabaseError', async () => {
    const { repo } = makeRepo([RAYS_ROW]);
    const err = await repo
      .create(
        { companyName: 'Rays of Belief Limited', slug: 'rays-of-belief-ltd', segment: 'MAINBOARD', offeringType: 'IPO', cin: IC_ELECTRICALS_CIN } as never,
        { identityHoldOverride: { by: 'admin@test', reason: 'checked MCA: different company' } }
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/OD-130/);
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

  it('OD-130 mints for exactly OD-69/OD-70/OD-71, never OD-68 or OD-35', () => {
    expect(SEPARATE_OFFERING_SLUG_RULES.has('OD-69')).toBe(true);
    expect(SEPARATE_OFFERING_SLUG_RULES.has('OD-70')).toBe(true);
    expect(SEPARATE_OFFERING_SLUG_RULES.has('OD-71')).toBe(true);
    expect(SEPARATE_OFFERING_SLUG_RULES.has('OD-68')).toBe(false);
    expect(SEPARATE_OFFERING_SLUG_RULES.has('OD-35')).toBe(false);
  });
});

describe('deriveSeparateOfferingSlugCandidates (OD-130)', () => {
  it('(a) yields <slug>-<open-year> first', () => {
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', '2027-06-15', 'MAINBOARD')).toEqual([
      'acme-industries-ltd-2027',
      'acme-industries-ltd-2027-mainboard',
    ]);
  });

  it('(b) the segment candidate is lower-cased', () => {
    const candidates = deriveSeparateOfferingSlugCandidates('acme-industries-ltd', '2027-06-15', 'SME');
    expect(candidates).toEqual(['acme-industries-ltd-2027', 'acme-industries-ltd-2027-sme']);
  });

  it('returns null with no open date - nothing to mint from, the caller falls back to a hold', () => {
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', null, 'MAINBOARD')).toBeNull();
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', undefined, 'MAINBOARD')).toBeNull();
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', '', 'MAINBOARD')).toBeNull();
  });

  it('omits the segment candidate with no known segment', () => {
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', '2027-06-15', null)).toEqual([
      'acme-industries-ltd-2027',
    ]);
  });

  it('reads the year from a Date object the same way as a date string', () => {
    expect(deriveSeparateOfferingSlugCandidates('acme-industries-ltd', new Date('2027-01-05T00:00:00.000Z'), 'SME')).toEqual([
      'acme-industries-ltd-2027',
      'acme-industries-ltd-2027-sme',
    ]);
  });
});
