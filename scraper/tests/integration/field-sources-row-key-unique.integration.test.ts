// implements: item 1 slice s18 — field_sources unique key is row-scoped
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias — same reason as
// field-sources-row-key-provenance.integration.test.ts: a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout,
// which does not carry this slice's edits.
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourcesRepository as SharedFieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
// The web copy is a byte-parallel repository that the Next.js app and
// web/tests/integration/data-flow/* actually consume. It carries its own
// ON CONFLICT target, so it needs its own coverage or a regression there
// passes every check in pr-gate.yml.
import { FieldSourcesRepository as WebFieldSourcesRepository } from '../../../web/lib/repositories/field-sources-repository';

/**
 * Item 1 slice s18 — the constraint swap slice s3 (#459) deferred.
 *
 * THE CLASS: every (ipo, child table) pair that will ever hold more than one
 * row — financial_statements, promoters, ipo_intermediaries, peer_companies,
 * ipo_risk_factors — across all statuses, both segments, all sources, both
 * slots, for rows written before and after this change. Under the old 3-column
 * `unique_field_source_per_ipo` (ipo_id, table_name, field_name), two rows of
 * one child table writing the SAME field for one IPO collide, and
 * trackFieldUpdate's `set` clause replaces `source`, `confidence` and
 * `data_lineage` — row B destroys row A's provenance and takes its place.
 *
 * Widening a unique key strictly WEAKENS it: every row set satisfying
 * unique(a,b,d) also satisfies unique(a,b,c,d). Verified read-only before the
 * swap: zero duplicate groups under the widened key on ipodhan_staging
 * (8,092 rows) and on ipodhan_test.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-sources-row-key-unique.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
// The describe-name label. It MUST tell the truth about whether these tests
// actually ran: this is the place CI logs are scanned for coverage evidence,
// and a constant skip reason interpolated unconditionally made 24 green tests
// announce "DATABASE_URL not set" while running against a real Postgres
// (round-2 review). Reports `live` when a database IS configured.
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-1-slice-s18: SKIPPED — DATABASE_URL not set';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

type RepoCtor = new (db: unknown, redis: unknown) => SharedFieldSourcesRepository;

const VARIANTS: Array<{ label: string; RepoClass: RepoCtor; ipoId: string; slug: string }> = [
  {
    label: 'shared (@ipodhan/shared package)',
    RepoClass: SharedFieldSourcesRepository as unknown as RepoCtor,
    ipoId: '00000000-0000-4000-8000-0000000158c1',
    slug: 's18-row-key-unique-shared',
  },
  {
    label: 'web (web/lib byte-parallel copy)',
    RepoClass: WebFieldSourcesRepository as unknown as RepoCtor,
    ipoId: '00000000-0000-4000-8000-0000000158c2',
    slug: 's18-row-key-unique-web',
  },
];

describe.each(VARIANTS)(
  'field_sources row-scoped unique key — $label',
  ({ RepoClass, ipoId: IPO_ID, slug }) => {
    let pool: Pool | null = null;
    let repo: SharedFieldSourcesRepository | null = null;

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
      repo = new RepoClass(db as never, noRedis);

      await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
      await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
      await db.execute(sql`
        INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
        VALUES (${IPO_ID}::uuid, 'S18 RowKey Unique Fixture Ltd.', ${slug}, 'MAINBOARD', 'OPEN', '2026-09-08', '2026-09-10')
      `);
    }, 30000);

    afterAll(async () => {
      if (!pool) return;
      const db = drizzle(pool, { schema });
      await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
      await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
      await pool.end();
    }, 30000);

    describe.skipIf(!DATABASE_URL)(`(${RUN_LABEL})`, () => {
      it('THE CLASS: two rows of one child table, different row keys, SAME field — both keep their own source, confidence and lineage', async () => {
        const fy24 = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'financial_statements',
          rowKey: 'FY2024',
          fieldName: 'revenue',
          source: 'DRHP',
          confidence: 90,
          dataLineage: { method: 'SCRAPE', endpoint: '/drhp/fy2024' } as never,
        });
        const fy25 = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'financial_statements',
          rowKey: 'FY2025',
          fieldName: 'revenue',
          source: 'NSE',
          confidence: 70,
          dataLineage: { method: 'API', endpoint: '/nse/fy2025' } as never,
        });

        // Two DISTINCT rows — under the old 3-column key the second write
        // UPDATED the first row and FY2024's provenance was destroyed.
        expect(fy25.id).not.toBe(fy24.id);

        const rows = (await repo!.findByTable(IPO_ID, 'financial_statements')).filter(
          (r) => r.fieldName === 'revenue'
        );
        expect(rows.length).toBe(2);

        const byKey = new Map(rows.map((r) => [r.rowKey, r]));
        expect(byKey.get('FY2024')!.source).toBe('DRHP');
        expect(byKey.get('FY2024')!.confidence).toBe(90);
        expect((byKey.get('FY2024')!.dataLineage as { endpoint: string }).endpoint).toBe(
          '/drhp/fy2024'
        );
        expect(byKey.get('FY2025')!.source).toBe('NSE');
        expect(byKey.get('FY2025')!.confidence).toBe(70);
        expect((byKey.get('FY2025')!.dataLineage as { endpoint: string }).endpoint).toBe(
          '/nse/fy2025'
        );

        // Both remain independently addressable.
        expect(
          (await repo!.findByField(IPO_ID, 'financial_statements', 'revenue', 'FY2024'))?.source
        ).toBe('DRHP');
        expect(
          (await repo!.findByField(IPO_ID, 'financial_statements', 'revenue', 'FY2025'))?.source
        ).toBe('NSE');
      });

      it('the constraint STILL constrains: same field, SAME non-empty row key, two writes — one row, updated', async () => {
        const first = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'promoters',
          rowKey: 'PROMOTER_ONE',
          fieldName: 'shareholdingPct',
          source: 'DRHP',
          confidence: 80,
        });
        const second = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'promoters',
          rowKey: 'PROMOTER_ONE',
          fieldName: 'shareholdingPct',
          source: 'NSE',
          confidence: 95,
        });

        expect(second.id).toBe(first.id);
        expect(second.source).toBe('NSE');
        expect(second.confidence).toBe(95);

        const rows = (await repo!.findByTable(IPO_ID, 'promoters')).filter(
          (r) => r.fieldName === 'shareholdingPct'
        );
        expect(rows.length).toBe(1);
        expect(rows[0].source).toBe('NSE');
      });

      it("singleton tables are unaffected: rowKey omitted twice still resolves to one row", async () => {
        const first = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          fieldName: 'faceValue',
          source: 'DRHP',
          confidence: 80,
        });
        const second = await repo!.trackFieldUpdate({
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          fieldName: 'faceValue',
          source: 'NSE',
          confidence: 95,
        });

        expect(first.rowKey).toBe('');
        expect(second.rowKey).toBe('');
        expect(second.id).toBe(first.id);

        const rows = (await repo!.findByTable(IPO_ID, 'ipo_details')).filter(
          (r) => r.fieldName === 'faceValue'
        );
        expect(rows.length).toBe(1);
      });
    });
  }
);

describe.skipIf(!DATABASE_URL)(`field_sources LIVE constraint shape (${RUN_LABEL})`, () => {
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

  it('unique_field_source_per_ipo covers exactly (ipo_id, table_name, row_key, field_name) in that order', async () => {
    const { rows } = await pool!.query<{ def: string }>(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'field_sources'::regclass AND conname = 'unique_field_source_per_ipo'
    `);

    expect(rows.length).toBe(1);
    expect(rows[0].def).toBe('UNIQUE (ipo_id, table_name, row_key, field_name)');
  });

  it('data_conflicts still has no unique constraint — nothing to widen there', async () => {
    const { rows } = await pool!.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'data_conflicts'::regclass AND contype = 'u'
    `);
    expect(rows.map((r) => r.conname)).toEqual([]);
  });
});
