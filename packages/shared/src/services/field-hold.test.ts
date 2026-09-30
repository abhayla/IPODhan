import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { dropHeldFields, lockAndReadFieldHolds, filterPatchUnderHold, NO_HOLD, lockAndReadRowHolds, applyRowHolds } from './field-hold';

const dialect = new PgDialect();
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function recordingTx(lockRows: unknown[], protRows: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    async execute(q: SQL) {
      const built = dialect.sqlToQuery(q);
      queries.push({ sql: built.sql, params: built.params });
      return { rows: /FOR NO KEY UPDATE/.test(built.sql) ? lockRows : protRows };
    },
  };
}

describe('dropHeldFields (spec §9.2 item 19)', () => {
  it('drops exactly the protected keys and keeps the rest', () => {
    const r = dropHeldFields(
      { registrar: 'S', sector: 'X', lotSize: 10, updatedAt: new Date(0) },
      { writeBlocked: false, hidden: false, protectedFields: new Set(['registrar', 'lotSize']) }
    );
    expect(r.dropped).toEqual(['registrar', 'lotSize']);
    expect(Object.keys(r.patch)).toEqual(['sector', 'updatedAt']);
  });

  it('scraper_locked drops every non-bookkeeping key only when honourScraperLock is set', () => {
    const hold = { writeBlocked: true, hidden: false, protectedFields: new Set<string>() };
    const patch = { ipoId: A, issueType: 'BOOK', updatedAt: 1 };
    expect(dropHeldFields(patch, hold, { honourScraperLock: true }).dropped).toEqual(['issueType']);
    expect(dropHeldFields(patch, hold).dropped).toEqual([]);
  });

  it('never drops identity/bookkeeping keys even if a protection row names them', () => {
    const r = dropHeldFields(
      { id: 'x', ipoId: A, createdAt: 1, updatedAt: 2, lastUpdated: 3, v: 1 },
      { writeBlocked: true, hidden: false, protectedFields: new Set(['ipoId', 'id', 'v']) },
      { honourScraperLock: true }
    );
    expect(r.dropped).toEqual(['v']);
  });

  it('a HIDDEN row drops every non-bookkeeping key on every table, with or without honourScraperLock (§9.2 item 23)', () => {
    const hold = { writeBlocked: true, hidden: true, protectedFields: new Set<string>() };
    const patch = { ipoId: A, issueType: 'BOOK', updatedAt: 1 };
    expect(dropHeldFields(patch, hold).dropped).toEqual(['issueType']);
    expect(dropHeldFields(patch, hold, { honourScraperLock: true }).dropped).toEqual(['issueType']);
  });

  it('no hold keeps the patch byte-identical (no behaviour change for unprotected fields)', () => {
    const patch = { a: 1, b: null, c: 'x' };
    expect(dropHeldFields(patch, NO_HOLD)).toEqual({ patch, dropped: [] });
  });
});

describe('lockAndReadFieldHolds', () => {
  it('locks every ipos row in ONE sorted FOR NO KEY UPDATE and reads protection in ONE query (no N+1)', async () => {
    const tx = recordingTx(
      [{ id: A, scraper_locked: false }, { id: B, scraper_locked: true }],
      [{ ipo_id: B, field_name: 'listingPrice' }, { ipo_id: A, field_name: 'openPrice' }]
    );
    const holds = await lockAndReadFieldHolds(tx, [B, A, B], 'listing_performance');
    expect(tx.queries).toHaveLength(2);
    expect(tx.queries[0].sql).toMatch(/FROM ipos WHERE id IN \(\$1::uuid, \$2::uuid\) ORDER BY id FOR NO KEY UPDATE/);
    expect(tx.queries[0].params).toEqual([A, B]);
    expect(tx.queries[1].sql).toMatch(/field_protection_metadata/);
    expect(tx.queries[1].params).toEqual([A, B, 'listing_performance']);
    expect([...holds.get(A)!.protectedFields]).toEqual(['openPrice']);
    expect(holds.get(B)).toMatchObject({ writeBlocked: true, hidden: false });
    expect(holds.get(A)).toMatchObject({ writeBlocked: false, hidden: false });
    expect([...holds.get(B)!.protectedFields]).toEqual(['listingPrice']);
  });

  it('skips the protection read when no IPO row exists, and filterPatchUnderHold reports hold=null', async () => {
    const tx = recordingTx([], []);
    const r = await filterPatchUnderHold(tx, A, 'ipos', { registrar: 'S' });
    expect(tx.queries).toHaveLength(1);
    expect(r).toEqual({ patch: { registrar: 'S' }, dropped: [], hold: null });
  });

  it('empty id list issues no query', async () => {
    const tx = recordingTx([], []);
    expect((await lockAndReadFieldHolds(tx, [], 'ipos')).size).toBe(0);
    expect(tx.queries).toHaveLength(0);
  });
});

describe('hidden row (§9.2 item 23, OD-150): the single-row and row-keyed forms refuse the write', () => {
  const hiddenAt = new Date('2026-09-30T08:00:00Z');
  it('filterPatchUnderHold throws IpoHiddenError inside the lock (an upsert would otherwise insert values whole)', async () => {
    const tx = recordingTx([{ id: A, scraper_locked: false, hidden_at: hiddenAt }], []);
    await expect(filterPatchUnderHold(tx, A, 'financial_data', { ipoId: A, revenue: 1 })).rejects.toMatchObject({ name: 'IpoHiddenError', ipoId: A });
    expect(tx.queries[0].sql).toMatch(/SELECT id, scraper_locked, hidden_at FROM ipos/);
  });
  it('lockAndReadRowHolds throws IpoHiddenError', async () => {
    const tx = recordingTx([{ id: A, scraper_locked: false, hidden_at: hiddenAt }], []);
    await expect(lockAndReadRowHolds(tx, A, 'peer_companies')).rejects.toMatchObject({ name: 'IpoHiddenError' });
  });
  it('discriminates: a visible (and a locked-only) row is not refused', async () => {
    const tx = recordingTx([{ id: A, scraper_locked: true, hidden_at: null }], []);
    const r = await filterPatchUnderHold(tx, A, 'financial_data', { ipoId: A, revenue: 1 });
    expect(r.hold).toMatchObject({ writeBlocked: true, hidden: false });
    expect(r.patch).toEqual({ ipoId: A, revenue: 1 });
  });
});

describe('row-keyed holds (peer_companies:<normalized name>)', () => {
  it('the row-hold prefix matches protectionTableName (the admin write)', async () => {
    const { protectionTableName } = await import('./admin-field-write');
    const tx = recordingTx([{ id: A, scraper_locked: false }], [{ table_name: protectionTableName('peer_companies', 'acme'), field_name: 'peRatio' }]);
    const r = await lockAndReadRowHolds(tx, A, 'peer_companies');
    expect(tx.queries).toHaveLength(2);
    expect(tx.queries[0].sql).toMatch(/FOR NO KEY UPDATE/);
    expect(tx.queries[1].params).toEqual([A, 'peer_companies:']);
    expect([...r.rows.get('acme')!]).toEqual(['peRatio']);
  });

  it('applyRowHolds keeps exactly the held stored values and keeps a held row the new list omits', () => {
    const stored = [
      { id: 's1', normalizedName: 'acme', peRatio: '22.50', eps: '1.00' },
      { id: 's2', normalizedName: 'beta', peRatio: '10.00', eps: '2.00' },
      { id: 's3', normalizedName: 'gone', peRatio: '5.00', eps: '3.00' },
    ];
    const incoming = [
      { normalizedName: 'acme', peRatio: '99.00', eps: '9.00' },
      { normalizedName: 'beta', peRatio: '11.00', eps: '2.50' },
    ];
    const holds = new Map([['acme', new Set(['peRatio'])], ['dead', new Set(['eps'])]]);
    const out = applyRowHolds(incoming, stored, holds, 'normalizedName');
    expect(out.rows).toEqual([
      { normalizedName: 'acme', peRatio: '22.50', eps: '9.00' },
      { normalizedName: 'beta', peRatio: '11.00', eps: '2.50' },
    ]);
    expect(out.keptFields).toEqual([{ rowKey: 'acme', field: 'peRatio' }]);
    expect(out.keptRows).toEqual([]);
    const out2 = applyRowHolds(incoming, stored, new Map([['gone', new Set(['eps'])]]), 'normalizedName');
    expect(out2.rows).toHaveLength(3);
    expect(out2.rows[2]).toBe(stored[2]);
    expect(out2.keptRows).toEqual(['gone']);
  });
});
