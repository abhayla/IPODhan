// implements: item 3 slice S4 -- field_source_overrides repository + resolver layer 2, real DB
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's node_modules junction can
// resolve the alias back to the PRIMARY checkout (same guard as
// ipo-field-plan-repository.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourceOverridesRepository } from '../../../packages/shared/src/repositories/field-source-overrides-repository';
import { resolveFieldSourcePolicyAsync } from '../../src/config/field-source-policy';
import { createFieldSourceOverridesReader } from '../../src/config/field-source-overrides-reader';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';

/**
 * Item 3 slice S4 -- proves layer 2 end to end against a real database: a `set` changes what the
 * async resolver returns; an EXPIRED override does not (S4 DoD row S4-3).
 *
 * SKIPS CLEANLY when no database is configured. Run:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/field-source-overrides-repository.integration.test.ts
 *
 * Recipe: docs/ops/prod-ops-recipes.md section 12 (tunnel, env vars). This file never carries a
 * host or credential.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-3-slice-s4: SKIPPED -- DATABASE_URL not set';

const REAL_IPO_ID = '00000000-0000-4000-8000-000000054001';
const SLUG = 's4-field-source-overrides-fixture';
const REASON = 'S4 integration test fixture (owner go 2026-09-17)';

const manifest = loadFieldManifest();

function makePool(max = 2): Pool {
  return new Pool({ connectionString: DATABASE_URL, max, options: '-c timezone=UTC' });
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const dbCheck = await pool.query('select current_database()');
  const currentDb = dbCheck.rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') {
    throw new Error(
      `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. This integration test only runs against the test database.`
    );
  }
}

describe.skipIf(!DATABASE_URL)(`field_source_overrides repository + resolver layer 2 (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let repo: FieldSourceOverridesRepository;
  let db: ReturnType<typeof drizzle>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = makePool(4);
    await assertTestDatabase(pool);
    db = drizzle(pool, { schema });
    repo = new FieldSourceOverridesRepository({ db: db as never });

    await db.delete(schema.fieldSourceOverrides).where(eq(schema.fieldSourceOverrides.ipoId, REAL_IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [REAL_IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${REAL_IPO_ID}::uuid, 'S4 Override Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    if (createdIds.length > 0) {
      await db.delete(schema.fieldSourceOverrides).where(inArray(schema.fieldSourceOverrides.id, createdIds));
    }
    await db.delete(schema.fieldSourceOverrides).where(eq(schema.fieldSourceOverrides.ipoId, REAL_IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [REAL_IPO_ID]));
    await pool.end();
  }, 60000);

  it(`S4-3: set() changes what resolveFieldSourcePolicyAsync returns; expire() reverts it to the registry (${RUN_LABEL})`, async () => {
    if (!DATABASE_URL) return;
    const reader = createFieldSourceOverridesReader(repo);
    const query = { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' as const };

    const before = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    expect(before.origin.kind).toBe('registry');
    expect(before.ranks).toEqual(['DOC', 'CHITTORGARH']);

    const inserted = await repo.set({
      tableName: 'ipos',
      fieldName: 'issue_size',
      ipoId: null, // global override -- proves the DB round trip changes ALL-IPO resolution
      rank1Source: 'CHITTORGARH',
      rank2Source: 'DOC',
      reason: REASON,
      setBy: 's4-integration-test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    createdIds.push(inserted.id);

    const during = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    expect(during.origin).toEqual({ kind: 'override', id: inserted.id, expiresAt: inserted.expiresAt.toISOString() });
    expect(during.ranks).toEqual(['CHITTORGARH', 'DOC']);

    const expired = await repo.expire(inserted.id);
    expect(expired?.expiredAt).not.toBeNull();

    const after = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    expect(after.origin).toEqual({ kind: 'registry', version: manifest.version });
    expect(after.ranks).toEqual(['DOC', 'CHITTORGARH']);
  }, 30000);

  it(`an override with expiresAt already in the past is never returned as active (${RUN_LABEL})`, async () => {
    if (!DATABASE_URL) return;
    const reader = createFieldSourceOverridesReader(repo);
    const query = { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' as const };

    const inserted = await repo.set({
      tableName: 'ipos',
      fieldName: 'issue_size',
      ipoId: null,
      rank1Source: 'CHITTORGARH',
      reason: REASON,
      setBy: 's4-integration-test',
      expiresAt: new Date(Date.now() - 60 * 1000), // already expired, never expire()'d
    });
    createdIds.push(inserted.id);

    const policy = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    expect(policy.origin.kind).toBe('registry');
  }, 30000);

  it(`an ipo-scoped override beats a global override on the real DB (${RUN_LABEL})`, async () => {
    if (!DATABASE_URL) return;
    const reader = createFieldSourceOverridesReader(repo);
    const query = { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' as const, ipoId: REAL_IPO_ID };

    const global = await repo.set({
      tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
      rank1Source: 'CHITTORGARH', reason: REASON, setBy: 's4-integration-test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    createdIds.push(global.id);
    const scoped = await repo.set({
      tableName: 'ipos', fieldName: 'issue_size', ipoId: REAL_IPO_ID,
      rank1Source: 'DOC', reason: REASON, setBy: 's4-integration-test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    createdIds.push(scoped.id);

    const policy = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    expect(policy.origin).toMatchObject({ kind: 'override', id: scoped.id });
    expect(policy.ranks).toEqual(['DOC']);
  }, 30000);
});
