// Shared UTC-session helper for every scripts/*.mjs pool. Mirrors
// packages/shared/src/db/timezone-config.ts — scripts/ has no dependency on
// packages/shared today, so this is a deliberate, small duplication rather
// than a new cross-package import.
//
// Two independent guarantees are BOTH required (round-2 finding, staging
// proof: m_blocked_all_age read 56.5h before / 56.8h after round 1 — only
// elapsed time moved):
//   1. `options: '-c timezone=UTC'` on the Pool -> the SESSION runs in UTC,
//      so now()/defaultNow() write UTC-naive and naive<->timestamptz
//      comparisons treat naive values as UTC. This fixes SERVER-SIDE SQL
//      comparisons (now() - interval, etc).
//   2. `installUtcTimestampParsing()` -> node-postgres parses a naive
//      `timestamp without time zone` (OID 1114) value AS UTC on READ,
//      independent of the OS process timezone. Without this, `pg` parses
//      the naive string as MACHINE-LOCAL time — so any age computed in
//      JAVASCRIPT from a Date object read out of a 1114 column (hoursBetween,
//      daysBetween, "new Date() - row.createdAt", etc.) is wrong by the
//      process's local UTC offset (+5.5h on the IST VPS). Guarantee 1 alone
//      does not fix this — it only fixes SQL-side now() comparisons.
import pg from 'pg';

const TIMESTAMP_OID = pg.types.builtins.TIMESTAMP; // 1114 — timestamp without time zone
// `timestamptz` (OID 1184) is intentionally NEVER overridden — pg's default
// parser already returns a correct absolute instant for it; overriding it
// would double-shift.

let parsingInstalled = false;

/**
 * Parse a Postgres `timestamp without time zone` text value as UTC.
 * Exported for unit testing. Returns `null` for SQL NULL.
 */
export function parseNaiveTimestampAsUtc(value) {
  if (value === null) return null;
  if (value === 'infinity') return new Date(8640000000000000);
  if (value === '-infinity') return new Date(-8640000000000000);
  const utcIso = value.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcIso);
  if (Number.isNaN(parsed.getTime())) {
    // Never break every read over one odd value; fall back to the default parse.
    return new Date(value);
  }
  return parsed;
}

/**
 * Install the UTC parser for `timestamp without time zone`. Idempotent — safe
 * to call from every script's entry point. Global to the `pg` module
 * (process-wide), so call it BEFORE the pool is created / any query runs.
 */
export function installUtcTimestampParsing() {
  if (parsingInstalled) return;
  pg.types.setTypeParser(TIMESTAMP_OID, parseNaiveTimestampAsUtc);
  parsingInstalled = true;
}

/**
 * Create a pg.Pool with the session pinned to UTC. All scripts/*.mjs pools
 * MUST go through this — never `new pg.Pool(` directly (enforced by
 * scripts/tests/pg-utc.test.mjs).
 */
export function createUtcPool(config) {
  return new pg.Pool({ ...config, options: '-c timezone=UTC' });
}

/**
 * Boot-time guard: fail fast (never silently skew every age check) if a
 * pool's session isn't UTC, OR if the 1114 parser isn't installed. The
 * round-trip on a naive timestamp catches the parser gap specifically: a pool
 * can have the right session timezone (guarantee 1) while the parser
 * (guarantee 2) is still missing, and the session-timezone check alone would
 * pass while every JS-computed age is still wrong.
 */
export async function assertUtcSession(pool) {
  const { rows } = await pool.query(`SELECT current_setting('TimeZone') AS tz`);
  const tz = rows[0]?.tz;
  if (tz !== 'UTC') {
    throw new Error(
      `FATAL: DB session timezone is "${tz}", expected "UTC". now()-based age checks would be wrong by the session's UTC offset. Fix the pool's "options: -c timezone=UTC".`
    );
  }

  const { rows: probeRows } = await pool.query(
    `SELECT '2026-01-01 00:00:00'::timestamp AS t`
  );
  const parsed = probeRows[0]?.t;
  const expected = Date.UTC(2026, 0, 1);
  if (!(parsed instanceof Date) || parsed.getTime() !== expected) {
    throw new Error(
      `FATAL: naive timestamp round-trip did not parse as UTC (got ${parsed}, expected ${new Date(expected).toISOString()}). installUtcTimestampParsing() was not called before this pool ran queries, so every JS-computed age (hoursBetween/daysBetween) is wrong by the process's local UTC offset.`
    );
  }
}
