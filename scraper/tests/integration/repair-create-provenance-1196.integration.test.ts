/**
 * #1196: the repair for rows the create door left without provenance, against ipodhan_test.
 *
 * Legacy rows are simulated by creating through the real door and then deleting the row's field_sources
 * (the state the 47 staging rows are in). Proves: the source comes from the row's recorded CREATE source
 * key; a row with no recorded creating source is skipped and named, never guessed; apply writes one row
 * per missing column and a re-plan finds the row complete.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { db as sharedDb, pool as sharedPool, closePool } from '../../../packages/shared/src/db/index';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationOrchestrator } from '../../src/services/data-consolidation-orchestrator';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';
import {
  applyCreateProvenanceRepair,
  planCreateProvenanceRepair,
} from '../../scripts/repair-create-provenance-1196';
import type { ScrapedIPO } from '../../src/utils/validators';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KEYED = 'Keyed Repair Fixture Holdings Ltd.';
const UNKEYED = 'Unkeyed Legacy Zephyr Industries Ltd.';
const SLUGS = ['keyed-repair-fixture-holdings-ltd', 'unkeyed-legacy-zephyr-industries-ltd'];

const base: ScrapedIPO = {
  companyName: KEYED,
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'UPCOMING',
  issueSize: 500000000,
  lotSize: 100,
  priceRangeMin: 100,
  priceRangeMax: 110,
};

let pool: typeof sharedPool | null = null;
let redis: Redis | null = null;
let db: typeof sharedDb | null = null;
let orchestrator: DataConsolidationOrchestrator | null = null;
const savedFlags: Record<string, unknown> = {};

async function deleteFixtures() {
  if (!pool) return;
  const rows = await pool.query('SELECT id FROM ipos WHERE slug = ANY($1::text[])', [SLUGS]);
  const ids: string[] = rows.rows.map((r) => r.id);
  if (ids.length > 0) {
    await pool.query('DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM data_conflicts WHERE ipo_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM ipos WHERE id = ANY($1::uuid[])', [ids]);
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = sharedPool;
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  redis = new Redis(REDIS_URL, { db: 1, maxRetriesPerRequest: 2 });
  db = sharedDb;
  orchestrator = new DataConsolidationOrchestrator(
    new IPORepository(db as never, redis as never) as never,
    new FieldSourcesRepository(db as never, redis as never) as never,
    new DataConflictsRepository(db as never, redis as never) as never,
    redis
  );
}, 30000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
  if (!pool) return;
  await deleteFixtures();
  if (redis) await redis.quit();
  await closePool();
}, 30000);

beforeEach(async () => {
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  for (const k of ['ENABLE_DATA_CONSOLIDATION', 'ENABLE_SOURCE_TRACKING', 'ENABLE_CONFLICT_DETECTION', 'CONSOLIDATION_PERCENTAGE']) {
    if (!(k in savedFlags)) savedFlags[k] = f[k];
  }
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  f.ENABLE_CONFLICT_DETECTION = true;
  f.CONSOLIDATION_PERCENTAGE = 100;
  if (!DATABASE_URL) return;
  await deleteFixtures();
  if (redis) await redis.del(...SLUGS.map((slug) => `ipo:slug:${slug}`));
});

describe.skipIf(!DATABASE_URL)('#1196: repair-create-provenance (ipodhan_test)', () => {
  it('writes the missing rows from the recorded CREATE source; skips and names a row with no recorded source', async () => {
    const keyed = await orchestrator!.consolidatedUpsertIPO(
      { ...base, sourceKeys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: 'T1196KEYED' }] } as ScrapedIPO,
      'CHITTORGARH',
      90
    );
    const unkeyed = await orchestrator!.consolidatedUpsertIPO({ ...base, companyName: UNKEYED }, 'CHITTORGARH', 90);
    expect(keyed.isNew && unkeyed.isNew).toBe(true);
    // Legacy state: the create left no provenance.
    await pool!.query('DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])', [[keyed.ipoId, unkeyed.ipoId]]);

    const { plan } = await planCreateProvenanceRepair(db as never);
    const mineKeyed = plan.find((p) => p.id === keyed.ipoId);
    const mineUnkeyed = plan.find((p) => p.id === unkeyed.ipoId);
    expect(mineKeyed?.decision.action).toBe('write');
    expect(mineKeyed?.decision.source).toBe('CHITTORGARH');
    expect(mineKeyed?.fields).toEqual(expect.arrayContaining(['companyName', 'status', 'segment', 'offeringType', 'lotSize']));
    expect(mineUnkeyed?.decision.action).toBe('skip-no-creating-source');

    const out = await applyCreateProvenanceRepair(db as never, plan.filter((p) => p.id === keyed.ipoId && p.decision.action === 'write'));
    expect(out.written).toBe(mineKeyed!.fields.length);

    const fs = await pool!.query(
      `SELECT field_name, source FROM field_sources WHERE ipo_id = $1 AND table_name = 'ipos' AND row_key = ''`,
      [keyed.ipoId]
    );
    expect(fs.rows.length).toBe(mineKeyed!.fields.length);
    expect(new Set(fs.rows.map((r) => r.source))).toEqual(new Set(['CHITTORGARH']));
    expect(fs.rows.filter((r) => r.field_name === 'companyName')).toHaveLength(1);
    const none = await pool!.query('SELECT count(*)::int AS n FROM field_sources WHERE ipo_id = $1', [unkeyed.ipoId]);
    expect(none.rows[0].n, 'the unrecorded-source row is never written').toBe(0);

    const again = await planCreateProvenanceRepair(db as never);
    expect(again.plan.find((p) => p.id === keyed.ipoId)).toBeUndefined();
    expect(again.plan.find((p) => p.id === unkeyed.ipoId)?.decision.action).toBe('skip-no-creating-source');
  }, 40000);
});
