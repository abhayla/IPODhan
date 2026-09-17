import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's junctioned
// node_modules resolves the alias back to the PRIMARY checkout, which does not
// carry this slice's edits (see the same note in
// child-row-consolidation-financials.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationService } from '../../src/services/data-consolidation-service';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';

/**
 * Item 3 slice S1c review round 1 (MINOR-1) -- the PERSIST-LEVEL proof that an
 * incapable source is refused. `data-conflicts-repository-hold.integration.test.ts`
 * is UNCHANGED by this slice and only proves the repository accepts a
 * pre-built HOLD tuple; it says nothing about whether the writer ever
 * produces a `REJECTED_INCAPABLE_SOURCE` tuple against a REAL database. This
 * test drives the real `DataConsolidationService.consolidateIPOData` (never a
 * re-implementation) against `ipodhan_test`, with `ENABLE_POLICY_WRITER` on
 * and the `issue-size` group flipped (the live switchover.json state), and
 * asserts three things Postgres itself must show:
 *   (a) the stored `ipos.issue_size` value is unchanged by the incapable BSE
 *       write (stays at the pre-seeded CHITTORGARH value -- an incapable
 *       source must not win, the #728 class),
 *   (b) a `data_conflicts` row EXISTS with `resolution_reason =
 *       'REJECTED_INCAPABLE_SOURCE'`,
 *   (c) NO NEW `field_sources` row was written for (ipos, issueSize, BSE) --
 *       an incapable source never earns provenance. The pre-seeded
 *       CHITTORGARH provenance row is required so the repository's W-79
 *       same-source guard (source1===source2 on a truly EMPTY existing
 *       source collapses to a self-comparison and is silently skipped) does
 *       not mask the refusal path under test.
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     REDIS_URL=redis://localhost:6379 \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/incapable-source-refusal.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'S1c review round 1: SKIPPED -- DATABASE_URL not set';
const IPO_ID = '00000000-0000-4000-8000-000000051c01';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

let pool: Pool | null = null;
let service: DataConsolidationService | null = null;

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
  // MAINBOARD, with a stored issue_size sourced from CHITTORGARH -- a real,
  // already-provenanced value the incapable BSE write must not touch.
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, segment, open_date, close_date, issue_size)
    VALUES (${IPO_ID}::uuid, 'S1c Refusal Fixture Ltd.', 's1c-refusal-fixture-ltd', 'MAINBOARD', 'OPEN', 'MAINBOARD', '2026-09-08', '2026-09-10', 10000000000)
  `);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence)
    VALUES (${IPO_ID}::uuid, 'ipos', '', 'issueSize', 'CHITTORGARH', 90)
  `);

  service = new DataConsolidationService(
    new FieldSourcesRepository(db as never, noRedis) as never,
    new DataConflictsRepository(db as never, noRedis) as never
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
    'ENABLE_DATA_CONSOLIDATION',
    'ENABLE_SOURCE_TRACKING',
    'ENABLE_CONFLICT_DETECTION',
    'CONSOLIDATION_PERCENTAGE',
    'ENABLE_POLICY_WRITER',
  ]) {
    if (!(k in savedFlags)) savedFlags[k] = (FEATURE_FLAGS as never as Record<string, unknown>)[k];
  }
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  f.ENABLE_CONFLICT_DETECTION = true;
  f.CONSOLIDATION_PERCENTAGE = 100;
  f.ENABLE_POLICY_WRITER = true;

  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  // Re-seed provenance dropped by the delete above -- see beforeAll for why.
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence)
    VALUES (${IPO_ID}::uuid, 'ipos', '', 'issueSize', 'CHITTORGARH', 90)
  `);
});

describe.skipIf(!DATABASE_URL)(`incapable-source refusal persists to Postgres (${RUN_LABEL})`, () => {
  it('an incoming BSE ipos.issue_size against a CHITTORGARH-sourced stored value leaves the DB unchanged, records a data_conflicts row, and writes no new field_sources row', async () => {
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { issueSize: 7000000084 },
      existingData: { segment: 'MAINBOARD', issueSize: 10000000000 },
      source: 'BSE',
      confidence: 80,
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult?.conflictReason).toBe('REJECTED_INCAPABLE_SOURCE');
    // The stored value is kept untouched -- not overwritten by the incapable BSE value.
    expect(String(fieldResult?.finalValue)).toBe('10000000000');

    const db = drizzle(pool!, { schema });

    // (c): no NEW field_sources row for BSE on this (ipos, issueSize) -- only
    // the pre-seeded CHITTORGARH row is present.
    const sourceRows = await db
      .select()
      .from(schema.fieldSources)
      .where(
        and(
          eq(schema.fieldSources.ipoId, IPO_ID),
          eq(schema.fieldSources.tableName, 'ipos'),
          eq(schema.fieldSources.fieldName, 'issueSize')
        )
      );
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0].source).toBe('CHITTORGARH');

    // (b): a data_conflicts row exists with the refusal reason.
    const conflictRows = await db
      .select()
      .from(schema.dataConflicts)
      .where(
        and(
          eq(schema.dataConflicts.ipoId, IPO_ID),
          eq(schema.dataConflicts.tableName, 'ipos'),
          eq(schema.dataConflicts.fieldName, 'issueSize'),
          eq(schema.dataConflicts.resolutionReason, 'REJECTED_INCAPABLE_SOURCE')
        )
      );
    expect(conflictRows).toHaveLength(1);
    expect(conflictRows[0].source1).toBe('CHITTORGARH');
    expect(conflictRows[0].source2).toBe('BSE');

    // (a): stored value itself is unchanged -- read back the row, not just the service's return.
    const ipoRows = await db.select().from(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    expect(ipoRows[0]?.issueSize).toBe('10000000000.00');
  });
});
