/**
 * #860: 41 rows on staging carry a null segment. Broken down by offering type,
 * 31 of them are OFS (19), TENDER (5), NCD (3), RIGHTS (2), BUYBACK (1) and
 * INVITS (1) — and for those a null segment is CORRECT. An offer-for-sale of an
 * already-listed company has no "MAINBOARD vs SME" segment; the question does
 * not apply, and a backfill that invented one would be fabricating data.
 *
 * The real class is the 10 genuine IPOs. `ipoTypeKey(segment, exchanges)` needs
 * a segment to pick the manifest ranks, so an IPO with none has every ranked
 * source chosen for a GUESSED type — and `pull_plan_rank` cannot detect it,
 * because the policy it compares against was selected using the same guess.
 *
 * So the guard is scoped to offering_type = 'IPO'. Scoping it wider would
 * reject 31 rows that are right.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';

function makeStubDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'ipo-1', companyName: 'Test Ltd' }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  const db = { insert, select: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() } as unknown as never;
  return { db, insert };
}

const stubRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

const base = { companyName: 'Test Ltd', slug: 'test-ltd', status: 'UPCOMING' as never };

describe('IPORepository.create — an IPO may not be created without a segment (#860)', () => {
  it('refuses offeringType IPO with a null segment', async () => {
    const { db, insert } = makeStubDb();
    const repo = new IPORepository(db, stubRedis);
    await expect(
      repo.create({ ...base, offeringType: 'IPO', segment: null } as never)
    ).rejects.toThrow(/segment/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses offeringType IPO with segment absent entirely — undefined is not a pass', async () => {
    const { db, insert } = makeStubDb();
    const repo = new IPORepository(db, stubRedis);
    await expect(
      repo.create({ ...base, offeringType: 'IPO' } as never)
    ).rejects.toThrow(/segment/i);
    expect(insert).not.toHaveBeenCalled();
  });

  // The half that matters most: 31 of the 41 real rows are these, and a
  // guard that rejected them would be a worse defect than the one it fixes.
  for (const offeringType of ['OFS', 'TENDER', 'NCD', 'RIGHTS', 'BUYBACK', 'INVITS', 'REITS']) {
    it(`ALLOWS ${offeringType} with a null segment — the question does not apply to it`, async () => {
      const { db, insert } = makeStubDb();
      const repo = new IPORepository(db, stubRedis);
      await repo.create({ ...base, offeringType, segment: null } as never);
      expect(insert).toHaveBeenCalled();
    });
  }

  for (const segment of ['MAINBOARD', 'SME']) {
    it(`ALLOWS an IPO with segment ${segment}`, async () => {
      const { db, insert } = makeStubDb();
      const repo = new IPORepository(db, stubRedis);
      await repo.create({ ...base, offeringType: 'IPO', segment } as never);
      expect(insert).toHaveBeenCalled();
    });
  }
});
