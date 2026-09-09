/**
 * Repair: `drizzle.__drizzle_migrations.created_at` for the three rows whose
 * journaled `when` was hand-typed into the future (GitHub #442, pull-model
 * implementation loop item 1 slice 0).
 *
 * WHY: `web/drizzle/migrations/meta/_journal.json` idx 32-34
 * (0049_ipo_details_ad_fields, 20260906090638_icy_firelord,
 * 20260908004955_left_loners) carried a `when` of 2026-09-10T09:19:59.000Z /
 * ...:00.000Z / ...:00.500Z — dates in the future relative to when they were
 * actually authored and applied. drizzle's migrator only applies a pending
 * migration whose `folderMillis` (the journal `when`) is STRICTLY GREATER
 * than the last-applied row's `created_at`. Once those three rows were
 * applied, their `created_at` in the DB carried the SAME future values, so
 * ANY migration generated before 2026-09-10T09:20:00.500Z sorted below them
 * and was silently skipped — `db:migrate` exits 0, nothing applied. Fixing
 * the journal file alone (this slice's other change) does nothing for a
 * database that already has these future `created_at` rows written — this
 * tool is the second half of the fix, for each slot separately.
 *
 * IDENTITY: a row is matched by `hash`, not by its old `created_at` value.
 * `hash` is `sha256(<migration .sql file content>)` (see
 * `readMigrationFiles()` in drizzle-orm/migrator.js) — a content-addressed,
 * unambiguous identity, immune to a slot's `created_at` having drifted from
 * what this tool expects.
 *
 * SCOPE: exactly the three rows named in #442. Every other row in
 * `drizzle.__drizzle_migrations` is left untouched.
 *
 * SAFETY: backup-first (writes the pre-change rows to evidence/), one
 * transaction, idempotent (`created_at IS DISTINCT FROM <target>` guard — a
 * second run finds nothing to do), dry-run by default, `--apply` to write,
 * `--allow-prod` gate present and never exercised by this slice.
 *
 * Run from scraper/ with tunnel env exported
 * (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 DATABASE_NAME=ipodhan_test ...):
 *   npx tsx scripts/repair-migration-journal-dates.ts            # dry-run
 *   npx tsx scripts/repair-migration-journal-dates.ts --apply
 */
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'web', 'drizzle', 'migrations');
// Default backup location is the OS temp directory — a backup MUST NOT
// default to a path outside the repo. D:\Abhay\GetWorkDone is a shared audit
// trail for a different system and is out of bounds for this tool's default
// output (a prior run wrote there by mistake; the file was moved out — see
// the fix round for GitHub #442). Override with the env var for a run that
// wants its backup kept somewhere durable.
const EVIDENCE_DIR =
  process.env.MIGRATION_JOURNAL_REPAIR_EVIDENCE_DIR ||
  path.join(os.tmpdir(), 'ipodhan-migration-journal-repair', '2026-09-09-issue-442');

/**
 * The three entries named in #442, with the CORRECTED `when` value each
 * should carry — the same value this slice writes into
 * `meta/_journal.json`. Kept as a literal table (not re-derived from the
 * journal file) so a future, unrelated edit to the journal can never change
 * what this one-time repair targets.
 */
const TARGET_ENTRIES: ReadonlyArray<{ tag: string; correctedWhen: number }> = [
  { tag: '0049_ipo_details_ad_fields', correctedWhen: 1788685590000 }, // 2026-09-06T09:06:30.000Z
  { tag: '20260906090638_icy_firelord', correctedWhen: 1788685598000 }, // 2026-09-06T09:06:38.000Z (its own tag)
  { tag: '20260908004955_left_loners', correctedWhen: 1788828595000 }, // 2026-09-08T00:49:55.000Z (its own tag)
];

/** sha256(sql file content) — identical to drizzle-orm's readMigrationFiles(). */
function hashMigrationFile(tag: string): string {
  const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const content = fs.readFileSync(sqlPath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

interface MigrationRow {
  id: number;
  hash: string;
  created_at: string; // bigint comes back as string from node-postgres
}

async function main() {
  console.log('='.repeat(80));
  console.log(`MIGRATION JOURNAL DATES REPAIR (#442) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-migration-journal-dates',
  });

  const targets = TARGET_ENTRIES.map((t) => ({ ...t, hash: hashMigrationFile(t.tag) }));

  const allRowsResult = await db.execute(
    sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`
  );
  const allRows = (Array.isArray(allRowsResult) ? allRowsResult : (allRowsResult as any).rows) as MigrationRow[];
  const byHash = new Map(allRows.map((r) => [r.hash, r]));

  const plan: Array<{ tag: string; hash: string; rowId: number; before: string; after: number }> = [];
  const notFound: string[] = [];

  for (const t of targets) {
    const row = byHash.get(t.hash);
    if (!row) {
      notFound.push(
        `${t.tag} (hash ${t.hash.slice(0, 12)}...) — no matching row in drizzle.__drizzle_migrations on "${dbName}" (migration not yet applied on this slot; nothing to repair here).`
      );
      continue;
    }
    const beforeMs = Number(row.created_at);
    console.log(
      `  ${t.tag}: row id=${row.id} created_at ${beforeMs} (${new Date(beforeMs).toISOString()}) -> ${t.correctedWhen} (${new Date(t.correctedWhen).toISOString()})`
    );
    if (beforeMs === t.correctedWhen) {
      console.log(`    already correct — skipping (idempotent).`);
      continue;
    }
    plan.push({ tag: t.tag, hash: t.hash, rowId: row.id, before: row.created_at, after: t.correctedWhen });
  }

  if (notFound.length > 0) {
    console.log(`\nNot found on "${dbName}" (${notFound.length}):`);
    notFound.forEach((n) => console.log(`  - ${n}`));
  }

  if (plan.length === 0) {
    console.log(`\nNothing to repair on "${dbName}" — 0 rows need a created_at correction.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  const backupPath = path.join(EVIDENCE_DIR, `migration-journal-dates-backup-${dbName}.json`);
  writeLedgerFile(backupPath, { dbName, capturedAt: new Date().toISOString(), rows: plan });
  console.log(`\nbackup written: ${backupPath} (${plan.length} row(s))`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plan.length} row(s) on "${dbName}" WOULD be corrected. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const p of plan) {
      const result: any = await tx.execute(
        sql`UPDATE drizzle.__drizzle_migrations SET created_at = ${p.after} WHERE id = ${p.rowId} AND created_at = ${p.before}`
      );
      const rowCount = result?.rowCount ?? result?.rowsAffected ?? null;
      if (rowCount === 0) {
        throw new Error(
          `UPDATE matched 0 rows for ${p.tag} (id=${p.rowId}) on "${dbName}" — row changed since the plan was built; aborting the whole transaction.`
        );
      }
      logger.info({ db: dbName, tag: p.tag, rowId: p.rowId, before: p.before, after: p.after }, 'migration created_at repaired');
    }
  });

  console.log(`\nAPPLY complete on "${dbName}": ${plan.length} row(s) corrected.`);
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'migration journal dates repair crashed');
    console.error(e);
    process.exit(1);
  });
}
