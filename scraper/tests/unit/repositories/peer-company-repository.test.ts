/**
 * Item 1 slice s2 fix round (F-1 / GitHub #443): direct unit tests for
 * `PeerCompanyRepository.replaceForIpo` — the de-dupe and the
 * one-transaction shape, without a real database.
 *
 * `scraper/tests/integration/peer-company-replace-atomicity.integration.test.ts`
 * proves the REAL-DB half of F-1 (a genuinely failing insert leaves the
 * previously stored rows intact); this file proves the two things a mock
 * can prove cheaply and deterministically: (1) two rows that normalise to
 * the same key collapse to ONE row before the insert is even attempted, and
 * (2) the delete and the insert both run inside the SAME `db.transaction`
 * callback, never as two independent statements.
 */
import { describe, it, expect, vi } from 'vitest';
import { PeerCompanyRepository, type PeerCompanyInsert } from '../../../src/repositories/peer-company-repository.js';

function makeMockTx(insertedRows: unknown[]) {
  const calls: string[] = [];
  let insertedValues: unknown[] = [];
  return {
    calls,
    getInsertedValues: () => insertedValues,
    tx: {
      delete: vi.fn().mockReturnValue({
        where: vi.fn(() => {
          calls.push('delete');
          return Promise.resolve([]);
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((rows: unknown[]) => {
          calls.push('insert');
          insertedValues = rows;
          return {
            returning: vi.fn(() => Promise.resolve(insertedRows)),
          };
        }),
      }),
    },
  };
}

function makeRow(overrides: Partial<PeerCompanyInsert>): PeerCompanyInsert {
  return {
    ipoId: 'ipo-1',
    companyName: 'ABC Ltd',
    normalizedName: 'abc',
    isListed: true,
    ...overrides,
  } as PeerCompanyInsert;
}

describe('PeerCompanyRepository.replaceForIpo (F-1 / GitHub #443)', () => {
  it('de-dupes two rows that normalise to the same key — the LAST occurrence wins, ONE row is written', async () => {
    const { calls, tx, getInsertedValues } = makeMockTx([{ id: 'p-1' }]);
    const mockDb = { transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) } as never;
    const repo = new PeerCompanyRepository(mockDb);

    const rows = [
      makeRow({ companyName: 'ABC Ltd', normalizedName: 'abc', peRatio: '10.00' }),
      makeRow({ companyName: 'ABC Limited', normalizedName: 'abc', peRatio: '99.00' }),
    ];

    await expect(repo.replaceForIpo('ipo-1', rows)).resolves.toEqual([{ id: 'p-1' }]);

    const written = getInsertedValues() as PeerCompanyInsert[];
    expect(written).toHaveLength(1);
    expect(written[0].companyName).toBe('ABC Limited');
    expect(written[0].peRatio).toBe('99.00');
    expect(calls).toEqual(['delete', 'insert']);
  });

  it('two rows with genuinely different keys both survive the de-dupe', async () => {
    const { tx, getInsertedValues } = makeMockTx([{ id: 'p-1' }, { id: 'p-2' }]);
    const mockDb = { transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) } as never;
    const repo = new PeerCompanyRepository(mockDb);

    const rows = [
      makeRow({ companyName: 'ABC Ltd', normalizedName: 'abc' }),
      makeRow({ companyName: 'XYZ Ltd', normalizedName: 'xyz' }),
    ];

    await repo.replaceForIpo('ipo-1', rows);

    expect(getInsertedValues()).toHaveLength(2);
  });

  it('runs delete and insert inside ONE db.transaction call, never as two independent statements', async () => {
    const { tx } = makeMockTx([]);
    const transactionSpy = vi.fn((cb: (tx: unknown) => unknown) => cb(tx));
    const mockDb = { transaction: transactionSpy } as never;
    const repo = new PeerCompanyRepository(mockDb);

    await repo.replaceForIpo('ipo-1', [makeRow({})]);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('an empty row set still deletes (inside the transaction) and skips the insert', async () => {
    const { calls, tx } = makeMockTx([]);
    const mockDb = { transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) } as never;
    const repo = new PeerCompanyRepository(mockDb);

    const result = await repo.replaceForIpo('ipo-1', []);

    expect(result).toEqual([]);
    expect(calls).toEqual(['delete']);
  });
});
