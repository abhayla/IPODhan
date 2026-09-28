import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { dropHeldFields, lockAndReadFieldHolds, filterPatchUnderHold, NO_HOLD } from './field-hold';

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
      { scraperLocked: false, protectedFields: new Set(['registrar', 'lotSize']) }
    );
    expect(r.dropped).toEqual(['registrar', 'lotSize']);
    expect(Object.keys(r.patch)).toEqual(['sector', 'updatedAt']);
  });

  it('scraper_locked drops every non-bookkeeping key only when honourScraperLock is set', () => {
    const hold = { scraperLocked: true, protectedFields: new Set<string>() };
    const patch = { ipoId: A, issueType: 'BOOK', updatedAt: 1 };
    expect(dropHeldFields(patch, hold, { honourScraperLock: true }).dropped).toEqual(['issueType']);
    expect(dropHeldFields(patch, hold).dropped).toEqual([]);
  });

  it('never drops identity/bookkeeping keys even if a protection row names them', () => {
    const r = dropHeldFields(
      { id: 'x', ipoId: A, createdAt: 1, updatedAt: 2, lastUpdated: 3, v: 1 },
      { scraperLocked: true, protectedFields: new Set(['ipoId', 'id', 'v']) },
      { honourScraperLock: true }
    );
    expect(r.dropped).toEqual(['v']);
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
    expect(holds.get(B)).toMatchObject({ scraperLocked: true });
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
