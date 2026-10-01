import { describe, it, expect } from 'vitest';
import { AnchorInvestorRepository, AnchorListHeldError } from '@/lib/repositories/anchor-investor-repository';

/**
 * #1362 review MINOR (spec §9.2 item 8, OD-107): `create()` takes the IPO row lock and reads the
 * list hold first; an admin-owned anchor list is refused (AnchorListHeldError) and nothing is
 * inserted. Unit-level with a fake transaction: the web DB integration run is local-only (#1366).
 */
function fakeDb(owned: boolean) {
  const inserts: unknown[] = [];
  const tx = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q?.queryChunks ?? q);
      if (text.includes('FOR NO KEY UPDATE')) return { rows: [{ id: 'ipo' }] };
      return { rows: owned ? [{ '?column?': 1 }] : [] };
    },
    insert: () => ({ values: (v: unknown) => ({ returning: async () => { inserts.push(v); return [{ id: 'row', ...(v as object) }]; } }) }),
  };
  const db = { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { db, inserts };
}
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;

describe('AnchorInvestorRepository.create (#1362 MINOR)', () => {
  it('refuses an admin-owned list with AnchorListHeldError and inserts nothing', async () => {
    const { db, inserts } = fakeDb(true);
    const repo = new AnchorInvestorRepository(db as never, noRedis);
    await expect(repo.create({ ipoId: 'ipo', investorList: [{ name: 'X' }] } as never)).rejects.toBeInstanceOf(AnchorListHeldError);
    expect(inserts).toEqual([]);
  });
  it('inserts when the list is not admin-owned', async () => {
    const { db, inserts } = fakeDb(false);
    const repo = new AnchorInvestorRepository(db as never, noRedis);
    await expect(repo.create({ ipoId: 'ipo' } as never)).resolves.toMatchObject({ id: 'row' });
    expect(inserts).toHaveLength(1);
  });
});
