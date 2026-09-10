// implements: R-158
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias — a worktree's junctioned
// node_modules resolves the alias back to the PRIMARY checkout, which does not
// carry this slice's edits (see the same note in
// child-table-row-key-unique-constraint.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationOrchestrator } from '../../src/services/data-consolidation-orchestrator';
import { financialStatementsRowKey } from '../../src/services/child-row-keys';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';

/**
 * Item 1 slice s5b — the REAL-DATABASE proof for the consolidated child-row
 * writer on `financial_statements`.
 *
 * A unit test with an in-memory `field_sources` cannot prove the thing that
 * actually matters here: that two fiscal years of ONE IPO keep two SEPARATE
 * provenance rows in Postgres. Before #559 widened
 * `unique_field_source_per_ipo` to (ipo_id, table_name, row_key, field_name),
 * FY2023's `revenue` provenance and FY2024's were the same row and the second
 * write destroyed the first. That constraint is a property of the database,
 * so the proof has to run against one.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/child-row-consolidation-financials.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-1 slice s5b: SKIPPED — DATABASE_URL not set';
const IPO_ID = '00000000-0000-4000-8000-00000005b001';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

let pool: Pool | null = null;
let orchestrator: DataConsolidationOrchestrator | null = null;

const savedFlags: Record<string, unknown> = {};

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
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'S5B Financials Fixture Ltd.', 's5b-financials-fixture-ltd', 'SME', 'OPEN', '2026-09-08', '2026-09-10')
  `);

  orchestrator = new DataConsolidationOrchestrator(
    {} as never,
    new FieldSourcesRepository(db as never, noRedis) as never,
    new DataConflictsRepository(db as never, noRedis) as never,
    null
  );
}, 30000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
}, 30000);

beforeEach(async () => {
  for (const k of [
    'ENABLE_CHILD_TABLE_CONSOLIDATION',
    'ENABLE_DATA_CONSOLIDATION',
    'ENABLE_SOURCE_TRACKING',
    'CONSOLIDATION_PERCENTAGE',
  ]) {
    if (!(k in savedFlags)) savedFlags[k] = (FEATURE_FLAGS as never as Record<string, unknown>)[k];
  }
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  f.ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  // 0 would route every consolidation into the fallback (no resolution, no
  // provenance) — the rollout precondition this flag depends on.
  f.CONSOLIDATION_PERCENTAGE = 100;

  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
});

async function financialProvenance(rowKey: string, fieldName: string) {
  const db = drizzle(pool!, { schema });
  const rows = await db
    .select()
    .from(schema.fieldSources)
    .where(
      and(
        eq(schema.fieldSources.ipoId, IPO_ID),
        eq(schema.fieldSources.tableName, 'financial_statements'),
        eq(schema.fieldSources.rowKey, rowKey),
        eq(schema.fieldSources.fieldName, fieldName)
      )
    );
  return rows[0] ?? null;
}

describe.skipIf(!DATABASE_URL)(`consolidatedUpsertChildRows on financial_statements (${RUN_LABEL})`, () => {
  it('two fiscal years keep TWO separate provenance rows for the same field name', async () => {
    const fy23 = financialStatementsRowKey(2023, 'RESTATED')!;
    const fy24 = financialStatementsRowKey(2024, 'RESTATED')!;

    await orchestrator!.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [
        { rowKey: fy23, data: { revenue: '300.00' } },
        { rowKey: fy24, data: { revenue: '450.00' } },
      ],
      'DRHP',
      'RHP'
    );

    const a = await financialProvenance(fy23, 'revenue');
    const b = await financialProvenance(fy24, 'revenue');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
    expect(a!.rowKey).toBe('2023:RESTATED');
    expect(b!.rowKey).toBe('2024:RESTATED');
    expect(a!.source).toBe('DRHP');
  });

  it('the higher-ranked source wins the VALUE regardless of arrival order', async () => {
    const rowKey = financialStatementsRowKey(2024, 'RESTATED')!;

    // Low-ranked source first...
    await orchestrator!.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '999.00' } }],
      'CHITTORGARH'
    );
    // ...then the higher-ranked one: it must take the field.
    const drhpLast = await orchestrator!.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '450.00' }, existingData: { revenue: '999.00' } }],
      'DRHP'
    );
    expect(drhpLast.rows[0].consolidatedData.revenue).toBe('450.00');
    expect((await financialProvenance(rowKey, 'revenue'))!.source).toBe('DRHP');

    // ...and the reverse order must reach the SAME value: rank, not recency.
    const chitLast = await orchestrator!.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '999.00' }, existingData: { revenue: '450.00' } }],
      'CHITTORGARH'
    );
    expect(chitLast.rows[0].consolidatedData.revenue).toBe('450.00');
    expect((await financialProvenance(rowKey, 'revenue'))!.source).toBe('DRHP');
  });

  it('a keyless row writes NOTHING — it is never filed under the singleton sentinel', async () => {
    const result = await orchestrator!.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey: '', data: { revenue: '450.00' } }],
      'DRHP'
    );
    expect(result.rowsSkipped).toBe(1);

    const db = drizzle(pool!, { schema });
    const all = await db
      .select()
      .from(schema.fieldSources)
      .where(
        and(
          eq(schema.fieldSources.ipoId, IPO_ID),
          eq(schema.fieldSources.tableName, 'financial_statements')
        )
      );
    expect(all).toHaveLength(0);
  });
});
