import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { snapshottingWriter, leadManagerLedgerEntries } from '../../../scripts/repair-lead-managers-from-payload.js';

const dialect = new PgDialect();

/**
 * #457 round 3 (review MINOR 1): the lead-managers before-snapshot is taken on the WRITE's own
 * transaction handle, locked FOR UPDATE, before the write runs; the after-snapshot on the same
 * handle after it. A before read on a separate pool connection could see a value the write
 * never replaced.
 */
describe('snapshottingWriter', () => {
  it('reads before (FOR UPDATE) -> runs the write -> reads after, all on the transaction handle', async () => {
    const events: string[] = [];
    const tx = {
      execute: async (q: unknown) => {
        const text = dialect.sqlToQuery(q as never).sql;
        events.push(`${/for update/i.test(text) ? 'locked' : 'plain'}:${/from ipos/i.test(text) ? 'ipos' : 'field_sources'}`);
        return { rows: [/from ipos/i.test(text) ? { lead_managers: null, updated_at: 't0' } : { id: 'fs1', source: 'BSE' }] };
      },
    };
    const base = {
      transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx),
      update: () => undefined,
      select: () => undefined,
      insert: () => undefined,
    };
    const sink: { before?: any; after?: any } = {};
    const out = await snapshottingWriter(base as never, 'ipo-1', sink).transaction(async (t) => {
      expect(t).toBe(tx);
      events.push('write');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(events).toEqual(['locked:ipos', 'locked:field_sources', 'write', 'plain:ipos', 'plain:field_sources']);
    expect(sink.before.ipo).toEqual({ lead_managers: null, updated_at: 't0' });
    expect(sink.after.fs).toEqual({ id: 'fs1', source: 'BSE' });
  });

  it('ledger entries carry the locked before-values', () => {
    const changes = leadManagerLedgerEntries(
      'ipo-1',
      { ipo: { lead_managers: null, updated_at: 't0' }, fs: null },
      { ipo: { lead_managers: ['A Ltd'], updated_at: 't1' }, fs: { id: 'fs1', source: 'BSE' } }
    );
    expect(changes).toEqual([
      { table: 'ipos', rowKey: 'ipo-1', field: 'lead_managers', before: null, after: ['A Ltd'] },
      { table: 'ipos', rowKey: 'ipo-1', field: 'updated_at', before: 't0', after: 't1' },
      { table: 'field_sources', rowKey: 'fs1', field: '(row)', before: null, after: { id: 'fs1', source: 'BSE' } },
    ]);
  });
});
