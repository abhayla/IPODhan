import { describe, it, expect, vi } from 'vitest';
import { createGMPRecord } from '../../../src/services/data-persister.js';

/**
 * B1/G11 — createGMPRecord persists gmp_percentage from the source, guarded:
 * a finite value is stored as a 2-dp numeric string; missing / NaN / Infinity → null.
 */
function mockRepo() {
  return { create: vi.fn().mockResolvedValue({ id: 'gmp-1' }) } as any;
}

describe('createGMPRecord — gmp_percentage guard (B1)', () => {
  it('stores a finite source percentage as a 2-decimal number', async () => {
    const repo = mockRepo();
    await createGMPRecord(repo, 'ipo-1', 110, new Date(), 10.333);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ gmpPercentage: 10.33, gmp: 110 }),
    );
  });

  it('stores null when the percentage is missing', async () => {
    const repo = mockRepo();
    await createGMPRecord(repo, 'ipo-1', 110, new Date());
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ gmpPercentage: null }));
  });

  it('stores null for NaN / Infinity (numeric safety guard)', async () => {
    const repo = mockRepo();
    await createGMPRecord(repo, 'ipo-1', 110, new Date(), Infinity);
    await createGMPRecord(repo, 'ipo-1', 110, new Date(), NaN);
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ gmpPercentage: null }),
    );
  });

  it('stores fractional gmp as-is now the column is numeric (no Math.round)', async () => {
    const repo = mockRepo();
    await createGMPRecord(repo, 'ipo-1', 110.7, new Date(), 5);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ gmp: 110.7 }));
  });
});
