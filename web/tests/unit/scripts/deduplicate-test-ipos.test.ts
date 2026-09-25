/**
 * #447 regression coverage: `deduplicate-test-ipos.ts` re-parents a
 * duplicate IPO's child rows (subscriptions, gmp_records, financial_data,
 * documents, listing_performance, peer_companies) across several tables and
 * then deletes the duplicate IPO. Before this fix, none of that ran inside a
 * transaction — a throw partway through (most concretely, a
 * `peer_companies` unique-constraint violation once `UNIQUE (ipo_id,
 * normalized_name)` applies and the canonical/duplicate share a peer name)
 * left some tables reassigned and others not, with the duplicate IPO row
 * still present.
 *
 * A live Postgres integration test is heavier than this needs: the defect
 * class is "does the whole sequence run inside one `db.transaction(...)`
 * call, and does the peer-company step avoid ever handing the DB a
 * guaranteed-to-throw duplicate row" - both are provable against a mocked
 * `NodePgDatabase`-shaped object that records every call it receives,
 * without a real Postgres connection. `setDbForTest` (added by this fix)
 * is the injection point; `deduplicateGroup`'s execute path is otherwise
 * unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deduplicateGroup, setDbForTest } from '../../../scripts/deduplicate-test-ipos.js';

interface Call {
  op: 'select' | 'update' | 'delete';
  table: string;
}

/** Minimal drizzle-shaped chainable query builder recorder. */
function makeMockDb(opts: {
  duplicates: any[];
  canonicalPeers: { normalizedName: string }[];
  duplicatePeers: { id: string; normalizedName: string }[];
  txShouldThrowOn?: string; // table name to throw on, inside the transaction
}) {
  const calls: Call[] = [];
  let peerSelectCallCount = 0;

  function tableNameOf(tableObj: any): string {
    // drizzle pgTable objects carry a symbol-keyed name; fall back to a
    // per-call tag threaded through the mock builders below instead of
    // introspecting drizzle internals.
    return tableObj.__mockName ?? 'unknown';
  }

  function selectBuilder(forTable: string) {
    return {
      from: (tableObj: any) => {
        const table = tableObj.__mockName ?? forTable;
        return {
          where: () => {
            calls.push({ op: 'select', table });
            if (table === 'ipos') return Promise.resolve(opts.duplicates);
            if (table === 'peer_companies') {
              peerSelectCallCount += 1;
              // First select per duplicate = canonical's existing peers,
              // second = the duplicate's peers (matches call order in
              // the Step 3 peer-company branch).
              return Promise.resolve(
                peerSelectCallCount % 2 === 1 ? opts.canonicalPeers : opts.duplicatePeers
              );
            }
            return Promise.resolve([]);
          },
        };
      },
    };
  }

  function mutationBuilder(op: 'update' | 'delete') {
    return (tableObj: any) => {
      const table = tableObj.__mockName ?? 'unknown';
      const runAndRecord = () => {
        calls.push({ op, table });
        if (opts.txShouldThrowOn && table === opts.txShouldThrowOn) {
          throw new Error(`mock failure on ${table}`);
        }
        return Promise.resolve();
      };
      if (op === 'update') {
        return { set: () => ({ where: runAndRecord }) };
      }
      return { where: runAndRecord };
    };
  }

  const tx = {
    select: (_cols?: any) => selectBuilder('tx-select'),
    update: mutationBuilder('update'),
    delete: mutationBuilder('delete'),
  };

  const db = {
    select: (_cols?: any) => selectBuilder('outer-select'),
    update: mutationBuilder('update'),
    delete: mutationBuilder('delete'),
    transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
      calls.push({ op: 'select', table: '__transaction_start__' });
      return fn(tx);
    }),
  };

  return { db, calls };
}

// Tag the imported table objects with a stable name the mock can read,
// without depending on drizzle-orm's internal symbol shape.
import {
  ipos,
  subscriptions,
  gmpRecords,
  financialData,
  documents,
  listingPerformance,
  peerCompanies,
} from '../../../lib/db/index.js';
(ipos as any).__mockName = 'ipos';
(subscriptions as any).__mockName = 'subscriptions';
(gmpRecords as any).__mockName = 'gmp_records';
(financialData as any).__mockName = 'financial_data';
(documents as any).__mockName = 'documents';
(listingPerformance as any).__mockName = 'listing_performance';
(peerCompanies as any).__mockName = 'peer_companies';

const group = {
  companyPattern: '%acme%',
  canonicalName: 'Acme Industries Limited',
  canonicalSlug: 'acme-industries-ltd',
};

const canonical = {
  id: 'canonical-id',
  companyName: 'Acme Industries Limited',
  slug: 'acme-industries-ltd',
  symbol: 'ACME',
  createdAt: new Date('2026-01-01'),
};

const duplicate = {
  id: 'duplicate-id',
  companyName: 'Acme Industries Ltd',
  slug: 'acme-industries-ltd-2',
  symbol: null,
  createdAt: new Date('2026-06-01'),
};

describe('deduplicateGroup - #447 transaction wrapping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the re-parenting sequence (Steps 3-4: FK reassignment + duplicate delete) inside ONE db.transaction() call', async () => {
    const { db, calls } = makeMockDb({
      duplicates: [canonical, duplicate],
      canonicalPeers: [],
      duplicatePeers: [],
    });
    setDbForTest(db as any);

    await deduplicateGroup(group, false);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Every child-table reassignment (subscriptions/gmp/financial/documents/
    // listing_performance/peer_companies) and the duplicate ipos delete
    // happen after the transaction starts - proves the actual re-parenting
    // sequence runs inside the transaction boundary (Steps 1-2, the
    // symbol-clear and canonical-record update, are unaffected prep work
    // and intentionally stay outside it).
    const txStartIdx = calls.findIndex((c) => c.table === '__transaction_start__');
    const reparentTables = ['subscriptions', 'gmp_records', 'financial_data', 'documents', 'listing_performance', 'peer_companies'];
    const reparentMutationsBeforeTx = calls
      .slice(0, txStartIdx)
      .filter((c) => (c.op === 'update' || c.op === 'delete') && reparentTables.includes(c.table));
    expect(reparentMutationsBeforeTx).toHaveLength(0);
    const iposDeleteBeforeTx = calls
      .slice(0, txStartIdx)
      .some((c) => c.op === 'delete' && c.table === 'ipos');
    expect(iposDeleteBeforeTx).toBe(false);
    // The duplicate ipos row is deleted (Step 4 ran to completion), inside the tx.
    const iposDeleteAfterTx = calls
      .slice(txStartIdx)
      .some((c) => c.op === 'delete' && c.table === 'ipos');
    expect(iposDeleteAfterTx).toBe(true);
  });

  it('rolls back: a throw partway through the transaction propagates and never reaches Step 4 (delete)', async () => {
    const { db, calls } = makeMockDb({
      duplicates: [canonical, duplicate],
      canonicalPeers: [],
      duplicatePeers: [],
      txShouldThrowOn: 'financial_data',
    });
    setDbForTest(db as any);

    await expect(deduplicateGroup(group, false)).rejects.toThrow('mock failure on financial_data');

    // Step 4 (deleting the duplicate ipos row) never ran - the transaction
    // callback threw before reaching it, so drizzle's real db.transaction
    // would roll back everything the callback already did.
    expect(calls.some((c) => c.op === 'delete' && c.table === 'ipos')).toBe(false);
    // Documents and listing_performance (which come after financial_data in
    // the Step 3 sequence) never ran either.
    expect(calls.some((c) => c.table === 'documents')).toBe(false);
    expect(calls.some((c) => c.table === 'listing_performance')).toBe(false);
  });

  it('#447: deletes the duplicate peer row that collides on normalized_name instead of reassigning it', async () => {
    const { db, calls } = makeMockDb({
      duplicates: [canonical, duplicate],
      canonicalPeers: [{ normalizedName: 'shared peer co' }],
      duplicatePeers: [
        { id: 'peer-collide', normalizedName: 'shared peer co' },
        { id: 'peer-unique', normalizedName: 'other peer co' },
      ],
    });
    setDbForTest(db as any);

    await deduplicateGroup(group, false);

    // A peer_companies delete happened (the colliding row) before the
    // reassignment update - proving the merge-or-skip branch ran.
    const peerOps = calls.filter((c) => c.table === 'peer_companies');
    expect(peerOps.some((c) => c.op === 'delete')).toBe(true);
    expect(peerOps.some((c) => c.op === 'update')).toBe(true);
  });
});
