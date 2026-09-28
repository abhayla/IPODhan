/**
 * repair-remove-registrar-fixtures.ts (#94) — delete integration-test fixture
 * rows that leaked into live `registrars` tables.
 *
 * RCA: `web/tests/integration/api/registrars.integration.test.ts` seeds three
 * fixture registrars ("Alpha Registrar Services Ltd", "Beta Registrar
 * Technologies", "Gamma Corporate Services") through the app's own `db`
 * client (wired to `DATABASE_URL`, not a dedicated test database). When that
 * suite ran against a tunnelled prod/staging `DATABASE_URL`, the fixtures
 * were written there and never cleaned up — `web/tests/helpers/
 * db-safety-guard.ts` now stops new runs, but the historical rows remain.
 *
 * Class: any `registrars` row whose (name, email) exactly matches one of the
 * `FIXTURE_REGISTRARS` tuples below, on ANY database. Never a LIKE/substring
 * match — an exact tuple only, so a real registrar that happens to share a
 * short name is never touched.
 *
 * Usage (dry run by default; from scraper/ with tunnel env exported):
 *   npx tsx scripts/repair-remove-registrar-fixtures.ts
 *   npx tsx scripts/repair-remove-registrar-fixtures.ts --apply [--allow-prod]
 *   npx tsx scripts/repair-remove-registrar-fixtures.ts --check   (exit 1 if any fixture row exists — detection mode)
 *
 * EXIT CODES: 0 clean run (dry-run report, or apply that deleted cleanly, or
 * --check found nothing) · 1 refused (prod guard) OR --check found fixture
 * rows still present · 2 the script crashed, or a write committed but the
 * post-apply readback found a surviving row.
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import {
  guardCacheInvalidation,
  openRepairDb,
  writeLedgerFile,
  type RepairLedgerFieldChange,
} from './lib/repair-tool.js';

/**
 * The exact fixture tuples seeded by
 * `web/tests/integration/api/registrars.integration.test.ts`. MUST stay in
 * sync with that file — `scraper/tests/unit/scripts/
 * repair-remove-registrar-fixtures.test.ts` parses the test file's source
 * and asserts these are identical, so the two cannot silently drift apart.
 */
export const FIXTURE_REGISTRARS: ReadonlyArray<{ name: string; email: string }> = [
  { name: 'Alpha Registrar Services Ltd', email: 'info@alpharegistrar.com' },
  { name: 'Beta Registrar Technologies', email: 'contact@betaregistrar.com' },
  { name: 'Gamma Corporate Services', email: 'support@gamma.com' },
];

export interface CandidateRegistrarRow {
  id: string;
  name: string;
  email: string | null;
}

export interface SelectionResult {
  /** Rows safe to delete — a fixture match with no `ipos.registrar_id` reference. */
  toDelete: CandidateRegistrarRow[];
  /** Fixture matches that ARE referenced by at least one IPO — skipped, never deleted. */
  skippedReferenced: CandidateRegistrarRow[];
}

/**
 * Pure selection: from a set of candidate rows (already filtered to exact
 * fixture-tuple matches by the caller's SQL), split into deletable vs
 * referenced-therefore-refused. `referencedIds` is the set of
 * `ipos.registrar_id` values currently in use — the only FK onto
 * `registrars` (measured 2026-09-28).
 */
export function selectFixtureRowsForDeletion(
  candidates: readonly CandidateRegistrarRow[],
  referencedIds: ReadonlySet<string>
): SelectionResult {
  const toDelete: CandidateRegistrarRow[] = [];
  const skippedReferenced: CandidateRegistrarRow[] = [];
  for (const row of candidates) {
    if (referencedIds.has(row.id)) {
      skippedReferenced.push(row);
    } else {
      toDelete.push(row);
    }
  }
  return { toDelete, skippedReferenced };
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALLOW_PROD = args.includes('--allow-prod');
const CHECK = args.includes('--check');

function fixtureWhereClause() {
  return or(
    ...FIXTURE_REGISTRARS.map((f) => and(eq(schema.registrars.name, f.name), eq(schema.registrars.email, f.email)))
  );
}

async function main(): Promise<number> {
  console.log('='.repeat(80));
  console.log(`REGISTRAR TEST-FIXTURE REMOVAL (#94) — ${CHECK ? 'CHECK' : APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  let refused = false;
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-remove-registrar-fixtures',
    onRefuse: () => {
      refused = true;
    },
  });
  if (refused) return 1;

  const candidates = (await db
    .select({ id: schema.registrars.id, name: schema.registrars.name, email: schema.registrars.email })
    .from(schema.registrars)
    .where(fixtureWhereClause())) as CandidateRegistrarRow[];

  console.log(`current_database(): ${dbName}`);
  console.log(`fixture tuples: ${FIXTURE_REGISTRARS.length}`);
  for (const f of FIXTURE_REGISTRARS) {
    const count = candidates.filter((c) => c.name === f.name && c.email === f.email).length;
    console.log(`  "${f.name}" / ${f.email}: ${count} row(s)`);
  }
  console.log(`total candidate rows: ${candidates.length}`);

  if (CHECK) {
    if (candidates.length > 0) {
      console.log(`CHECK: FAIL — ${candidates.length} fixture row(s) present: ${candidates.map((c) => c.id).join(', ')}`);
      return 1;
    }
    console.log('CHECK: PASS — no fixture rows present.');
    return 0;
  }

  if (candidates.length === 0) {
    console.log('nothing to do.');
    return 0;
  }

  const referencedRows = (await db
    .select({ registrarId: schema.ipos.registrarId })
    .from(schema.ipos)
    .where(
      inArray(
        schema.ipos.registrarId,
        candidates.map((c) => c.id)
      )
    )) as { registrarId: string | null }[];
  const referencedIds = new Set(referencedRows.map((r) => r.registrarId).filter((id): id is string => id !== null));

  const { toDelete, skippedReferenced } = selectFixtureRowsForDeletion(candidates, referencedIds);

  for (const row of toDelete) {
    console.log(`  ${APPLY ? 'DELETE' : 'would delete'}: ${row.id} | "${row.name}" | ${row.email}`);
  }
  for (const row of skippedReferenced) {
    console.log(`  REFUSED (referenced by an IPO): ${row.id} | "${row.name}" | ${row.email}`);
  }
  console.log(`\ndeletable: ${toDelete.length} | refused (referenced): ${skippedReferenced.length}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: re-run with --apply to delete.');
    return 0;
  }

  if (toDelete.length === 0) {
    console.log('nothing to delete (all candidates are referenced).');
    return 0;
  }

  const changes: RepairLedgerFieldChange[] = toDelete.map((row) => ({
    table: 'registrars',
    rowKey: row.id,
    field: '(row)',
    before: row,
    after: null,
  }));
  const ledgerPath = writeLedgerFile(
    `evidence/${new Date().toISOString().slice(0, 10)}-repair-remove-registrar-fixtures/ledger.json`,
    {
      tool: 'repair-remove-registrar-fixtures',
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      changes,
      dbName,
      skippedReferenced,
    }
  );
  console.log(`ledger written: ${ledgerPath}`);

  const idsToDelete = toDelete.map((r) => r.id);
  await db.transaction(async (tx) => {
    await tx.delete(schema.registrars).where(inArray(schema.registrars.id, idsToDelete));
  });

  const survivors = (await db
    .select({ id: schema.registrars.id })
    .from(schema.registrars)
    .where(inArray(schema.registrars.id, idsToDelete))) as { id: string }[];
  if (survivors.length > 0) {
    console.error(`VERIFY: FAILED — ${survivors.length} row(s) survived the delete: ${survivors.map((s) => s.id).join(', ')}`);
    return 2;
  }
  console.log(`VERIFY: 0 rows remain of the ${idsToDelete.length} deleted.`);
  console.log(`deleted count: ${idsToDelete.length}`);

  const invalidationGuard = guardCacheInvalidation({
    dbName,
    toolName: 'repair-remove-registrar-fixtures',
    keys: ['registrars:*', 'registrar:name:*'],
  });
  if (!invalidationGuard.blocked) {
    const redis = getRedisClient();
    try {
      const keys = await redis.keys('registrars:*');
      if (keys.length > 0) await redis.del(...keys);
      const nameKeys = await redis.keys('registrar:name:*');
      if (nameKeys.length > 0) await redis.del(...nameKeys);
    } catch (e) {
      console.warn(`Redis invalidation warning (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return 0;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      logger.error({ error: e instanceof Error ? e.message : String(e) }, 'repair-remove-registrar-fixtures crashed');
      console.error(e);
      process.exit(2);
    });
}
