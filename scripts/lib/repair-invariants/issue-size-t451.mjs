// Built-in worked-example invariant for scripts/assert-repair-held.mjs (#192,
// T-466). Checks the nine T-451/T-452 rows against the exact issue_size
// value written by that repair (scripts/lib/fixtures/issue-size-t451-expected.json)
// — a regression is any drift AWAY from that value, not a plausibility band
// (c_issue_size_consistency in docs/reviews/detection-checks.json already
// covers the general band; this is the narrow "did THIS repair specifically
// hold" check named in the #192 proof).
//
// Two call shapes, both satisfy assert-repair-held.mjs's invariant contract:
//   1. Module form (preferred, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: `node scripts/lib/repair-invariants/issue-size-t451.mjs`
//      connects its own pool from DATABASE_URL/DATABASE_* env and prints the
//      violation count as the LAST line of stdout.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPECTED_PATH = join(__dirname, '..', 'fixtures', 'issue-size-t451-expected.json');

function loadExpected() {
  const raw = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
  const { _comment, ...expected } = raw;
  return expected;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: Array<{slug: string, expected: number|null, actual: number|null, found: boolean}>}>}
 */
export default async function issueSizeT451Invariant(pool) {
  const expected = loadExpected();
  const slugs = Object.keys(expected);
  const { rows } = await pool.query(
    `SELECT slug, issue_size FROM ipos WHERE slug = ANY($1::text[])`,
    [slugs]
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r.issue_size === null ? null : Number(r.issue_size)]));
  const details = slugs.map((slug) => {
    const exp = expected[slug];
    const found = bySlug.has(slug);
    const actual = found ? bySlug.get(slug) : null;
    return { slug, expected: exp, actual, found, violation: !found || actual !== exp };
  });
  const count = details.filter((d) => d.violation).length;
  return { count, details };
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
    const { count, details } = await issueSizeT451Invariant(pool);
    for (const d of details) {
      console.error(`  ${d.violation ? 'VIOLATION' : 'ok'}: ${d.slug} expected=${d.expected} actual=${d.actual} found=${d.found}`);
    }
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: issue-size-t451 invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
