import { types } from 'pg';
import type { Pool } from 'pg';

/**
 * Timezone normalization for the database layer (GitHub #28).
 *
 * Problem: `ipos` (and all) timestamp columns are `timestamp without time zone`
 * and the Postgres server default session tz is `Asia/Calcutta`. Under that
 * combination two classes of writer disagree:
 *   - app / Drizzle (`new Date()` -> `toISOString()`) store TRUE UTC wall-clock
 *   - Postgres `now()` / `defaultNow()` store IST wall-clock
 * so the same row's `created_at` (IST) and `last_scraped_at` (UTC) differ by
 * 5h30m, and any `now()`-relative server-side query mis-reads the UTC-naive
 * values as IST.
 *
 * Fix (two independent guarantees, both required):
 *   1. `options: '-c timezone=UTC'` on every Pool  -> the SESSION runs in UTC, so
 *      `now()`/`defaultNow()` write UTC-naive and naive<->timestamptz comparisons
 *      treat naive values as UTC. (applied in the pool initializers)
 *   2. `configureUtcTimestampParsing()` (here) -> node-postgres parses a naive
 *      `timestamp without time zone` value AS UTC on READ, independent of the OS
 *      process timezone. This removes the dependency on `TZ=UTC` actually reaching
 *      the Node process (PM2 on the VPS does NOT reliably propagate it — the VPS
 *      process reports `Asia/Calcutta` despite `ecosystem.config.js` `TZ:'UTC'`).
 */

const TIMESTAMP_OID = types.builtins.TIMESTAMP; // 1114 — timestamp without time zone
// NOTE: `timestamptz` (OID 1184) is intentionally NOT overridden — pg's default
// parser already returns a correct absolute instant for it; overriding would
// double-shift. Only the naive `timestamp` (1114) needs UTC normalization.

let configured = false;

/**
 * Parse a Postgres `timestamp without time zone` text value as UTC.
 * Exported for unit testing. Returns `null` for SQL NULL.
 */
export function parseNaiveTimestampAsUtc(value: string | null): Date | null {
  if (value === null) return null;
  // Postgres emits these sentinels for unbounded timestamps.
  if (value === 'infinity') return new Date(8640000000000000);
  if (value === '-infinity') return new Date(-8640000000000000);

  // Naive value e.g. '2026-06-15 14:55:32.123' — interpret the wall-clock as UTC.
  const utcIso = value.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcIso);
  if (Number.isNaN(parsed.getTime())) {
    // Never break every read over one odd value; fall back to the default parse.
    return new Date(value);
  }
  return parsed;
}

/**
 * Install the UTC parser for `timestamp without time zone`. Idempotent — safe to
 * call from every pool initializer. Global to the `pg` module (process-wide).
 */
export function configureUtcTimestampParsing(): void {
  if (configured) return;
  types.setTypeParser(TIMESTAMP_OID, parseNaiveTimestampAsUtc as (value: string) => Date | null);
  configured = true;
}

/**
 * Boot-time guard: fail fast if a pool's session timezone is not UTC, so a
 * mis-configured connection surfaces immediately instead of silently skewing
 * `now()`-based writes by the server's local offset (environment-validation.md).
 */
export async function assertSessionTimezoneUtc(pool: Pool): Promise<void> {
  const { rows } = await pool.query('SHOW timezone');
  const tz = rows[0]?.TimeZone;
  if (tz !== 'UTC') {
    throw new Error(
      `Database session timezone must be 'UTC' but is '${tz}'. ` +
        `Set options:'-c timezone=UTC' on the connection pool (GitHub #28).`
    );
  }
}
