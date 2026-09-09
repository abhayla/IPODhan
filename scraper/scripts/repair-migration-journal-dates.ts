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
 * LINE ENDINGS (GitHub #449): the hash is taken over the file bytes as
 * `readMigrationFiles()` sees them, and those bytes depend on which
 * platform wrote or checked out the file. A migration applied by the Linux
 * deploy runner (LF) hashes differently from the SAME logical file read
 * from a Windows checkout where git's `core.autocrlf` converted it to CRLF
 * — so a row this tool is looking for can exist and still not match, in
 * EITHER direction. This tool computes all three of {raw (file as read),
 * LF-normalized, CRLF} for every target, and accepts a row matching ANY of
 * them — never normalizes only one direction, which would leave the
 * opposite platform's rows unreachable (a Windows checkout could not see a
 * Linux-written row on the first round; a Linux checkout could not see a
 * Windows-written row until this round). The CRLF variant is built by
 * normalizing to LF first and then expanding — never by blindly replacing
 * `\n` with `\r\n` on as-read content, which would turn an already-CRLF
 * file's `\r\n` into `\r\r\n`. When two or three variants collapse to the
 * same value (the common case — a file already LF, or already CRLF),
 * `matchTargetsToRows()` de-duplicates before looking up: it checks each
 * DISTINCT hash at most once, so a row is never looked up twice or counted
 * as two matches.
 *
 * SCOPE: exactly the three rows named in #442. Every other row in
 * `drizzle.__drizzle_migrations` is left untouched.
 *
 * SAFETY: backup-first (writes the pre-change rows to evidence/), one
 * transaction, idempotent (a JS `beforeMs === correctedWhen` check skips any
 * row already at its target value before it is even added to the plan, and
 * the UPDATE itself is additionally guarded by `AND created_at = <before>`
 * so a row that changed since the plan was built is left untouched rather
 * than double-applied), dry-run by default, `--apply` to write, `--allow-prod`
 * gate present and never exercised by this slice.
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

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * All three hashes a target might match on drizzle.__drizzle_migrations
 * (#449): `raw` is sha256 of the content exactly as read (whatever line
 * endings the current checkout produced); `normalized` collapses CRLF to LF
 * first; `crlf` expands that LF-normalized form back out to CRLF — always
 * derived from the already-normalized (LF) content, never from `content`
 * directly, so an as-read CRLF file is never double-converted into CRCRLF.
 * Any two (or all three) of these commonly collapse to the same value —
 * callers must not treat that as independent matches (see
 * `matchTargetsToRows`, which de-dupes before looking up).
 */
export function hashContentVariants(content: string): { raw: string; normalized: string; crlf: string } {
  const raw = sha256(content);
  const lf = content.replace(/\r\n/g, '\n');
  const normalized = sha256(lf);
  const crlf = sha256(lf.replace(/\n/g, '\r\n'));
  return { raw, normalized, crlf };
}

/** sha256(sql file content) — identical to drizzle-orm's readMigrationFiles(). Exported so the unit test can drive the real function instead of re-deriving the algorithm. */
export function hashMigrationFile(tag: string): string {
  const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const content = fs.readFileSync(sqlPath, 'utf8');
  return sha256(content);
}

/** All three candidate hashes (raw, LF-normalized, CRLF) for the migration file `tag` as it exists in this checkout. */
export function hashMigrationFileVariants(tag: string): { raw: string; normalized: string; crlf: string } {
  const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const content = fs.readFileSync(sqlPath, 'utf8');
  return hashContentVariants(content);
}

interface MigrationRow {
  id: number;
  hash: string;
  created_at: string; // bigint comes back as string from node-postgres
}

interface HashedTarget {
  tag: string;
  correctedWhen: number;
  raw: string;
  normalized: string;
  crlf: string;
}

interface MatchedTarget {
  tag: string;
  correctedWhen: number;
  row: MigrationRow;
  matchedVia: 'raw' | 'normalized' | 'crlf';
}

interface UnmatchedTarget {
  tag: string;
  raw: string;
  normalized: string;
  crlf: string;
}

/**
 * Pure matching decision (#449): resolves each target to a
 * drizzle.__drizzle_migrations row by ANY of its raw, LF-normalized, or
 * CRLF hash, so a row written by a platform whose line endings differ from
 * this checkout's is still found — in either direction (Windows checkout
 * reading a Linux-written row, or Linux checkout reading a Windows-written
 * row). Variants are de-duplicated before lookup: raw is checked first,
 * then normalized only if it differs from raw, then crlf only if it
 * differs from BOTH raw and normalized — so a variant is never looked up
 * (or counted as a match) more than once, even when all three collapse to
 * the same value. Exported so tests drive the real matching logic without
 * a database.
 */
export function matchTargetsToRows(
  targets: readonly HashedTarget[],
  rows: readonly MigrationRow[]
): { matched: MatchedTarget[]; unmatched: UnmatchedTarget[] } {
  const byHash = new Map(rows.map((r) => [r.hash, r]));
  const matched: MatchedTarget[] = [];
  const unmatched: UnmatchedTarget[] = [];
  for (const t of targets) {
    const candidates: Array<{ hash: string; via: MatchedTarget['matchedVia'] }> = [{ hash: t.raw, via: 'raw' }];
    if (t.normalized !== t.raw) candidates.push({ hash: t.normalized, via: 'normalized' });
    if (t.crlf !== t.raw && t.crlf !== t.normalized) candidates.push({ hash: t.crlf, via: 'crlf' });

    const hit = candidates.map((c) => ({ ...c, row: byHash.get(c.hash) })).find((c) => c.row);
    if (hit && hit.row) {
      matched.push({ tag: t.tag, correctedWhen: t.correctedWhen, row: hit.row, matchedVia: hit.via });
    } else {
      unmatched.push({ tag: t.tag, raw: t.raw, normalized: t.normalized, crlf: t.crlf });
    }
  }
  return { matched, unmatched };
}

interface JournalEntryLike {
  tag: string;
  when: number;
}

/**
 * Pure precondition: the on-disk journal this checkout is running from MUST
 * already carry the corrected `when` for every row this tool is about to
 * write into the database — otherwise a released checkout that has NOT yet
 * shipped the journal fix would drive the database's `created_at` LOWER than
 * the deployed journal's `when`, and the next `db:migrate` would find idx
 * 32-34 "pending" again and insert duplicate rows in
 * `drizzle.__drizzle_migrations`. Exported so the check is testable without
 * touching disk. Returns one message per mismatch/missing entry; empty means
 * the journal is safe to repair against.
 */
export function findJournalMismatches(
  journalEntries: readonly JournalEntryLike[],
  targets: ReadonlyArray<{ tag: string; correctedWhen: number }>
): string[] {
  const byTag = new Map(journalEntries.map((e) => [e.tag, e.when]));
  const mismatches: string[] = [];
  for (const t of targets) {
    const journalWhen = byTag.get(t.tag);
    if (journalWhen === undefined) {
      mismatches.push(`${t.tag}: not present in the on-disk journal`);
    } else if (journalWhen !== t.correctedWhen) {
      mismatches.push(
        `${t.tag}: on-disk journal 'when'=${journalWhen} (${new Date(journalWhen).toISOString()}) does not match the ` +
          `corrected value ${t.correctedWhen} (${new Date(t.correctedWhen).toISOString()}) this tool is about to write into the database`
      );
    }
  }
  return mismatches;
}

/** Reads meta/_journal.json off disk and throws if it hasn't shipped the corrected `when` values yet. */
function assertJournalOnDiskMatchesTargets(): void {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: JournalEntryLike[] };
  const mismatches = findJournalMismatches(journal.entries, TARGET_ENTRIES);
  if (mismatches.length > 0) {
    throw new Error(
      `Refusing to repair drizzle.__drizzle_migrations.created_at: the on-disk journal at "${journalPath}" does not ` +
        `carry the corrected 'when' values this tool is about to write into the database:\n` +
        mismatches.map((m) => `  - ${m}`).join('\n') +
        `\nRunning this repair from a checkout/release where the journal fix has not shipped would make the ` +
        `database's created_at LOWER than the deployed journal's 'when', so the next db:migrate would re-run idx ` +
        `32-34 and insert duplicate rows in drizzle.__drizzle_migrations. Deploy the journal fix (this slice's ` +
        `meta/_journal.json change) to this checkout/release first, then re-run.`
    );
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log(`MIGRATION JOURNAL DATES REPAIR (#442) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  assertJournalOnDiskMatchesTargets();

  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-migration-journal-dates',
  });

  const targets = TARGET_ENTRIES.map((t) => ({ ...t, ...hashMigrationFileVariants(t.tag) }));

  const allRowsResult = await db.execute(
    sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`
  );
  const allRows = (Array.isArray(allRowsResult) ? allRowsResult : (allRowsResult as any).rows) as MigrationRow[];

  const { matched, unmatched } = matchTargetsToRows(targets, allRows);

  // A zero (or partial) match must be a LOUD failure (#449) — "expected N,
  // matched M" is silently indistinguishable from "nothing needed
  // repairing" unless the tool says so and exits non-zero.
  if (unmatched.length > 0) {
    console.log(
      `\nFAILED to match ${unmatched.length} of ${targets.length} target(s) on "${dbName}" — this is NOT the ` +
        `same thing as "nothing to repair":`
    );
    unmatched.forEach((u) => {
      console.log(`  - ${u.tag}: tried raw hash ${u.raw}, LF-normalized hash ${u.normalized}, and CRLF hash ${u.crlf} — none is present in drizzle.__drizzle_migrations on "${dbName}".`);
    });
    console.log(
      `\nEither the migration truly has not been applied on this slot yet, or the matching logic still cannot ` +
        `see the row that applied it. Do not treat this exit as "healthy" — investigate before assuming the ` +
        `slot needs no repair.`
    );
    console.log('='.repeat(80));
    process.exit(1);
  }

  const plan: Array<{ tag: string; hash: string; rowId: number; before: string; after: number }> = [];

  for (const m of matched) {
    const beforeMs = Number(m.row.created_at);
    console.log(
      `  ${m.tag}: row id=${m.row.id} (matched via ${m.matchedVia} hash) created_at ${beforeMs} (${new Date(beforeMs).toISOString()}) -> ${m.correctedWhen} (${new Date(m.correctedWhen).toISOString()})`
    );
    if (beforeMs === m.correctedWhen) {
      console.log(`    already correct — skipping (idempotent).`);
      continue;
    }
    plan.push({ tag: m.tag, hash: m.row.hash, rowId: m.row.id, before: m.row.created_at, after: m.correctedWhen });
  }

  if (plan.length === 0) {
    console.log(`\nAll ${targets.length} target row(s) found on "${dbName}" and already at their corrected created_at — 0 rows need a change.`);
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
