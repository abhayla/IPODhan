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
import { logger } from '../logger';

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

/**
 * #1235: the hold used to fire BEFORE the resolver narrowed by segment / offering type and even
 * when an ISIN or symbol had already bound the record. Class: any same-name pair the record can
 * tell apart (SME + MAINBOARD, IPO + OFS) or an identifier binds. Detectors fail closed: with no
 * separating signal the pair is still HELD.
 */
describe('#1235: same-name hold runs AFTER narrowing, and only holds what is still ambiguous', () => {
  const SME_ROW = { ...BASE_ROW, id: 'acme-sme', slug: 'acme-industries-sme', segment: 'SME', offeringType: 'IPO' };
  const MAIN_ROW = { ...YEAR_ROW, id: 'acme-main', slug: 'acme-industries-main', segment: 'MAINBOARD', offeringType: 'IPO' };
  const IPO_ROW = { ...BASE_ROW, id: 'acme-ipo', slug: 'acme-ipo', segment: 'MAINBOARD', offeringType: 'IPO' };
  const OFS_ROW = { ...YEAR_ROW, id: 'acme-ofs', slug: 'acme-ofs', segment: 'MAINBOARD', offeringType: 'OFS' };

  it('SME + MAINBOARD pair, incoming SME -> the SME row, no hold recorded', async () => {
    const { repo, auditInserts } = makeRepo([SME_ROW, MAIN_ROW]);
    const got = await repo.findByNormalizedName('acme industries', undefined, { segment: 'SME' });
    expect(got?.id).toBe('acme-sme');
    expect(auditInserts).toHaveLength(0);
  });

  it('SME + MAINBOARD pair, incoming MAINBOARD -> the MAINBOARD row', async () => {
    const { repo } = makeRepo([SME_ROW, MAIN_ROW]);
    expect((await repo.findByNormalizedName('acme industries', undefined, { segment: 'MAINBOARD' }))?.id).toBe('acme-main');
  });

  it('IPO + OFS pair, incoming IPO -> the IPO row; incoming OFS -> the OFS row', async () => {
    const { repo } = makeRepo([IPO_ROW, OFS_ROW]);
    expect((await repo.findByNormalizedName('acme industries', undefined, { offeringType: 'IPO' }))?.id).toBe('acme-ipo');
    expect((await repo.findByNormalizedName('acme industries', undefined, { offeringType: 'OFS' }))?.id).toBe('acme-ofs');
  });

  it('fail closed: incoming carries no segment / type -> the pair is still HELD', async () => {
    const { repo, auditInserts } = makeRepo([SME_ROW, MAIN_ROW]);
    const err = await repo.findByNormalizedName('acme industries', undefined, { segment: null, offeringType: null }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect(auditInserts).toHaveLength(1);
  });

  it('fail closed: two rows of the SAME segment and type stay HELD after narrowing', async () => {
    const twin = { ...SME_ROW, id: 'acme-sme-2', slug: 'acme-industries-sme-2027' };
    const { repo } = makeRepo([SME_ROW, twin]);
    const err = await repo.findByNormalizedName('acme industries', undefined, { segment: 'SME', offeringType: 'IPO' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect((err as IdentityHeldForReviewError).candidates).toHaveLength(2);
  });

  it('an ISIN/symbol-bound row that is one of the pair -> that row, no hold', async () => {
    const { repo, auditInserts } = makeRepo([SME_ROW, MAIN_ROW]);
    const got = await repo.findByNormalizedName('acme industries', undefined, { keyBoundId: 'acme-main' });
    expect(got?.id).toBe('acme-main');
    expect(auditInserts).toHaveLength(0);
  });

  it('a key-bound row that is NOT in the pair -> the pair is still HELD (fail closed, MAJOR-1)', async () => {
    const { repo, auditInserts } = makeRepo([SME_ROW, MAIN_ROW]);
    const err = await repo.findByNormalizedName('acme industries', undefined, { keyBoundId: 'someone-else', segment: 'SME' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect(auditInserts).toHaveLength(1);
  });

  it('resolveIpoRow: ISIN binds a row OUTSIDE the same-name pair -> HOLD, never a row of the pair (MAJOR-1, OD-34/OD-89)', async () => {
    // a1 and a2 share the name; K carries the record's ISIN but is a third row. The slug tier would
    // bind a1; the key-vs-name branch would then prefer a1 over K. The resolver must hold instead.
    const A1 = { ...SME_ROW, id: 'a1', slug: 'acme-industries-ltd' };
    const A2 = { ...SME_ROW, id: 'a2', slug: 'acme-industries-ltd-2027' };
    const K = { ...SME_ROW, id: 'k', slug: 'acme-holdings', companyName: 'Acme Holdings', isin: 'INE000A01010' };
    const { repo } = makeRepo([A1, A2]);
    Object.assign(repo, {
      findByIsin: vi.fn().mockResolvedValue(K), findAllByIsin: vi.fn().mockResolvedValue([K]), findBySymbol: vi.fn().mockResolvedValue(null),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]), findBySlug: vi.fn().mockResolvedValue(A1),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
    });
    const got = await resolveIpoRow(repo, {
      companyName: 'Acme Industries Ltd', normalizedName: 'acme industries', slug: 'acme-industries-ltd', cin: null,
      segment: 'SME', isin: 'INE000A01010',
    }).catch((e) => e);
    expect(got).toBeInstanceOf(IdentityHeldForReviewError);
  });

  it('same, with a SYMBOL-bound key row outside the pair -> HOLD', async () => {
    const A1 = { ...SME_ROW, id: 'a1', slug: 'acme-industries-ltd' };
    const A2 = { ...SME_ROW, id: 'a2', slug: 'acme-industries-ltd-2027' };
    const K = { ...SME_ROW, id: 'k', slug: 'acme-holdings', companyName: 'Acme Holdings', symbol: 'ACMEH' };
    const { repo } = makeRepo([A1, A2]);
    Object.assign(repo, {
      findByIsin: vi.fn().mockResolvedValue(null), findBySymbol: vi.fn().mockResolvedValue(K), findAllBySymbol: vi.fn().mockResolvedValue([K]),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]), findBySlug: vi.fn().mockResolvedValue(A1),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
    });
    const got = await resolveIpoRow(repo, {
      companyName: 'Acme Industries Ltd', normalizedName: 'acme industries', slug: 'acme-industries-ltd', cin: null,
      segment: 'SME', symbol: 'ACMEH',
    }).catch((e) => e);
    expect(got).toBeInstanceOf(IdentityHeldForReviewError);
  });

  it('offering-type retry returns a row of the WRONG segment -> declined, not bound (MINOR-1)', async () => {
    // incoming SME IPO; name tier finds an SME OFS row; the type-filtered retry returns a lone MAINBOARD IPO row.
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    const OFS_SME = { ...SME_ROW, id: 'ofs-sme', slug: 'acme-ofs-sme', offeringType: 'OFS' };
    const MAIN_IPO = { ...MAIN_ROW, id: 'main-ipo', slug: 'acme-main-ipo', offeringType: 'IPO' };
    const { repo } = makeRepo([]);
    Object.assign(repo, {
      findByIsin: vi.fn().mockResolvedValue(null), findBySymbol: vi.fn().mockResolvedValue(null),
      findAllByIsin: vi.fn().mockResolvedValue([]), findAllBySymbol: vi.fn().mockResolvedValue([]),
      findByNormalizedName: vi.fn().mockImplementation((_n: string, type?: string) => Promise.resolve(type ? MAIN_IPO : OFS_SME)),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]), findBySlug: vi.fn().mockResolvedValue(null),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
    });
    const got = await resolveIpoRow(repo, {
      companyName: 'Acme Industries Ltd', normalizedName: 'acme industries', slug: 'acme-industries-ltd', cin: null,
      segment: 'SME', offeringType: 'IPO',
    });
    expect(got?.id).not.toBe('main-ipo');
    // The retry itself must refuse the cross-segment row (OD-68 would catch it later, but a
    // second guard is the point): the "found on retry" line must never fire for it.
    expect(infoSpy.mock.calls.some((c) => String(c[1] ?? c[0]).includes('found on retry'))).toBe(false);
    infoSpy.mockRestore();
  });

  it('every row conflicts with the record -> first row returned so the resolver declines it itself', async () => {
    const { repo } = makeRepo([SME_ROW, { ...SME_ROW, id: 'acme-sme-2' }]);
    const got = await repo.findByNormalizedName('acme industries', undefined, { segment: 'MAINBOARD' });
    expect(got?.id).toBe('acme-sme');
  });

  it('resolveIpoRow through the REAL repository: SME record binds the SME row of an SME/MAINBOARD pair', async () => {
    const { repo } = makeRepo([SME_ROW, MAIN_ROW]);
    Object.assign(repo, {
      findByIsin: vi.fn().mockResolvedValue(null), findBySymbol: vi.fn().mockResolvedValue(null),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]), findBySlug: vi.fn().mockResolvedValue(null),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
    });
    const got = await resolveIpoRow(repo, {
      companyName: 'Acme Industries Ltd', normalizedName: 'acme industries', slug: 'acme-industries-ltd', cin: null, segment: 'SME',
    });
    expect(got?.id).toBe('acme-sme');
  });
});
