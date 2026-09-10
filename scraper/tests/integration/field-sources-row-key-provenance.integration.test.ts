// implements: R-158
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative import, NOT the `@ipodhan/shared` package alias — see the same note
// in child-table-normalized-name.integration.test.ts and
// child-table-row-key-unique-constraint.integration.test.ts (worktree
// node_modules junctions resolve the alias back to the PRIMARY checkout, which
// does not yet carry this slice's edits).
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourcesRepository as SharedFieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
// The web copy is a BYTE-PARALLEL repository (same class, same line numbers)
// that the Next.js app and `web/tests/integration/data-flow/*` actually
// consume. It is NOT the `@ipodhan/shared` package — it is
// `web/lib/repositories/field-sources-repository.ts`, a separate file that
// happens to carry the same fix. Round-2 review (MAJOR-A) found this suite
// only ever exercised the shared copy, so a regression dropped from the web
// copy alone would pass every check in `pr-gate.yml`. Import it directly
// (it resolves via `@ipodhan/shared/db/schema` + relative imports, no `@/`
// alias needed for this call chain — verified against this suite's own
// `@web`/`@shared`/`@`-aliased vitest config) and run every case below
// against BOTH classes via `describe.each`.
import { FieldSourcesRepository as WebFieldSourcesRepository } from '../../../web/lib/repositories/field-sources-repository';

/**
 * Item 1 slice s3 (pull-model implementation loop) — RE-SCOPED after Tier A
 * review found the original design created a broken window: the slice put
 * the `field_sources` unique-constraint swap in a hand-applied gated file
 * while the repository's upsert already targeted the WIDER (4-column) key.
 * Between a merge and an operator applying the gate, every `ON CONFLICT`
 * named a constraint that did not exist (Postgres 42P10) — and two other
 * upsert paths this diff never touched (`ipo-repository.ts`'s duplicate-IPO
 * merge, `scraper/scripts/lib/repair-tool.ts`) would have broken the OTHER
 * way once the gate WAS applied. See docs/ops/prod-ops-recipes.md §8c-note
 * for the full deferred-work list.
 *
 * THIS SLICE NOW ONLY: adds the `row_key` column (NOT NULL DEFAULT ''),
 * threads it through `trackFieldUpdate` / `findByField` / cache keys, and
 * fixes the `delete()` path to filter on it. It does NOT widen the unique
 * constraint and does NOT retarget `ON CONFLICT` — the repository's upsert
 * target is unchanged from `origin/main` (3-column
 * `unique_field_source_per_ipo`), so two different `row_key`s for the SAME
 * (ipo_id, table_name, field_name) still collide on that constraint and the
 * second write overwrites the first. Proving that TWO rows of one table can
 * each keep separate provenance is the NEXT slice's job, once the
 * constraint swap ships together with the code that depends on it — that
 * proof does not belong here.
 *
 * Round-2 fix round (Tier A, this file): two MAJORs closed.
 * - MAJOR-A: every case below now runs once per repository copy (`shared`,
 *   `web`) via `describe.each`, so a regression in either copy's `set`
 *   clause, cache key, or WHERE filter fails this suite.
 * - MAJOR-C: because the `ON CONFLICT` target is the 3-column
 *   (ipoId, tableName, fieldName) triple — rowKey is NOT part of it — at
 *   most one row exists per that triple. `trackFieldUpdate` now reads the
 *   row's CURRENT rowKey before writing and invalidates the cache entry
 *   under BOTH the old and new rowKey, closing the window where a rowKey
 *   change (A -> B) left the stale `...:A:...` cache entry unreachable but
 *   still served for the rest of CacheTTL. Proven below with a REAL
 *   in-memory Redis stand-in (`FakeRedis`) that genuinely stores/returns
 *   values — the pre-existing `noRedis` stub always misses, so it could
 *   never have caught this class of bug.
 *
 * UPDATED BY SLICE s18: the constraint swap this file's header calls "the NEXT
 * slice's job" has now landed — `unique_field_source_per_ipo` is
 * (ipo_id, table_name, row_key, field_name) and the repositories' ON CONFLICT
 * target matches it. Everything above describing a 3-column target is a record
 * of what s3 shipped, not of current behaviour. Two cases here pinned that
 * deferred behaviour and were rewritten to the new contract (see their bodies);
 * the class proof itself lives in
 * field-sources-row-key-unique.integration.test.ts.
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     REDIS_URL=redis://localhost:6379 \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-sources-row-key-provenance.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'item-1-slice-s3: DATABASE_URL not set';

/** A Redis-shaped no-op — every getFromCache call misses, so behavior can
 *  also be proven against the real query alone when a test wants that. */
const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

/**
 * A minimal REAL in-memory Redis stand-in — genuinely stores and returns
 * values, unlike `noRedis` above. MAJOR-C needs this: a stub that always
 * misses can never observe stale-cache behavior, because every read goes
 * straight to the database. This fake implements exactly the surface
 * `BaseRepository` calls (get/set/setex/del/keys).
 */
class FakeRedis {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async setex(key: string, _ttlSeconds: number, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${escaped}$`);
    return [...this.store.keys()].filter((k) => re.test(k));
  }
}

/** getFromCache's cache-populating write is fire-and-forget (not awaited),
 *  so tests that read-then-write must give it a tick to land before the
 *  next assertion, or they'll race the in-memory store's own `set`. */
const flushFireAndForgetCacheWrite = () => new Promise((resolve) => setTimeout(resolve, 20));

type RepoCtor = new (db: unknown, redis: unknown) => SharedFieldSourcesRepository;

const VARIANTS: Array<{ label: string; RepoClass: RepoCtor; ipoId: string; slug: string }> = [
  {
    label: 'shared (@ipodhan/shared package)',
    RepoClass: SharedFieldSourcesRepository as unknown as RepoCtor,
    ipoId: '00000000-0000-4000-8000-0000000158b3',
    slug: 's3-row-key-fixture-shared',
  },
  {
    label: 'web (web/lib byte-parallel copy)',
    RepoClass: WebFieldSourcesRepository as unknown as RepoCtor,
    ipoId: '00000000-0000-4000-8000-0000000158b4',
    slug: 's3-row-key-fixture-web',
  },
];

describe.each(VARIANTS)('field_sources row_key provenance — $label', ({ RepoClass, ipoId: IPO_ID, slug }) => {
  let pool: Pool | null = null;
  let repo: SharedFieldSourcesRepository | null = null;
  let fakeRedis: FakeRedis;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });

    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }

    const db = drizzle(pool, { schema });
    fakeRedis = new FakeRedis();
    repo = new RepoClass(db as never, fakeRedis as never);

    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S3RowKey Fixture Ltd.', ${slug}, 'MAINBOARD', 'OPEN', '2026-09-08', '2026-09-10')
    `);
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    const db = drizzle(pool, { schema });
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
  }, 30000);

  describe.skipIf(!DATABASE_URL)(`(${SKIP_REASON})`, () => {
    it('the row_key column exists and defaults to \'\' when omitted', async () => {
      const row = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipos',
        fieldName: 'issueSize',
        source: 'NSE',
        confidence: 100,
      });

      expect(row.rowKey).toBe('');
    });

    it('trackFieldUpdate writes a supplied rowKey', async () => {
      const row = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_valuation',
        rowKey: 'PRICE_BAND_AD',
        fieldName: 'peRatio',
        source: 'DRHP',
        confidence: 85,
      });

      expect(row.rowKey).toBe('PRICE_BAND_AD');

      const rows = await repo!.findByTable(IPO_ID, 'ipo_valuation');
      const peRatioRow = rows.find((r) => r.fieldName === 'peRatio');
      expect(peRatioRow?.rowKey).toBe('PRICE_BAND_AD');
    });

    it('findByField filters on rowKey — a wrong rowKey misses even though a row exists under a different one', async () => {
      await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_risk_factors',
        rowKey: 'RISK_SECTION_A',
        fieldName: 'riskText',
        source: 'DRHP',
        confidence: 80,
      });

      const matched = await repo!.findByField(IPO_ID, 'ipo_risk_factors', 'riskText', 'RISK_SECTION_A');
      const wrongKey = await repo!.findByField(IPO_ID, 'ipo_risk_factors', 'riskText', 'RISK_SECTION_B');
      const omittedKey = await repo!.findByField(IPO_ID, 'ipo_risk_factors', 'riskText');

      expect(matched?.rowKey).toBe('RISK_SECTION_A');
      // The row was written WITH a rowKey, so a query that omits it (defaults
      // to '') or asks for a different key must NOT match it.
      expect(wrongKey).toBeNull();
      expect(omittedKey).toBeNull();
    });

    it('a singleton table with rowKey omitted still resolves to \'\' and behaves exactly as before', async () => {
      const first = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_details',
        fieldName: 'faceValue',
        source: 'DRHP',
        confidence: 80,
      });
      expect(first.rowKey).toBe('');

      // A second write for the same field, still no rowKey passed, must UPDATE
      // the same row (the singleton convention — and the unchanged 3-column
      // ON CONFLICT target), not create a second one.
      const second = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_details',
        fieldName: 'faceValue',
        source: 'NSE',
        confidence: 95,
      });
      expect(second.rowKey).toBe('');
      expect(second.id).toBe(first.id);

      const rows = await repo!.findByTable(IPO_ID, 'ipo_details');
      const faceValueRows = rows.filter((r) => r.fieldName === 'faceValue');
      expect(faceValueRows.length).toBe(1);
      expect(faceValueRows[0].source).toBe('NSE');
    });

    it('delete() filters on rowKey — a wrong rowKey is a no-op, the right one deletes exactly that row', async () => {
      // Two DIFFERENT fields, so both writes land as two SEPARATE rows even
      // under the unchanged 3-column ON CONFLICT target (no collision here —
      // the point is to isolate what the rowKey filter in delete()'s WHERE
      // clause does, not to re-litigate the upsert target).
      await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'promoters',
        rowKey: 'PROMOTER_ONE',
        fieldName: 'promoterName',
        source: 'DRHP',
        confidence: 80,
      });
      await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'promoters',
        rowKey: 'PROMOTER_TWO',
        fieldName: 'promoterAddress',
        source: 'DRHP',
        confidence: 80,
      });

      // Deleting with the WRONG rowKey for 'promoterName' must be a no-op —
      // this is the assertion that fails without the rowKey filter (the
      // pre-fix delete() had no rowKey column in its WHERE clause at all, so
      // ANY rowKey argument deleted the row regardless of which key it named).
      const deletedWrongKey = await repo!.delete(IPO_ID, 'promoters', 'promoterName', 'PROMOTER_TWO');
      expect(deletedWrongKey).toBe(false);

      const stillThere = await repo!.findByField(IPO_ID, 'promoters', 'promoterName', 'PROMOTER_ONE');
      expect(stillThere).not.toBeNull();

      const deletedRightKey = await repo!.delete(IPO_ID, 'promoters', 'promoterName', 'PROMOTER_ONE');
      expect(deletedRightKey).toBe(true);

      const gone = await repo!.findByField(IPO_ID, 'promoters', 'promoterName', 'PROMOTER_ONE');
      expect(gone).toBeNull();

      // The sibling field's row (a different rowKey and fieldName) is untouched.
      const siblingUntouched = await repo!.findByField(IPO_ID, 'promoters', 'promoterAddress', 'PROMOTER_TWO');
      expect(siblingUntouched).not.toBeNull();
    });

    it('two rowKeys for one field are two INDEPENDENT rows — s18 closed the s3 MAJOR-2 window structurally', async () => {
      // s3 shipped this case against the 3-column ON CONFLICT target, where a
      // second rowKey UPDATED the first row and the assertion it could make
      // was only "the updated row must not mix the new source with a stale
      // row_key". Slice s18 widened `unique_field_source_per_ipo` to
      // (ipo_id, table_name, row_key, field_name), so the mixing window no
      // longer exists at all: a different rowKey is a different row. This case
      // now pins the stronger contract it was always a stand-in for.
      const first = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_financials',
        rowKey: 'A',
        fieldName: 'revenue',
        source: 'DRHP',
        confidence: 80,
      });
      expect(first.rowKey).toBe('A');

      const second = await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_financials',
        rowKey: 'B',
        fieldName: 'revenue',
        source: 'NSE',
        confidence: 95,
      });
      expect(second.id).not.toBe(first.id);
      expect(second.rowKey).toBe('B');
      expect(second.source).toBe('NSE');

      const byNewKey = await repo!.findByField(IPO_ID, 'ipo_financials', 'revenue', 'B');
      expect(byNewKey?.rowKey).toBe('B');
      expect(byNewKey?.source).toBe('NSE');

      // 'A' is NOT stale any more — it is its own row, with its own
      // provenance, which the 'B' write must not have touched. That is the
      // whole point of the slice.
      const byOldKey = await repo!.findByField(IPO_ID, 'ipo_financials', 'revenue', 'A');
      expect(byOldKey?.rowKey).toBe('A');
      expect(byOldKey?.source).toBe('DRHP');
      expect(byOldKey?.confidence).toBe(80);
    });

    it('a per-rowKey cache entry stays TRUE when a sibling rowKey is written — s18 removed the stale-old-key window', async () => {
      // s3's MAJOR-C guarded a window created by the 3-column ON CONFLICT
      // target: an upsert could move a row from rowKey A to rowKey B, leaving
      // the warm `...:A:...` cache entry pointing at a row that no longer
      // described that key. Slice s18 put rowKey INSIDE the conflict target,
      // so a row can never change its rowKey — the window is gone by
      // construction, not by compensating invalidation. What must now hold is
      // that a sibling write does not corrupt or evict the other key's truth.
      await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_gmp_cache_check',
        rowKey: 'CACHE_A',
        fieldName: 'gmpValue',
        source: 'DRHP',
        confidence: 70,
      });

      // Read it under 'CACHE_A' — this populates the REAL (FakeRedis) cache
      // entry `field-source:{ipo}:ipo_gmp_cache_check:CACHE_A:gmpValue`.
      const warmed = await repo!.findByField(IPO_ID, 'ipo_gmp_cache_check', 'gmpValue', 'CACHE_A');
      expect(warmed?.rowKey).toBe('CACHE_A');
      // getFromCache's cache-populating write is fire-and-forget — give it a
      // tick to land before the next write, so the cache is genuinely warm.
      await flushFireAndForgetCacheWrite();

      // Now the SAME field is written under a DIFFERENT rowKey. Under the
      // widened 4-column target this INSERTs a second, independent row rather
      // than moving the first one.
      await repo!.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipo_gmp_cache_check',
        rowKey: 'CACHE_B',
        fieldName: 'gmpValue',
        source: 'NSE',
        confidence: 90,
      });

      // DISCRIMINATING ASSERTION (review MINOR): read the table DIRECTLY,
      // bypassing the repository and its cache. Under the old 3-column target
      // the CACHE_B write UPDATED the CACHE_A row, so exactly ONE row existed
      // and the cached CACHE_A read below still returned DRHP/70 from the
      // stale entry — every assertion after this point passed for the wrong
      // reason. Two rows in the table is the fact only the widened key can
      // produce, and it cannot be faked by a warm cache.
      const { rows: liveRows } = await pool!.query<{ row_key: string; source: string }>(
        `SELECT row_key, source FROM field_sources
          WHERE ipo_id = $1 AND table_name = 'ipo_gmp_cache_check' AND field_name = 'gmpValue'
          ORDER BY row_key`,
        [IPO_ID]
      );
      expect(liveRows.map((r) => [r.row_key, r.source])).toEqual([
        ['CACHE_A', 'DRHP'],
        ['CACHE_B', 'NSE'],
      ]);

      // The warm CACHE_A entry is still TRUE — its row was never touched by
      // the sibling write, so serving it from cache is correct, not stale.
      const byOldKey = await repo!.findByField(IPO_ID, 'ipo_gmp_cache_check', 'gmpValue', 'CACHE_A');
      expect(byOldKey?.rowKey).toBe('CACHE_A');
      expect(byOldKey?.source).toBe('DRHP');
      expect(byOldKey?.confidence).toBe(70);

      // And the new key resolves to its own fresh row.
      const byNewKey = await repo!.findByField(IPO_ID, 'ipo_gmp_cache_check', 'gmpValue', 'CACHE_B');
      expect(byNewKey?.rowKey).toBe('CACHE_B');
      expect(byNewKey?.source).toBe('NSE');
    });
  });
});

describe.skipIf(!DATABASE_URL)(`field_sources / data_conflicts index shape (${SKIP_REASON})`, () => {
  let pool: Pool | null = null;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    await pool.end();
  }, 30000);

  it('MAJOR-1: idx_field_sources_ipo_table_field covers exactly (ipo_id, table_name, row_key, field_name) in that order', async () => {
    const { rows } = await pool!.query<{ indexdef: string; columns: string[] }>(`
      SELECT
        pg_get_indexdef(i.indexrelid) AS indexdef,
        array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE c.relname = 'idx_field_sources_ipo_table_field'
      GROUP BY i.indexrelid
    `);

    expect(rows.length).toBe(1);
    expect(rows[0].columns).toEqual(['ipo_id', 'table_name', 'row_key', 'field_name']);
  });

  it('MAJOR-1: idx_data_conflicts_ipo_table_row covers exactly (ipo_id, table_name, row_key) in that order', async () => {
    const { rows } = await pool!.query<{ indexdef: string; columns: string[] }>(`
      SELECT
        pg_get_indexdef(i.indexrelid) AS indexdef,
        array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE c.relname = 'idx_data_conflicts_ipo_table_row'
      GROUP BY i.indexrelid
    `);

    expect(rows.length).toBe(1);
    expect(rows[0].columns).toEqual(['ipo_id', 'table_name', 'row_key']);
  });
});
