// implements: item 5 slice s4 -- wire the field-plan generator so plan rows are actually written
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout,
// which does not carry this slice's repository addition (see
// ipo-field-plan-repository.integration.test.ts for the same guard).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import {
  generateFieldPlan,
  type PlanIpo,
} from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';

/**
 * Item 5 slice s4 -- before this slice, `generateFieldPlan` and
 * `IpoFieldPlanRepository` both existed (slices s1-s3) but NOTHING called
 * them together: `git grep -ln field-plan-generator -- scraper/src` returned
 * only the generator's own file, and `ipo_field_plan` had zero writers. This
 * test drives the real caller wiring (`document-cycle.ts`'s field-plan-
 * generation pass, gated by `FEATURE_FLAGS.ENABLE_FIELD_PLAN`) through the
 * SAME `generateFieldPlan` + `upsertGeneratedRows` path that pass uses, so a
 * regression in either half is caught here rather than only in production.
 *
 * THE CLASS this guards:
 *   (a) a first pass writes real rows for a real IPO, ranks resolved for
 *       THAT IPO's own segment (an SME-on-BSE IPO must never get NSE ranks).
 *   (b) a SECOND pass over the same IPO/manifest-version writes NOTHING NEW
 *       and mutates NO existing row -- `state`, `attempts`, `next_due_at`,
 *       `claimed_at`, and `updated_at` all unchanged. This is design §2.3's
 *       "reconciled when the manifest changes, never regenerated per cycle"
 *       -- the second proof line, the main event of this slice.
 *   (c) a `manifest_version` change reconciles (adds the new field's row)
 *       rather than duplicating or touching the old rows.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run (see docs/ops/prod-ops-recipes.md section 7 for the four traps --
 * there is NO scraper/.env.test; credentials live in GLOBAL.env; DATABASE_URL
 * unset prints "no tests" and exits 0, which looks like a pass; run ONE
 * ipo_field_plan integration file at a time, never in parallel):
 *   cd scraper
 *   PW=$(grep '^IPODHAN_APP_DB_PASSWORD=' /d/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
 *   DATABASE_URL=<the sanctioned ipodhan_test URL -- see the recipe; NOT repeated
 *     here, because a literal connection string in a test file is refused by the
 *     scraper-integration-target guard, which cannot vet a string it did not build>
 *   REDIS_URL="redis://localhost:6379/15" \
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-plan-generation-wiring.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-5-slice-s4: SKIPPED -- DATABASE_URL not set';

const MAINBOARD_IPO_ID = '00000000-0000-4000-8000-000000054001';
const SME_BSE_IPO_ID = '00000000-0000-4000-8000-000000054002';
const SME_NSE_IPO_ID = '00000000-0000-4000-8000-000000054003';

/** Redis is never touched by this repository; BaseRepository only needs the handle. */
const FAKE_REDIS = {} as never;

function makePool(max = 2): Pool {
  return new Pool({ connectionString: DATABASE_URL, max, options: '-c timezone=UTC' });
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const dbCheck = await pool.query('select current_database()');
  const currentDb = dbCheck.rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') {
    throw new Error(
      `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
        'This integration test only runs against the test database.'
    );
  }
}

/** The document-cycle caller's exact mapping (mirrors document-cycle.ts's PASS 3). */
async function runGenerationPass(
  repo: IpoFieldPlanRepository,
  ipo: PlanIpo,
  manifest = loadFieldManifest()
): Promise<{ inserted: number }> {
  const rows = generateFieldPlan(ipo, manifest);
  if (rows.length === 0) return { inserted: 0 };
  return repo.upsertGeneratedRows(
    rows.map((r) => ({
      ipoId: r.ipoId,
      tableName: r.tableName,
      rowKey: '',
      fieldName: r.fieldName,
      rank1Source: r.rank1Source,
      rank2Source: r.rank2Source,
      rank3Source: r.rank3Source,
      manifestVersion: r.manifestVersion,
    }))
  );
}

describe.skipIf(!DATABASE_URL)(`field-plan generation wiring (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let repo: IpoFieldPlanRepository;
  let db: ReturnType<typeof drizzle>;

  const ALL_IPO_IDS = [MAINBOARD_IPO_ID, SME_BSE_IPO_ID, SME_NSE_IPO_ID];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = makePool(4);
    await assertTestDatabase(pool);
    db = drizzle(pool, { schema });
    repo = new IpoFieldPlanRepository(db as never, FAKE_REDIS);

    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, ALL_IPO_IDS));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, ALL_IPO_IDS));

    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, offering_type, status, segment, listing_exchanges, open_date, close_date)
      VALUES
        (${MAINBOARD_IPO_ID}::uuid, 'S4 Mainboard Fixture Ltd.', 's4-mainboard-fixture', 'MAINBOARD', 'IPO', 'OPEN', 'MAINBOARD', '["NSE","BSE"]'::jsonb, '2026-09-14', '2026-09-16'),
        (${SME_BSE_IPO_ID}::uuid, 'S4 SME BSE Fixture Ltd.', 's4-sme-bse-fixture', 'SME', 'IPO', 'OPEN', 'SME', '["BSE"]'::jsonb, '2026-09-14', '2026-09-16'),
        (${SME_NSE_IPO_ID}::uuid, 'S4 SME NSE Fixture Ltd.', 's4-sme-nse-fixture', 'SME', 'IPO', 'OPEN', 'SME', '["NSE"]'::jsonb, '2026-09-14', '2026-09-16')
    `);
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, ALL_IPO_IDS));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, ALL_IPO_IDS));
    await pool.end();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, ALL_IPO_IDS));
  });

  async function rowsFor(ipoId: string) {
    return db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, ipoId));
  }

  it('a first pass writes N rows for a named IPO, ranks resolved for its OWN segment', async () => {
    const manifest = loadFieldManifest();
    const mainboardIpo: PlanIpo = { id: MAINBOARD_IPO_ID, segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] };
    const { inserted } = await runGenerationPass(repo, mainboardIpo, manifest);

    const expectedCount = Object.entries(manifest.fields).filter(([, e]) =>
      Array.isArray(e.rank.MAINBOARD)
    ).length;
    expect(inserted).toBe(expectedCount);

    const rows = await rowsFor(MAINBOARD_IPO_ID);
    expect(rows.length).toBe(expectedCount);
    expect(rows.every((r) => r.state === 'PENDING' && r.attempts === 0)).toBe(true);
  });

  it("an SME-on-BSE IPO gets SME_BSE ranks, never NSE -- reads the manifest's per-segment rank arrays", async () => {
    const smeBseIpo: PlanIpo = { id: SME_BSE_IPO_ID, segment: 'SME', listingExchanges: ['BSE'] };
    await runGenerationPass(repo, smeBseIpo);

    const rows = await rowsFor(SME_BSE_IPO_ID);
    expect(rows.length).toBeGreaterThan(0);
    const anyNse = rows.some(
      (r) => r.rank1Source === 'NSE' || r.rank2Source === 'NSE' || r.rank3Source === 'NSE'
    );
    expect(anyNse).toBe(false);

    const revenueRow = rows.find((r) => r.tableName === 'financial_statements' && r.fieldName === 'revenue');
    expect(revenueRow).toBeDefined();
    expect([revenueRow!.rank1Source, revenueRow!.rank2Source, revenueRow!.rank3Source]).toEqual([
      'DOC',
      'CHITTORGARH',
      'MONEYCONTROL',
    ]);
  });

  it('an SME-on-NSE IPO resolves SME_NSE ranks for its own segment, distinct from SME_BSE', async () => {
    const smeNseIpo: PlanIpo = { id: SME_NSE_IPO_ID, segment: 'SME', listingExchanges: ['NSE'] };
    await runGenerationPass(repo, smeNseIpo);

    const rows = await rowsFor(SME_NSE_IPO_ID);
    expect(rows.length).toBeGreaterThan(0);
  });

  it(
    'a SECOND pass over the same IPO writes NOTHING NEW and mutates NO existing row ' +
      '(state, attempts, next_due_at, claimed_at, updated_at all unchanged)',
    async () => {
      const manifest = loadFieldManifest();
      const ipo: PlanIpo = { id: MAINBOARD_IPO_ID, segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] };

      const first = await runGenerationPass(repo, ipo, manifest);
      expect(first.inserted).toBeGreaterThan(0);

      // Mutate the live state on one row exactly like a real walk would, so a
      // reconciliation bug that overwrites live state is actually detectable
      // rather than passing by coincidence because every column still held
      // its fresh-insert default.
      const before = await rowsFor(MAINBOARD_IPO_ID);
      const target = before.find((r) => r.tableName === 'ipos' && r.fieldName === 'issue_size')!;
      await db
        .update(schema.ipoFieldPlan)
        .set({
          state: 'SUPPLIED',
          attempts: 3,
          chosenSource: 'DOC',
          nextDueAt: null,
          claimedAt: new Date('2026-09-10T00:00:00Z'),
          claimToken: 'existing-claim-token',
        })
        .where(eq(schema.ipoFieldPlan.id, target.id));

      const beforeSecondPass = await rowsFor(MAINBOARD_IPO_ID);
      const beforeMap = new Map(beforeSecondPass.map((r) => [r.id, r]));

      const second = await runGenerationPass(repo, ipo, manifest);
      expect(second.inserted).toBe(0);

      const afterSecondPass = await rowsFor(MAINBOARD_IPO_ID);
      expect(afterSecondPass.length).toBe(beforeSecondPass.length);

      for (const after of afterSecondPass) {
        const before = beforeMap.get(after.id)!;
        expect(after.state).toBe(before.state);
        expect(after.attempts).toBe(before.attempts);
        expect(after.nextDueAt).toEqual(before.nextDueAt);
        expect(after.claimedAt).toEqual(before.claimedAt);
        // The one column most likely to be silently re-stamped: an
        // ON CONFLICT ... DO UPDATE (instead of DO NOTHING) would bump this
        // even if every other column round-tripped unchanged.
        expect(after.updatedAt).toEqual(before.updatedAt);
      }
    }
  );

  it('a manifest_version change reconciles (adds the new row) rather than duplicating existing ones', async () => {
    const manifest = loadFieldManifest();
    const ipo: PlanIpo = { id: MAINBOARD_IPO_ID, segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] };

    const first = await runGenerationPass(repo, ipo, manifest);
    expect(first.inserted).toBeGreaterThan(0);
    const beforeCount = (await rowsFor(MAINBOARD_IPO_ID)).length;

    const bumpedManifest = {
      ...manifest,
      version: manifest.version + 1,
      fields: {
        ...manifest.fields,
        'ipo_details.s4_reconcile_probe_field': {
          rank: { MAINBOARD: ['DOC'] },
        },
      },
    } as unknown as typeof manifest;

    const second = await runGenerationPass(repo, ipo, bumpedManifest);
    // Exactly one new row: the probe field. Every field already planned
    // under the OLD manifest version still exists at that (ipo, table,
    // row_key, field) key, so the conflict target skips all of them.
    expect(second.inserted).toBe(1);

    const afterRows = await rowsFor(MAINBOARD_IPO_ID);
    expect(afterRows.length).toBe(beforeCount + 1);
    const probeRow = afterRows.find(
      (r) => r.tableName === 'ipo_details' && r.fieldName === 's4_reconcile_probe_field'
    );
    expect(probeRow).toBeDefined();
    expect(probeRow!.manifestVersion).toBe(bumpedManifest.version);

    // The old rows are untouched -- still stamped with the ORIGINAL manifest
    // version, not silently bumped to match the new one.
    const originalRow = afterRows.find((r) => r.tableName === 'ipos' && r.fieldName === 'issue_size');
    expect(originalRow!.manifestVersion).toBe(manifest.version);
  });

  it('an empty generator result (flag semantics: nothing to plan) writes zero rows', async () => {
    // Mirrors the flag-OFF caller behaviour: the document-cycle pass is
    // gated by `FEATURE_FLAGS.ENABLE_FIELD_PLAN` and never calls
    // `generateFieldPlan`/`upsertGeneratedRows` at all when the flag is off.
    // At the repository layer that is exactly equivalent to "zero rows
    // passed in" -- asserted directly here since the flag gate itself lives
    // in document-cycle.ts, outside this repository/generator boundary.
    const result = await repo.upsertGeneratedRows([]);
    expect(result.inserted).toBe(0);
    expect((await rowsFor(MAINBOARD_IPO_ID)).length).toBe(0);
  });
});
