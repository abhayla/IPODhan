import { sql } from 'drizzle-orm';

/**
 * The database's clock, read inside the caller's transaction (F-210, class `mixed-clock-ordering`).
 *
 * An admin save is later ordered against times the DATABASE stamped (documents.created_at,
 * data_conflicts.detected_at, every `defaultNow()` column). Stamping the save from the app host's
 * clock (`new Date()`) mixes two machines' clocks, and any drift between them misorders every event
 * that falls inside the drift. `now()` is the transaction's start time, so every stamp of one save
 * read through this function is identical, and it is on the same clock as the rows it is compared with.
 *
 * Read as UTC ISO text (not a timestamptz value) so no type parser or session setting can shift it;
 * precision is milliseconds (a JS Date), truncated.
 */
export async function readDatabaseNow(tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }): Promise<Date> {
  const result = await tx.execute(
    sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS db_now`
  );
  const rows = ((result as { rows?: unknown[] })?.rows ?? (Array.isArray(result) ? result : [])) as Array<{ db_now?: unknown }>;
  const text = rows[0]?.db_now;
  const at = typeof text === 'string' ? new Date(text) : new Date(NaN);
  if (Number.isNaN(at.getTime())) throw new Error(`readDatabaseNow: the database returned no usable now() (${String(text)})`);
  return at;
}
