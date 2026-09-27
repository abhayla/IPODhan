/**
 * Tier A review round 1 (MAJOR-2), PR #1231: OD-130 is the first path that
 * can leave TWO rows with the same name legitimately live at once
 * (`<slug>` and `<slug>-<open-year>`, both created by that same PR). Before
 * this fix, `IPORepository.findByNormalizedName` ran `.where(nameCondition)
 * .limit(1)` with no ORDER BY on the un-filtered path, so a later CIN-less
 * record could bind to WHICHEVER of the two rows Postgres happened to
 * return first — silently writing one company's scraped data onto the
 * other's row. `resolveIpoRow`'s Tier 3 (the exact/compact-whitespace name
 * match) calls `findByNormalizedName` directly, so the identity resolver
 * inherited the same risk.
 *
 * Fix: `findByNormalizedName` now fetches up to 2 matches with a
 * deterministic ORDER BY on every path, and HOLDS (throws
 * `IdentityHeldForReviewError`, recorded in `audit_logs` as
 * `IDENTITY_HELD_FOR_REVIEW`) instead of picking one, whenever more than one
 * row matches. `resolveIpoRow` does not catch this — it propagates exactly
 * like the module's existing OD-85 held-error paths, so no arbitrary bind
 * ever reaches a caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';
import { resolveIpoRow, type IpoIdentity } from './ipo-identity';
import { IdentityHeldForReviewError } from '../errors/repository-errors';
import { ipos, auditLogs } from '../db/schema';

type Row = Record<string, unknown>;

/**
 * A chainable drizzle-shaped mock (`.select().from().where().orderBy()
 * .limit()`), matching the pattern in `ipo-repository-prefix.test.ts`, plus
 * an `insert` so `recordIdentityHold`'s audit_logs write can be observed.
 */
function makeDb(matches: Row[]) {
  const auditInserts: Row[] = [];
  const select = vi.fn(() => {
    let fromIpos = false;
    const chain: any = {
      from: (table: unknown) => {
        fromIpos = table === ipos;
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      // `recordIdentityHold`'s own dedup-check query selects FROM auditLogs
      // (never ipos) — it must see "no prior hold" ([]), not this test's
      // ipos matches, or the dedup guard would wrongly think a hold was
      // already recorded and skip the insert this test is asserting on.
      limit: () => Promise.resolve(fromIpos ? matches : []),
    };
    return chain;
  });
  const insert = vi.fn((table: unknown) => ({
    values: (v: Row) => {
      if (table === auditLogs) auditInserts.push(v);
      return Promise.resolve(undefined);
    },
  }));
  return { db: { select, insert } as unknown as ConstructorParameters<typeof IPORepository>[0], auditInserts };
}

function makeRepo(matches: Row[]) {
  const { db, auditInserts } = makeDb(matches);
  const redis = { get: vi.fn(), setex: vi.fn(), del: vi.fn(), keys: vi.fn().mockResolvedValue([]) };
  return { repo: new IPORepository(db, redis as unknown as ConstructorParameters<typeof IPORepository>[1]), auditInserts };
}

const BASE_ROW = {
  id: 'acme-base', slug: 'acme-industries-ltd', companyName: 'Acme Industries Ltd',
  openDate: '2027-06-15', priceRangeMin: 100, status: 'UPCOMING',
};
const YEAR_ROW = {
  id: 'acme-2027', slug: 'acme-industries-ltd-2027', companyName: 'Acme Industries Ltd',
  openDate: '2027-09-01', priceRangeMin: 120, status: 'UPCOMING',
};

describe('IPORepository.findByNormalizedName: more than one match is HELD, never picked at random (MAJOR-2)', () => {
  it('(failing-first) two same-name rows (base slug + OD-130 <slug>-<year>) -> throws IdentityHeldForReviewError, records IDENTITY_HELD_FOR_REVIEW, picks NEITHER', async () => {
    const { repo, auditInserts } = makeRepo([BASE_ROW, YEAR_ROW]);
    const err = await repo.findByNormalizedName('acme industries').catch((e) => e);

    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    const held = err as IdentityHeldForReviewError;
    expect(held.candidates.map((c) => c.id).sort()).toEqual(['acme-2027', 'acme-base'].sort());
    // never silently resolved to either row
    expect(held.candidates).not.toContainEqual(expect.objectContaining({ id: undefined }));

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ actionType: 'IDENTITY_HELD_FOR_REVIEW' });
  });

  it('exactly one match still returns that row normally (unchanged behavior)', async () => {
    const { repo } = makeRepo([BASE_ROW]);
    const ipo = await repo.findByNormalizedName('acme industries');
    expect(ipo).toEqual(BASE_ROW);
  });

  it('zero matches returns null (unchanged behavior)', async () => {
    const { repo } = makeRepo([]);
    const ipo = await repo.findByNormalizedName('nobody-home');
    expect(ipo).toBeNull();
  });
});

describe('resolveIpoRow: an ambiguous Tier 3 name match is never silently bound (MAJOR-2)', () => {
  const cinLessIncoming: IpoIdentity = {
    // The exact scenario named in the review: a CIN-less incoming record
    // whose only signal is the name, against two real same-name rows.
    companyName: 'Acme Industries Ltd',
    normalizedName: 'acme industries',
    slug: 'acme-industries-ltd',
    cin: null,
  };

  function identityRepo(findByNormalizedNameImpl: () => Promise<never>) {
    return {
      findByIsin: vi.fn().mockResolvedValue(null),
      findBySymbol: vi.fn().mockResolvedValue(null),
      findByNormalizedName: vi.fn().mockImplementation(findByNormalizedNameImpl),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
      findBySlug: vi.fn().mockResolvedValue(null),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
    } as unknown as IPORepository;
  }

  it('(failing-first) a CIN-less record against two same-name rows -> resolveIpoRow propagates the HOLD, never returns either row', async () => {
    const heldError = new IdentityHeldForReviewError(
      'held: ambiguous normalized-name match',
      { companyName: 'acme industries', slug: 'acme industries', openDate: null, priceRangeMin: null },
      [
        { id: 'acme-base', slug: 'acme-industries-ltd', companyName: 'Acme Industries Ltd', openDate: '2027-06-15', priceRangeMin: 100, status: 'UPCOMING' },
        { id: 'acme-2027', slug: 'acme-industries-ltd-2027', companyName: 'Acme Industries Ltd', openDate: '2027-09-01', priceRangeMin: 120, status: 'UPCOMING' },
      ]
    );
    const repo = identityRepo(() => Promise.reject(heldError));

    const result = await resolveIpoRow(repo, cinLessIncoming).catch((e) => e);
    expect(result).toBeInstanceOf(IdentityHeldForReviewError);
    expect((result as IdentityHeldForReviewError).candidates).toHaveLength(2);
  });
});
