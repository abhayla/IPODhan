import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { parseBseParties } from '../../../src/services/bse-party-parser.js';

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return { ...actual, sourceKeyLineageFor: vi.fn().mockReturnValue(null) };
});

import { recordDiscoveredLeadManagers } from '../../../src/services/data-persister.js';
import { sourceKeyLineageFor } from '@ipodhan/shared/repositories';

/**
 * T-503 / #416 — real Steamhouse India payload (BSE core-API
 * `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=7954`, fetched 2026-09-08, one BRLM, no
 * co-BRLM). RCA: `document-discovery-runner.ts` parses this row's lead
 * managers via `parseBseParties` for its `result.leadManagers`, but
 * `document-cycle.ts` only ever forwarded the COUNT into
 * `bsePayloadLeadManagerCount` via `recordBseDiscoveryMetadata` — the names
 * were discarded, so `ipos.lead_managers` stayed null even though the BSE
 * payload named a real BRLM.
 *
 * Round 2 (#417 review): the fixture below also exercises the two round-2
 * fixes — a `field_sources` provenance row upserted in the SAME transaction
 * as the `ipos` write (MAJOR), and a SQL-level WHERE guard (simulated here
 * via the fake transaction's `update().where()` returning zero rows when the
 * simulated row is already populated) instead of a stale pre-read snapshot
 * (MODERATE TOCTOU).
 */
const STEAMHOUSE_BSE_ROW = {
  IPO_NO: '7954',
  ScripName: 'Steamhouse India Limited',
  Book_Running_Lead_Manager:
    'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)^Unit no. 2601B, 26th Floor, A Wing, Marathon Futurex,Mafatlal Mills Compound, N M Joshi Marg ,Delisle Road, Lower Parel Mumbai - 400 013||||||||steam.ipo@equirus.com|Mrunal Jadhav/ Rahul Wadekar',
  Co_Book_Running_Lead_Manager: '',
};

/**
 * A fake transactional db whose `ipos.update().where().returning()` behaves
 * like the real SQL WHERE guard: it returns the updated row ONLY when
 * `simulatedStoredLeadManagers` is empty/null at call time — exactly what
 * `lead_managers IS NULL OR jsonb_array_length(lead_managers) = 0` would do
 * in Postgres. `fieldSourcesRows` accumulates every upserted provenance row
 * so tests can assert on it.
 */
function fakeTransactionalDb(opts: {
  simulatedStoredLeadManagers: string[] | null;
  previousSource?: string | null;
  slug?: string;
}) {
  const fieldSourcesRows: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const onConflictArgs: Array<{ target: unknown[]; set: Record<string, unknown> }> = [];
  const selectWhereArgs: unknown[] = [];

  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const guardPasses =
              !opts.simulatedStoredLeadManagers || opts.simulatedStoredLeadManagers.length === 0;
            return guardPasses ? [{ id: 'ipo-1', slug: opts.slug ?? 'steamhouse-india' }] : [];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          selectWhereArgs.push(cond);
          return {
            limit: async () => (opts.previousSource ? [{ source: opts.previousSource }] : []),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertCalls.push(v);
        return {
          onConflictDoUpdate: async (arg: { target: unknown[]; set: Record<string, unknown> }) => {
            onConflictArgs.push(arg);
            fieldSourcesRows.push({ ...v, ...arg.set });
          },
        };
      },
    }),
  };

  const dbLike = {
    transaction: async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
    update: tx.update,
    select: tx.select,
    insert: tx.insert,
  };

  return { dbLike, fieldSourcesRows, insertCalls, onConflictArgs, selectWhereArgs };
}

/**
 * T-513 / #419: a fake `ipoRepository` exposing only the narrow surface
 * `recordDiscoveredLeadManagers` needs (`invalidateIpoCache`), matching the
 * `Pick<IPORepository, 'invalidateIpoCache'>` parameter type.
 */
function fakeIpoRepository() {
  return { invalidateIpoCache: vi.fn().mockResolvedValue(undefined) };
}

describe('T-503 — discovered BSE lead managers reach ipos.lead_managers', () => {
  it('parses the real Steamhouse payload to exactly 1 BRLM (the class this check flags)', () => {
    const parsed = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    expect(parsed.leadManagers).toEqual([
      'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)',
    ]);
  });

  it('writes the discovered names through the shared write path when the field is empty, and upserts field_sources in the same transaction', async () => {
    const { leadManagers } = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      slug: 'steamhouse-india',
    });
    const ipoRepository = fakeIpoRepository();

    const result = await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-steamhouse',
      leadManagers,
      'BSE',
      dbLike as never
    );

    expect(result).toEqual({ written: true });
    expect(fieldSourcesRows).toHaveLength(1);
    expect(fieldSourcesRows[0]).toMatchObject({
      ipoId: 'ipo-steamhouse',
      tableName: 'ipos',
      fieldName: 'leadManagers',
      source: 'BSE',
      previousSource: null,
    });
  });

  it('carries the previousSource forward when a provenance row already exists', async () => {
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      previousSource: 'MONEYCONTROL',
    });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    expect(fieldSourcesRows[0]).toMatchObject({ source: 'NSE', previousSource: 'MONEYCONTROL' });
  });

  it('MODERATE TOCTOU fix: a concurrent value already stored blocks the write via the SQL WHERE guard, not a stale pre-read', async () => {
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({
      simulatedStoredLeadManagers: ['ADMIN Set Bank Limited'],
    });
    const ipoRepository = fakeIpoRepository();

    const result = await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['Some Other Bank Limited'],
      'BSE',
      dbLike as never
    );

    expect(result).toEqual({ written: false });
    expect(fieldSourcesRows).toHaveLength(0); // no provenance row for a write that never happened
  });

  it('writes nothing when the discovered names are absent or sanitize away to nothing (no transaction opened)', async () => {
    const { dbLike } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const txSpy = vi.spyOn(dbLike, 'transaction');
    const ipoRepository = fakeIpoRepository();

    expect(
      await recordDiscoveredLeadManagers(ipoRepository as never, 'ipo-1', [], 'BSE', dbLike as never)
    ).toEqual({ written: false });
    expect(
      await recordDiscoveredLeadManagers(ipoRepository as never, 'ipo-1', null, 'BSE', dbLike as never)
    ).toEqual({ written: false });
    // A bare contact fragment with no legal-entity keyword sanitizes to nothing.
    expect(
      await recordDiscoveredLeadManagers(ipoRepository as never, 'ipo-1', ['Rahul Sharma'], 'BSE', dbLike as never)
    ).toEqual({
      written: false,
    });
    expect(txSpy).not.toHaveBeenCalled();
    expect(ipoRepository.invalidateIpoCache).not.toHaveBeenCalled();
  });
});

/**
 * T-513 / #419 (PR #417 review): `recordDiscoveredLeadManagers` writes
 * `leadManagers` drizzle-direct inside its own transaction and never told the
 * cache layer, so `IPO_DETAIL`/`IPO_LIST` kept serving the pre-write value
 * for up to 900s after a successful write. The sibling `recordBseDiscoveryMetadata`
 * does not have this bug because it writes via `ipoRepository.update()`,
 * which invalidates as a side effect.
 */
describe('T-513 / #419 — recordDiscoveredLeadManagers invalidates the IPO cache', () => {
  it('invalidates the IPO cache for this ipoId/slug after a successful write', async () => {
    const { leadManagers } = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    const { dbLike } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      slug: 'steamhouse-india',
    });
    const ipoRepository = fakeIpoRepository();

    const result = await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-steamhouse',
      leadManagers,
      'BSE',
      dbLike as never
    );

    expect(result).toEqual({ written: true });
    expect(ipoRepository.invalidateIpoCache).toHaveBeenCalledTimes(1);
    expect(ipoRepository.invalidateIpoCache).toHaveBeenCalledWith('ipo-steamhouse', 'steamhouse-india');
  });

  it('does NOT invalidate the cache when the write-once guard blocks the write (nothing changed to invalidate)', async () => {
    const { dbLike } = fakeTransactionalDb({
      simulatedStoredLeadManagers: ['ADMIN Set Bank Limited'],
    });
    const ipoRepository = fakeIpoRepository();

    const result = await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['Some Other Bank Limited'],
      'BSE',
      dbLike as never
    );

    expect(result).toEqual({ written: false });
    expect(ipoRepository.invalidateIpoCache).not.toHaveBeenCalled();
  });

  it('a cache-invalidation failure (Redis down) never fails the write — logged, swallowed, written:true still returned', async () => {
    const { leadManagers } = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    const { dbLike } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      slug: 'steamhouse-india',
    });
    const ipoRepository = {
      invalidateIpoCache: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    };

    const result = await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-steamhouse',
      leadManagers,
      'BSE',
      dbLike as never
    );

    // The row write (and its field_sources provenance) already committed
    // inside the transaction before invalidateIpoCache was ever called — a
    // cache-layer failure here must not be reported as a write failure.
    expect(result).toEqual({ written: true });
    expect(ipoRepository.invalidateIpoCache).toHaveBeenCalledTimes(1);
  });
});

/**
 * MAJOR 2 (Tier A round 2 on #1072): `recordDiscoveredLeadManagers`'s `field_sources`
 * onConflictDoUpdate for `leadManagers` set `dataLineage: sourceKeyLineageFor(ipoId) ?? null` —
 * a plain object (or plain `null`) that REPLACES the whole jsonb column on conflict, destroying
 * whatever docType/other keys an earlier write on this SAME (ipo, table, row) had set. Same class
 * as #755/#753/#1065/#1068. RED before the fix: `set.dataLineage` is the caller's raw value with
 * no reference to the existing column. Fix must be null-safe: `sourceKeyLineageFor` legitimately
 * returns `null` (this write carries no source-key binding), and in that case the existing column
 * value MUST be kept, never overwritten with NULL.
 *
 * Note: the ON CONFLICT target's column count is fixed by #1074 (see the describe block below);
 * NOT this fix's target.
 */
describe('recordDiscoveredLeadManagers — field_sources dataLineage MERGE, never replace (MAJOR 2, #1072 round 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function sqlText(expr: unknown): string {
    return new PgDialect().sqlToQuery(expr as SQL).sql;
  }

  it('a source-key-bound write merges via SQL over the EXISTING column, preserving prior keys', async () => {
    vi.mocked(sourceKeyLineageFor).mockReturnValue({ sourceKeyIds: ['sk-1', 'sk-2'] });
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    const lineage = fieldSourcesRows[0]!.dataLineage;
    const isPlainObject =
      lineage !== null &&
      typeof lineage === 'object' &&
      !('queryChunks' in (lineage as object)) &&
      !('sql' in (lineage as object));
    expect(isPlainObject).toBe(false);
    expect(sqlText(lineage)).toMatch(/COALESCE\("field_sources"\."data_lineage",\s*'\{\}'::jsonb\)\s*\|\|/i);
  });

  it('a write with NO source-key lineage (sourceKeyLineageFor returns null) does not overwrite the existing column with NULL', async () => {
    vi.mocked(sourceKeyLineageFor).mockReturnValue(null);
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    const lineage = fieldSourcesRows[0]!.dataLineage;
    // A bare `null` here would REPLACE the column, wiping any existing dataLineage. The fix must
    // pass a SQL expression that keeps the existing column value instead.
    expect(lineage).not.toBeNull();
    expect(sqlText(lineage)).toMatch(/"field_sources"\."data_lineage"/i);
    expect(sqlText(lineage)).not.toMatch(/null::jsonb/i);
  });
});

/**
 * #1074 — the only unique index on `field_sources` is `unique_field_source_per_ipo`, on
 * (ipo_id, table_name, row_key, field_name) (packages/shared/src/db/schema.ts). Postgres 42P10
 * ("there is no unique or exclusion constraint matching the ON CONFLICT specification") fires
 * when an `onConflictDoUpdate` target names a column list that does not exactly match an
 * existing unique index/constraint — a 3-column target (ipoId, tableName, fieldName) is such a
 * list. Real evidence (ipodhan_staging pm2 logs, 2026-09-26): 18 "Failed to record discovered
 * lead managers (non-fatal)" warnings for 9 IPOs; 7 of them
 * (axiom-gas-engineering-ltd, bench-mark-infotech-services-ltd,
 * coreintegra-consulting-services-ltd, green-asia-impex-ltd, himalayan-solar-ltd,
 * pooja-logistics-ltd, spectraa-technology-solutions-ltd) have `lead_managers` NULL and no
 * `field_sources` provenance row — the transaction rolled back on 42P10 every time. The insert
 * ALSO omitted `rowKey` from `.values()`, which is safe only because the column defaults to ''
 * (matching every other row-scoped `field_sources` writer, e.g. `corrigendum-suggestions.ts`),
 * but is asserted explicitly here so a future column-default change cannot silently reintroduce
 * this class.
 */
describe('recordDiscoveredLeadManagers — field_sources ON CONFLICT target matches the unique index (#1074)', () => {
  function sqlText(expr: unknown): { sql: string; params: unknown[] } {
    const q = new PgDialect().sqlToQuery(expr as SQL);
    return { sql: q.sql, params: q.params };
  }

  it("upserts with an ON CONFLICT target of exactly [ipoId, tableName, rowKey, fieldName] — matching unique_field_source_per_ipo", async () => {
    const { dbLike, onConflictArgs } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    expect(onConflictArgs).toHaveLength(1);
    const target = onConflictArgs[0]!.target as Array<{ name?: string }>;
    expect(target.map((c) => c.name)).toEqual(['ipo_id', 'table_name', 'row_key', 'field_name']);
  });

  it("passes rowKey: '' explicitly on the insert values, matching every other row-scoped field_sources writer", async () => {
    const { dbLike, insertCalls } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ rowKey: '' });
  });

  it("filters the previous-provenance-row lookup by rowKey = '' (not just ipoId/tableName/fieldName)", async () => {
    const { dbLike, selectWhereArgs } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      previousSource: 'MONEYCONTROL',
    });
    const ipoRepository = fakeIpoRepository();

    await recordDiscoveredLeadManagers(
      ipoRepository as never,
      'ipo-1',
      ['NSE Broker Securities Limited'],
      'NSE',
      dbLike as never
    );

    expect(selectWhereArgs).toHaveLength(1);
    const { sql, params } = sqlText(selectWhereArgs[0]);
    expect(sql).toMatch(/"row_key"/i);
    expect(params).toContain('');
  });
});
