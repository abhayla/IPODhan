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
 * Delete safety: inside one transaction, the fixture-matching rows are
 * re-SELECTed `FOR UPDATE` (locking them — which also blocks a concurrent
 * INSERT into `ipos` from acquiring the FK's FOR KEY SHARE lock on the same
 * row until this transaction ends), the ledger is written from THAT locked
 * selection (every column, so a mistaken delete can be rebuilt) BEFORE any
 * row is deleted, and the DELETE itself re-checks
 * `NOT EXISTS (SELECT 1 FROM ipos WHERE registrar_id = registrars.id)` in its
 * own WHERE clause — belt-and-suspenders against the lock scope ever being
 * narrower than assumed. `ipos.registrar_id` is `ON DELETE no action`, so an
 * unguarded delete of a referenced row would fail the whole transaction
 * anyway; this makes the refusal per-row and reported, not a crash.
 *
 * EXIT CODES (see also the `EXIT_*` constants below):
 *   0 — clean run: dry-run report, an --apply that deleted cleanly (or found
 *       nothing to do), or --check found no fixture rows.
 *   1 — --check found fixture rows still present (detection failure).
 *   2 — the script crashed (uncaught exception), OR a write committed but the
 *       post-apply readback found a surviving row (VERIFY failure).
 *   3 — refused: the prod guard blocked an --apply against the production
 *       database (pass --allow-prod to override).
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import logger from '../src/utils/logger.js';
import {
  guardCacheInvalidation,
  openRepairDb,
  writeLedgerFile,
  type RepairLedgerFieldChange,
} from './lib/repair-tool.js';

const TOOL_NAME = 'repair-remove-registrar-fixtures';

export const EXIT_OK = 0;
export const EXIT_CHECK_FOUND_FIXTURES = 1;
export const EXIT_CRASH_OR_VERIFY_FAIL = 2;
export const EXIT_PROD_GUARD_REFUSED = 3;

/**
 * The exact fixture tuples seeded by
 * `web/tests/integration/api/registrars.integration.test.ts`. MUST stay in
 * sync with that file — `scraper/tests/unit/scripts/
 * repair-remove-registrar-fixtures.test.ts` parses the test file's source
 * (via `parseFixtureTuplesFromSource` below) and asserts these are
 * identical, so the two cannot silently drift apart.
 */
export const FIXTURE_REGISTRARS: ReadonlyArray<{ name: string; email: string }> = [
  { name: 'Alpha Registrar Services Ltd', email: 'info@alpharegistrar.com' },
  { name: 'Beta Registrar Technologies', email: 'contact@betaregistrar.com' },
  { name: 'Gamma Corporate Services', email: 'support@gamma.com' },
];

/**
 * Parse every `name: <string>` / `email: <string>` pair out of a TypeScript
 * source string, in source order, accepting single-quoted, double-quoted AND
 * template-literal string forms (`'x'`, `"x"`, `` `x` ``) — a fixture array
 * can be written in any of the three, and the drift check must not silently
 * pass 0 pairs when the source happens to use a form the old single-quote-only
 * regex missed. `\b` keeps `name:` from matching inside `shortName:` (no word
 * boundary between the preceding letter and `N`/`n` there for either case, but
 * kept explicit rather than relying on that alone). Throws if the name/email
 * counts disagree — an unpaired count means the source shape changed under
 * the parser, never a silent zip-to-shortest.
 */
export function parseFixtureTuplesFromSource(source: string): Array<{ name: string; email: string }> {
  const STRING_LITERAL = "(?:'([^']*)'|\"([^\"]*)\"|`([^`]*)`)";
  const nameRe = new RegExp(`\\bname:\\s*${STRING_LITERAL}`, 'g');
  const emailRe = new RegExp(`\\bemail:\\s*${STRING_LITERAL}`, 'g');
  const extract = (re: RegExp): string[] =>
    [...source.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  const names = extract(nameRe);
  const emails = extract(emailRe);
  if (names.length !== emails.length) {
    throw new Error(
      `parseFixtureTuplesFromSource: ${names.length} name(s) vs ${emails.length} email(s) in source — cannot pair`
    );
  }
  return names.map((name, i) => ({ name, email: emails[i] }));
}

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

/**
 * `web/lib/cache/cache-keys.ts`'s `getRegistrarInvalidationKeys(id)`, re-stated
 * here rather than imported: probed directly (`npx tsx` importing that module
 * from `scraper/scripts/`) and confirmed that Node resolves it as CommonJS —
 * `web/package.json` sets no `"type"`, so the nearest ancestor that does is
 * the repo root's `"type": "commonjs"` — while `scraper/package.json` is
 * `"type": "module"`; `cjs-module-lexer` then fails to surface the file's
 * named exports across that boundary (`import * as m from
 * '../../web/lib/cache/cache-keys.js'` yields only `{ default: [Module
 * object] }`, not the ~30 named functions the source defines). MUST stay
 * byte-identical to `getRegistrarByIdKey`/`getRegistrarInvalidationKeys`
 * there (`registrar:${id}`, `registrars:*`, `registrar:name:*`) — a change to
 * either file without the other is a drift, same rationale as
 * `FIXTURE_REGISTRARS` above.
 */
function registrarInvalidationKeys(id: string): string[] {
  return ['registrars:*', `registrar:${id}`, 'registrar:name:*'];
}

/** Minimal shape `scanKeys` needs — matches ioredis's `Redis.scan` structurally without importing its overload union. */
interface ScannableRedis {
  scan(cursor: string, matchToken: 'MATCH', pattern: string, countToken: 'COUNT', count: number): Promise<[string, string[]]>;
}

/** Scan-based key lookup (never `KEYS`) — a cursor loop so a large keyspace is never blocked. */
async function scanKeys(redis: ScannableRedis, pattern: string): Promise<string[]> {
  const found = new Set<string>();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    for (const k of keys) found.add(k);
    cursor = next;
  } while (cursor !== '0');
  return [...found];
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

function reportCandidates(candidates: readonly CandidateRegistrarRow[], dbName: string): void {
  console.log(`current_database(): ${dbName}`);
  console.log(`fixture tuples: ${FIXTURE_REGISTRARS.length}`);
  for (const f of FIXTURE_REGISTRARS) {
    const count = candidates.filter((c) => c.name === f.name && c.email === f.email).length;
    console.log(`  "${f.name}" / ${f.email}: ${count} row(s)`);
  }
  console.log(`total candidate rows: ${candidates.length}`);
}

const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ledger path built from the script's own location (never `process.cwd()`,
 * which varies by where the tool was invoked from), under the gitignored
 * `scraper/evidence/` tree (confirmed via `git check-ignore`). The filename
 * carries the FULL timestamp (date + time + millis, colons/dots sanitized for
 * a Windows-safe filename) so a second run in the same run-day never
 * overwrites the first run's ledger.
 */
function ledgerFilePath(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(SCRAPER_ROOT, 'evidence', 'repair-remove-registrar-fixtures', `ledger-${stamp}.json`);
}

async function main(): Promise<number> {
  console.log('='.repeat(80));
  console.log(`REGISTRAR TEST-FIXTURE REMOVAL (#94) — ${CHECK ? 'CHECK' : APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  let refused = false;
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: TOOL_NAME,
    onRefuse: () => {
      refused = true;
    },
  });
  if (refused) return EXIT_PROD_GUARD_REFUSED;

  if (!APPLY) {
    const candidates = (await db
      .select({ id: schema.registrars.id, name: schema.registrars.name, email: schema.registrars.email })
      .from(schema.registrars)
      .where(fixtureWhereClause())) as CandidateRegistrarRow[];
    reportCandidates(candidates, dbName);

    if (CHECK) {
      if (candidates.length > 0) {
        console.log(`CHECK: FAIL — ${candidates.length} fixture row(s) present: ${candidates.map((c) => c.id).join(', ')}`);
        return EXIT_CHECK_FOUND_FIXTURES;
      }
      console.log('CHECK: PASS — no fixture rows present.');
      return EXIT_OK;
    }

    if (candidates.length === 0) {
      console.log('nothing to do.');
      return EXIT_OK;
    }

    const referencedRows = (await db
      .select({ registrarId: schema.ipos.registrarId })
      .from(schema.ipos)
      .where(inArray(schema.ipos.registrarId, candidates.map((c) => c.id)))) as { registrarId: string | null }[];
    const referencedIds = new Set(referencedRows.map((r) => r.registrarId).filter((id): id is string => id !== null));
    const { toDelete, skippedReferenced } = selectFixtureRowsForDeletion(candidates, referencedIds);

    for (const row of toDelete) {
      console.log(`  would delete: ${row.id} | "${row.name}" | ${row.email}`);
    }
    for (const row of skippedReferenced) {
      console.log(`  REFUSED (referenced by an IPO): ${row.id} | "${row.name}" | ${row.email}`);
    }
    console.log(`\ndeletable: ${toDelete.length} | refused (referenced): ${skippedReferenced.length}`);
    console.log('\nDRY-RUN: re-run with --apply to delete.');
    return EXIT_OK;
  }

  // --apply: everything that decides AND locks the rows happens inside one transaction.
  let ledgerPath: string | null = null;
  let ledgerGeneratedAt = '';
  let toDeleteRows: CandidateRegistrarRow[] = [];
  let skippedReferenced: CandidateRegistrarRow[] = [];
  let deletedIds: string[] = [];

  await db.transaction(async (tx) => {
    const locked = (await tx
      .select()
      .from(schema.registrars)
      .where(fixtureWhereClause())
      .for('update')) as unknown as CandidateRegistrarRow[];

    reportCandidates(locked, dbName);

    if (locked.length === 0) {
      console.log('nothing to do.');
      return;
    }

    const referencedRows = (await tx
      .select({ registrarId: schema.ipos.registrarId })
      .from(schema.ipos)
      .where(inArray(schema.ipos.registrarId, locked.map((c) => c.id)))) as { registrarId: string | null }[];
    const referencedIds = new Set(referencedRows.map((r) => r.registrarId).filter((id): id is string => id !== null));

    const sel = selectFixtureRowsForDeletion(locked, referencedIds);
    toDeleteRows = sel.toDelete;
    skippedReferenced = sel.skippedReferenced;

    for (const row of toDeleteRows) {
      console.log(`  DELETE: ${row.id} | "${row.name}" | ${row.email}`);
    }
    for (const row of skippedReferenced) {
      console.log(`  REFUSED (referenced by an IPO): ${row.id} | "${row.name}" | ${row.email}`);
    }
    console.log(`\ndeletable: ${toDeleteRows.length} | refused (referenced): ${skippedReferenced.length}`);

    if (toDeleteRows.length === 0) {
      console.log('nothing to delete (all candidates are referenced).');
      return;
    }

    // Ledger holds every column of each locked row (not just id/name/email) —
    // a mistaken delete can be rebuilt from it. Written BEFORE the delete,
    // from the FOR-UPDATE-locked selection, so `before` is exactly what the
    // delete is about to remove. `applied: false` until the transaction commits.
    const changes: RepairLedgerFieldChange[] = toDeleteRows.map((row) => ({
      table: 'registrars',
      rowKey: row.id,
      field: '(row)',
      before: row,
      after: null,
    }));
    const now = new Date();
    ledgerGeneratedAt = now.toISOString();
    ledgerPath = writeLedgerFile(ledgerFilePath(now), {
      tool: TOOL_NAME,
      mode: 'apply',
      generatedAt: ledgerGeneratedAt,
      changes,
      dbName,
      skippedReferenced,
      applied: false,
      deletedIds: [],
    });
    console.log(`ledger written (pending commit): ${ledgerPath}`);

    const idsToDelete = toDeleteRows.map((r) => r.id);
    const deleted = await tx
      .delete(schema.registrars)
      .where(
        and(
          inArray(schema.registrars.id, idsToDelete),
          // Belt-and-suspenders re-check at delete time — see file header.
          sql`NOT EXISTS (SELECT 1 FROM ${schema.ipos} WHERE ${schema.ipos.registrarId} = ${schema.registrars.id})`
        )
      )
      .returning({ id: schema.registrars.id });
    deletedIds = deleted.map((d) => d.id);

    const becameReferenced = idsToDelete.filter((id) => !deletedIds.includes(id));
    if (becameReferenced.length > 0) {
      console.log(`  REFUSED (became referenced during delete): ${becameReferenced.join(', ')}`);
      for (const id of becameReferenced) {
        const row = toDeleteRows.find((r) => r.id === id);
        if (row) skippedReferenced.push(row);
      }
    }
  });

  if (ledgerPath === null) {
    // Nothing was locked, or everything locked was referenced — no ledger, no delete.
    return EXIT_OK;
  }

  // Mark the ledger applied only now that the transaction has committed.
  writeLedgerFile(ledgerPath, {
    tool: TOOL_NAME,
    mode: 'apply',
    generatedAt: ledgerGeneratedAt,
    changes: toDeleteRows.map((row) => ({ table: 'registrars', rowKey: row.id, field: '(row)', before: row, after: null })),
    dbName,
    skippedReferenced,
    applied: true,
    deletedIds,
  });
  console.log(`ledger marked applied: ${ledgerPath}`);

  if (deletedIds.length === 0) {
    console.log('nothing was deleted (all candidates ended up referenced).');
    return EXIT_OK;
  }

  const survivors = (await db
    .select({ id: schema.registrars.id })
    .from(schema.registrars)
    .where(inArray(schema.registrars.id, deletedIds))) as { id: string }[];
  if (survivors.length > 0) {
    console.error(`VERIFY: FAILED — ${survivors.length} row(s) survived the delete: ${survivors.map((s) => s.id).join(', ')}`);
    return EXIT_CRASH_OR_VERIFY_FAIL;
  }
  console.log(`VERIFY: 0 rows remain of the ${deletedIds.length} deleted.`);
  console.log(`deleted count: ${deletedIds.length}`);

  const perIdKeys = deletedIds.flatMap((id) => registrarInvalidationKeys(id));
  const allKeys = [...new Set([...perIdKeys, 'registrars:*'])];
  const invalidationGuard = guardCacheInvalidation({
    dbName,
    toolName: TOOL_NAME,
    keys: allKeys,
  });
  if (!invalidationGuard.blocked) {
    const redis = getRedisClient();
    try {
      for (const pattern of allKeys) {
        const matched = await scanKeys(redis, pattern);
        if (matched.length > 0) await redis.del(...matched);
      }
    } catch (e) {
      console.warn(`Redis invalidation warning (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return EXIT_OK;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      logger.error({ error: e instanceof Error ? e.message : String(e) }, 'repair-remove-registrar-fixtures crashed');
      console.error(e);
      process.exit(EXIT_CRASH_OR_VERIFY_FAIL);
    });
}
