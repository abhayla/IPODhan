/**
 * #1196 (OD-88): the live create door writes the ipos row and its provenance atomically.
 *
 * Core: force the provenance write to fail -> the create is rolled back (no ipos row) and the call
 * fails; normal path -> exactly one field_sources row per column the create set, under the creating
 * source. Runs the REAL DataConsolidationOrchestrator against ipodhan_test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationOrchestrator } from '../../src/services/data-consolidation-orchestrator';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';
import type { ScrapedIPO } from '../../src/utils/validators';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NAME = 'Atomic Provenance Fixture Ltd.';
const SLUG = 'atomic-provenance-fixture-ltd';

const data: ScrapedIPO = {
  companyName: NAME,
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'OPEN',
  issueSize: 500000000,
  lotSize: 100,
  priceRangeMin: 100,
  priceRangeMax: 110,
  openDate: '2026-11-10',
  closeDate: '2026-11-13',
};
const SET_COLUMNS = ['companyName', 'segment', 'offeringType', 'status', 'issueSize', 'lotSize', 'priceRangeMin', 'priceRangeMax'];

let pool: Pool | null = null;
let redis: Redis | null = null;
let orchestrator: DataConsolidationOrchestrator | null = null;
const savedFlags: Record<string, unknown> = {};

async function deleteFixture() {
  if (!pool) return;
  const rows = await pool.query('SELECT id FROM ipos WHERE slug = $1', [SLUG]);
  const ids: string[] = rows.rows.map((r) => r.id);
  if (ids.length > 0) {
    await pool.query('DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM data_conflicts WHERE ipo_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM ipo_source_keys WHERE ipo_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('DELETE FROM ipos WHERE id = ANY($1::uuid[])', [ids]);
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  redis = new Redis(REDIS_URL, { db: 1, maxRetriesPerRequest: 2 });
  const db = drizzle(pool, { schema });
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
  await deleteFixture();
  if (redis) await redis.quit();
  await pool.end();
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
  await deleteFixture();
  if (redis) await redis.del(`ipo:slug:${SLUG}`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(!DATABASE_URL)('#1196: the create door writes the row and its provenance atomically (ipodhan_test)', () => {
  it('a provenance write that fails rolls the create back: no ipos row, and the call fails', async () => {
    const real = FieldSourcesRepository.prototype.trackFieldUpdate;
    let calls = 0;
    vi.spyOn(FieldSourcesRepository.prototype, 'trackFieldUpdate').mockImplementation(function (this: FieldSourcesRepository, input) {
      calls += 1;
      if (calls === 3) throw new Error('forced provenance failure (#1196 test)');
      return real.call(this, input);
    });

    let outcome: unknown;
    try {
      outcome = await orchestrator!.consolidatedUpsertIPO(data, 'NSE', 95);
    } catch (e) {
      outcome = e;
    }
    expect(calls, 'the forced failure must have been reached').toBeGreaterThanOrEqual(3);
    const failed = outcome instanceof Error || (outcome as { skipped?: boolean; error?: unknown })?.error !== undefined || (outcome as { skipped?: boolean })?.skipped === true;
    expect(failed, `the call must fail, got ${JSON.stringify(outcome)?.slice(0, 200)}`).toBe(true);

    const rows = await pool!.query('SELECT id FROM ipos WHERE slug = $1', [SLUG]);
    expect(rows.rowCount, 'no ipos row may survive a failed provenance write').toBe(0);
    const orphan = await pool!.query(
      `SELECT count(*)::int AS n FROM field_sources fs LEFT JOIN ipos i ON i.id = fs.ipo_id WHERE i.id IS NULL AND fs.field_name = 'companyName'`
    );
    expect(orphan.rows[0].n).toBe(0);
  }, 20000);

  it('normal path: one field_sources row per column the create set, under the creating source', async () => {
    const result = await orchestrator!.consolidatedUpsertIPO(data, 'NSE', 95);
    expect(result.isNew).toBe(true);
    const fs = await pool!.query(
      `SELECT field_name, source FROM field_sources WHERE ipo_id = $1 AND table_name = 'ipos' AND row_key = ''`,
      [result.ipoId]
    );
    const byField = new Map<string, string[]>();
    for (const r of fs.rows) byField.set(r.field_name, [...(byField.get(r.field_name) ?? []), r.source]);
    for (const col of SET_COLUMNS) {
      expect(byField.get(col), `provenance for ${col}`).toEqual(['NSE']);
    }
    expect(byField.has('slug'), 'bookkeeping slug is not sourced').toBe(false);
  }, 20000);
});
