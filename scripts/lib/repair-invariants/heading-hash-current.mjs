// Invariant for scripts/assert-repair-held.mjs: every stored
// `ipo_risk_factors.heading_hash` still equals what the CURRENT
// `headingHashForRiskFactor` computes from the row's own `heading`.
//
// Same shape as ../normalized-name-current.mjs (item 12 slice B's sibling for
// promoters/peer_companies/ipo_intermediaries' `normalized_name`) — that
// module cannot see this table. `normalizeHeading` / `headingHashForRiskFactor`
// (item 1 slice s6) lived on a different branch when that module and its s8b
// guard were written, so `heading_hash` has had NO runtime invariant until
// this slice (a correction of an earlier, wrong claim that s8b already
// covered it).
//
// WHY THIS EXISTS. `ipo_risk_factors.heading_hash` is the row's identity
// (`unique_ipo_risk_factors_ipo_heading_hash`, schema.ts) and it is
// `NOT NULL DEFAULT ''` — the same shape as `normalized_name` before it, for
// the same reason: ~2130 pre-existing rows had no hash when the column
// landed, so the default is what makes the journaled ADD COLUMN safe. If
// `normalizeHeading`/`headingHashForRiskFactor` ever changes, every existing
// stored key is minted by the OLD function and goes stale silently: the
// UNIQUE constraint still holds (it does not know the function changed), and
// nothing else re-checks that a stored key still equals what the current
// function computes. This is the check that goes red for that.
//
// THE NO-IDENTITY CASE IS NOT A VIOLATION. `headingHashForRiskFactor` returns
// null for a heading that is blank/whitespace/normalizes to nothing — such a
// row is not a risk factor and the writer must skip it — while the column
// default is `''`. Stored `''` against recomputed `null` is the documented
// no-identity pair, not a mismatch (mirrors the same rule in
// normalized-name-current.mjs).
//
// NO SECOND COPY OF THE DERIVE. This imports `headingHashForRiskFactor` from
// the TypeScript SSOT (packages/shared/src/utils/risk-factor-heading-key.ts)
// via Node's erasable type-stripping (22.10+), never re-implemented — a copy
// that drifts would make this invariant certify staleness it cannot see.
// If the runtime cannot load it, this throws — UNVERIFIABLE, not a silent
// pass.
//
// Two call shapes, matching the invariant contract (assert-repair-held.mjs):
//   1. Module form (used here, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: prints the violation count as the LAST line of stdout.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'utils',
  'risk-factor-heading-key.ts'
);

let headingHashForRiskFactor = null;
let deriveLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  headingHashForRiskFactor = mod.headingHashForRiskFactor;
} catch (e) {
  deriveLoadError = e;
}

/**
 * TWO OUTCOMES, deliberately distinguished — identical vocabulary to
 * normalized-name-current.mjs, on purpose (same defect class, same fix
 * shape).
 *
 * STALE is the real defect: a key that is populated but disagrees with what
 * the current derive computes from the row's own heading. One finding per
 * row, named, because each row is separately wrong.
 *
 * NOT_YET_BACKFILLED is a KNOWN TRANSIENT: a table where every row still
 * holds the column default ('') and not one row holds a computed key. That
 * is what this slot looks like between the `NOT NULL DEFAULT ''` migration
 * and the backfill that follows it (E2, per schema.ts's comment on this
 * column). Reporting one finding per row for that (potentially ~2130 on
 * prod) is technically true and practically useless — a check that screams
 * during a planned migration step is a check people learn to ignore, and
 * then it is ignored on the night it is right.
 *
 * IT STILL FAILS. NOT_YET_BACKFILLED reports ONE finding per table, never
 * zero. If it returned zero, a backfill that silently never ran would read
 * as a clean gate — the exact hole this invariant exists to close. One
 * line, not silence; and not one-per-row either.
 *
 * A table with NO rows is not "un-backfilled" — nothing is waiting.
 */
export const OUTCOME_STALE = 'STALE';
export const OUTCOME_NOT_YET_BACKFILLED = 'NOT_YET_BACKFILLED';

/** @typedef {{table: string, outcome: string, id?: string, ipoId?: string, name?: string, stored?: string, recomputed?: string|null, rowCount?: number}} ViolationDetail */

const TABLE = 'ipo_risk_factors';
const NAME_COL = 'heading';

async function tableFindings(pool) {
  const { rows } = await pool.query(
    `SELECT id, ipo_id, ${NAME_COL} AS name_value, heading_hash FROM ${TABLE}`
  );
  if (rows.length === 0) return [];

  const stale = [];
  let anyComputedKeyPresent = false;
  let waitingOnBackfill = 0;

  for (const r of rows) {
    const recomputed = headingHashForRiskFactor(r.name_value);
    const stored = r.heading_hash ?? '';
    // The documented no-identity pair: blank/whitespace heading -> null key,
    // column holds ''. Never a finding, and never evidence either way about
    // the backfill.
    if (recomputed === null && stored === '') continue;
    if (stored === recomputed) {
      anyComputedKeyPresent = true;
      continue;
    }
    if (stored === '') waitingOnBackfill += 1;
    stale.push({
      table: TABLE,
      outcome: OUTCOME_STALE,
      id: r.id,
      ipoId: r.ipo_id,
      name: r.name_value,
      stored,
      recomputed,
    });
  }

  // Every row that could carry a key is still holding the default, and not
  // one row anywhere on this table holds a computed key: this is the
  // migration window, not drift. Collapse to a single finding that says
  // which step is missing — but a finding, so the gate still fails.
  if (!anyComputedKeyPresent && waitingOnBackfill === stale.length && stale.length > 0) {
    return [{ table: TABLE, outcome: OUTCOME_NOT_YET_BACKFILLED, rowCount: waitingOnBackfill }];
  }
  return stale;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: ViolationDetail[]}>}
 */
export default async function headingHashCurrentInvariant(pool) {
  if (typeof headingHashForRiskFactor !== 'function') {
    throw new Error(
      `cannot import headingHashForRiskFactor from the SSOT — refusing to certify keys against a fold this process could not load. ${deriveLoadError?.message ?? ''}`
    );
  }
  const details = await tableFindings(pool);
  return { count: details.length, details };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const envPath = join(__dirname, '..', '..', '..', 'web', '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  installUtcTimestampParsing();
  const pool = createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 2,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 2 }
  );
  try {
    const { count, details } = await headingHashCurrentInvariant(pool);
    // Identities, never a bare count (signal-ownership R1).
    for (const d of details) {
      if (d.outcome === OUTCOME_NOT_YET_BACKFILLED) {
        console.error(
          `  NOT-YET-BACKFILLED: ${d.table} — all ${d.rowCount} row(s) still hold the column default and none holds a computed key. The backfill has not run on this slot.`
        );
      } else {
        console.error(
          `  VIOLATION (stale): ${d.table} id=${d.id} ipo_id=${d.ipoId} heading="${d.name}" stored="${d.stored}" recomputed="${d.recomputed}"`
        );
      }
    }
    if (!count) console.error('  ok: every stored heading_hash equals the current headingHashForRiskFactor of its row heading');
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: heading-hash-current invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
