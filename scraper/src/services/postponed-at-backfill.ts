/**
 * #1304 M1 (spec §2.9, clarified 2026-10-01): fill ipos.postponed_at for IPOs that were POSTPONED
 * before the column existed. Evidence, in the one form the system kept: the status field's
 * provenance row (field_sources, ipos.status), whose updated_at is when POSTPONED was written (W-60:
 * a POSTPONED status is never re-written by the scraper). Where no such row exists, nothing is
 * guessed: postponed_at stays NULL, the automatic relaunch clear does not fire for that IPO (a clear
 * missed, never added) and the IPO is listed for the admin (here and in d_postponed_at_unknown).
 *
 * Idempotent: only rows still NULL are touched, so a second run changes nothing. The UPDATE never
 * writes `status`, so the stamping trigger does not fire for it.
 */
import { sql } from 'drizzle-orm';

export interface ExecuteLike {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export interface PostponedAtEvidenceRow {
  ipoId: string;
  slug: string;
  /** field_sources.updated_at of the status provenance row, as the database's UTC text. */
  evidenceAt: string;
}

export interface PostponedAtPlan {
  fill: PostponedAtEvidenceRow[];
  /** POSTPONED, postponed_at NULL, no evidence: listed for the admin, never filled. */
  unknown: Array<{ ipoId: string; slug: string }>;
}

function rowsOf(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  return ((r as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
}

/** `ipoIds` empty = every POSTPONED IPO (the repair tools' `--ipo` scope convention). */
export async function planPostponedAtBackfill(db: ExecuteLike, ipoIds: readonly string[] = []): Promise<PostponedAtPlan> {
  const scope = ipoIds.length === 0 ? sql`TRUE` : sql`i.id = ANY(${`{${ipoIds.join(',')}}`}::uuid[])`;
  const rows = rowsOf(
    await db.execute(sql`
      SELECT i.id::text AS ipo_id, i.slug, fs.updated_at::text AS evidence_at
        FROM ipos i
        LEFT JOIN field_sources fs
          ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.row_key = '' AND fs.field_name = 'status'
       WHERE i.status = 'POSTPONED' AND i.postponed_at IS NULL AND ${scope}
       ORDER BY i.slug`)
  );
  const plan: PostponedAtPlan = { fill: [], unknown: [] };
  for (const r of rows) {
    const ipoId = String(r.ipo_id);
    const slug = String(r.slug);
    if (r.evidence_at == null || String(r.evidence_at) === '') plan.unknown.push({ ipoId, slug });
    else plan.fill.push({ ipoId, slug, evidenceAt: String(r.evidence_at) });
  }
  return plan;
}

/**
 * Writes the planned evidence. Re-checks every condition in the UPDATE itself (still POSTPONED, still
 * NULL, the evidence row still there), so a row that changed since the plan is skipped, not forced.
 * Returns the ids actually written.
 */
export async function applyPostponedAtBackfill(db: ExecuteLike, plan: PostponedAtPlan): Promise<string[]> {
  if (plan.fill.length === 0) return [];
  const ids = `{${plan.fill.map((r) => r.ipoId).join(',')}}`;
  const rows = rowsOf(
    await db.execute(sql`
      UPDATE ipos i SET postponed_at = fs.updated_at
        FROM field_sources fs
       WHERE i.id = ANY(${ids}::uuid[])
         AND i.status = 'POSTPONED' AND i.postponed_at IS NULL
         AND fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.row_key = '' AND fs.field_name = 'status'
      RETURNING i.id::text AS ipo_id`)
  );
  return rows.map((r) => String(r.ipo_id));
}
