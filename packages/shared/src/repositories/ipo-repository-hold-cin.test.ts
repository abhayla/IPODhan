/**
 * Item 12 fix round 1 (PR #925, independent reviewer finding MINOR-3): a unit
 * guard for `IPORepository.holdIfIdentityUnbound`'s OD-69 CIN exemption
 * (ipo-repository.ts ~line 964-966: `if (incomingCin && rowCin && incomingCin
 * !== rowCin) return false;`). Before this PR the exemption had no test at
 * all — nothing would turn red if it were deleted or inverted.
 *
 * `holdIfIdentityUnbound` is private, invoked only from `create()`. This test
 * drives the real `create()` against a stub `db`: the SELECT the hold-check
 * runs returns a fixed candidate row, and (only if the hold-check does NOT
 * throw) the subsequent INSERT is made to throw a distinguishable sentinel
 * error so the test can tell "held" (IdentityHeldForReviewError, insert never
 * reached) apart from "not held" (DatabaseError wrapping the insert's own
 * failure — see `create()`'s catch block, which wraps any insert-time error).
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';
import { IdentityHeldForReviewError, DatabaseError } from '../errors/repository-errors';

const CANDIDATE_CIN = 'U74999MH1995PLC084474';
const OTHER_CIN = 'U74994MH2005PLC339336';

/**
 * A stub `db` whose `select().from().where()` returns one candidate row that,
 * absent the CIN exemption, would trigger the OD-68 hold (same identity fold,
 * same segment/type, open date 10 days apart — inside the 180-day window and
 * both KNOWN, so `dateDiffers` is true and the base hold condition fires).
 * `insert().values().returning()` throws a sentinel so a create that reaches
 * it is distinguishable from one held before it.
 */
function stubDb(candidateCin: string | null) {
  const candidateRow = {
    id: 'candidate-1',
    slug: 'adroit-industries-india-ltd',
    companyName: 'Adroit Industries (India) Ltd.',
    openDate: '2026-09-12',
    priceRangeMin: null,
    status: 'OPEN',
    cin: candidateCin,
  };
  const where = vi.fn().mockResolvedValue([candidateRow]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const returning = vi.fn().mockRejectedValue(new Error('INSERT_SENTINEL: reached the insert'));
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return { select, insert } as unknown as ConstructorParameters<typeof IPORepository>[0];
}

function makeRepo(candidateCin: string | null) {
  const redis = { get: vi.fn(), setex: vi.fn(), del: vi.fn(), keys: vi.fn().mockResolvedValue([]) };
  return new IPORepository(stubDb(candidateCin), redis as unknown as ConstructorParameters<typeof IPORepository>[1]);
}

const incoming = {
  companyName: 'Adroit Industries (India) Ltd.',
  slug: 'adroit-industries-india-ltd-2',
  segment: 'SME' as const,
  offeringType: 'IPO',
  openDate: '2026-09-22', // 10 days from the candidate's 2026-09-12 — inside the 180-day window, and differs
};

describe('holdIfIdentityUnbound: OD-69 CIN exemption (line ~966)', () => {
  it('a candidate with NO stored CIN is held (the base OD-68 condition fires, nothing exempts it)', async () => {
    const repo = makeRepo(null);
    await expect(repo.create({ ...incoming, cin: CANDIDATE_CIN } as never)).rejects.toBeInstanceOf(
      IdentityHeldForReviewError
    );
  });

  it('a candidate whose CIN DIFFERS from the incoming one is exempted from the hold — proceeds to insert', async () => {
    const repo = makeRepo(OTHER_CIN);
    await expect(repo.create({ ...incoming, cin: CANDIDATE_CIN } as never)).rejects.toBeInstanceOf(DatabaseError);
  });

  it('a candidate whose CIN MATCHES is not exempted by this guard (matches, so not "differs") — held', async () => {
    const repo = makeRepo(CANDIDATE_CIN);
    await expect(repo.create({ ...incoming, cin: CANDIDATE_CIN } as never)).rejects.toBeInstanceOf(
      IdentityHeldForReviewError
    );
  });
});
