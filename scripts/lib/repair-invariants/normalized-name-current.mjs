// Invariant for scripts/assert-repair-held.mjs: every stored `normalized_name`
// still equals what the CURRENT `rowKeyForName` computes from the row's name.
//
// WHY THIS EXISTS, and why row-key-populated.mjs is not enough. That invariant
// proves the key is POPULATED and UNIQUE. It cannot see a key that is populated,
// unique, and STALE — minted by an older version of the deriving function. Item
// 12 slice B changes that function, so between the code change and the re-key
// every stored key on these three tables is stale: the UNIQUE constraint still
// holds, row-key-populated still reports zero, and the constraint is guarding a
// key nothing computes any more. This invariant is the one that goes red for
// that, and it is what slice B's re-key is proven with.
//
// THE NO-IDENTITY CASE IS NOT A VIOLATION. `rowKeyForName` returns null for a
// blank name — the row carries no identity and the writer must skip it — while
// the column is NOT NULL DEFAULT ''. So stored '' against recomputed null is the
// documented no-identity pair, not a mismatch. It is counted by
// row-key-populated under its blank rule; double-counting it here would make two
// invariants argue about one row. Every OTHER divergence is a violation.
//
// NO FOURTH COPY OF THE DERIVE. This imports `rowKeyForName` from the
// TypeScript SSOT via Node's erasable type-stripping (22.10+). If the runtime
// cannot do that, it exits 2 — UNVERIFIABLE — which is honest. It does NOT
// hand-copy the function: a copy that drifts would make this invariant certify
// staleness it cannot see, which is worse than not running.
//
// Two call shapes, matching the invariant contract:
//   1. Module form (preferred, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: prints the violation count as the LAST line of stdout.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils', 'company-name-normalizer.ts');

let rowKeyForName = null;
let deriveLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  rowKeyForName = mod.rowKeyForName;
} catch (e) {
  deriveLoadError = e;
}

/** @typedef {{table: string, id: string, ipoId: string, name: string, stored: string, recomputed: string|null}} ViolationDetail */

const TABLES = [
  { table: 'promoters', nameCol: 'name' },
  { table: 'peer_companies', nameCol: 'company_name' },
  { table: 'ipo_intermediaries', nameCol: 'name' },
];

async function staleRows(pool, table, nameCol) {
  const { rows } = await pool.query(
    `SELECT id, ipo_id, ${nameCol} AS name_value, normalized_name FROM ${table}`
  );
  const out = [];
  for (const r of rows) {
    const recomputed = rowKeyForName(r.name_value);
    const stored = r.normalized_name ?? '';
    // The documented no-identity pair: blank name -> null key, column holds ''.
    if (recomputed === null && stored === '') continue;
    if (stored === recomputed) continue;
    out.push({ table, id: r.id, ipoId: r.ipo_id, name: r.name_value, stored, recomputed });
  }
  return out;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: ViolationDetail[]}>}
 */
export default async function normalizedNameCurrentInvariant(pool) {
  if (typeof rowKeyForName !== 'function') {
    throw new Error(
      `cannot import rowKeyForName from the SSOT — refusing to certify keys against a fold this process could not load. ${deriveLoadError?.message ?? ''}`
    );
  }
  const details = [];
  for (const { table, nameCol } of TABLES) {
    details.push(...(await staleRows(pool, table, nameCol)));
  }
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
    const { count, details } = await normalizedNameCurrentInvariant(pool);
    // Identities, never a bare count (signal-ownership R1).
    for (const d of details) {
      console.error(
        `  VIOLATION (stale): ${d.table} id=${d.id} ipo_id=${d.ipoId} name="${d.name}" stored="${d.stored}" recomputed="${d.recomputed}"`
      );
    }
    if (!count) console.error('  ok: every stored normalized_name equals the current rowKeyForName of its row name');
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: normalized-name-current invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
