/**
 * F-31 (spec §6.4, §7.2): the `field_sources` snapshot the closed-IPO job takes
 * BEFORE it walks the first closed IPO of a run.
 *
 * WHY: `field_sources` holds ONE prior value per field. The closed-IPO job can
 * overwrite website-sourced values on historical rows, and after a second
 * overwrite the first value is gone -- "roll it back per field" is only true
 * if the state before the run was kept somewhere. §7.2: item 17 "is not
 * cleanly reversible ... needs F-31's field_sources snapshot taken before the
 * first row is walked".
 *
 * WHAT: for the IPOs selected this run, every `field_sources` row plus the
 * `ipos` row itself (field_sources stores provenance and the PREVIOUS value,
 * not the current one -- the current value lives in the target table), written
 * as one JSON file. No new table and no new column (a schema change is
 * owner-gated); the file path is logged and returned so the run's summary names
 * it. Child tables (financials, anchors, ...) are covered by their
 * `field_sources` rows only.
 *
 * WHERE: `CLOSED_IPO_SNAPSHOT_DIR`, else `~/.ipodhan/closed-ipo-snapshots` --
 * deliberately outside the deploy's release directory, which the release
 * retention prunes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';

type ExecDb = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export interface FieldSourcesSnapshot {
  kind: 'closed-ipo-field-sources-snapshot';
  takenAt: string;
  ipoIds: string[];
  fieldSources: Array<Record<string, unknown>>;
  ipos: Array<Record<string, unknown>>;
}

export function defaultClosedIpoSnapshotDir(): string {
  return process.env.CLOSED_IPO_SNAPSHOT_DIR || path.join(os.homedir(), '.ipodhan', 'closed-ipo-snapshots');
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return ((res as { rows?: Array<Record<string, unknown>> }).rows ?? (res as Array<Record<string, unknown>>)) || [];
}

/**
 * Read the snapshot rows and write them to `<dir>/field-sources-<stamp>.json`.
 * Written to a temp name then renamed, so a crash never leaves a half file
 * that reads as a complete snapshot. Throws on any failure -- the job then
 * walks nothing.
 */
export async function writeFieldSourcesSnapshot(
  db: ExecDb,
  ipoIds: string[],
  opts: { dir?: string; now?: Date } = {}
): Promise<{ path: string; rows: number }> {
  const dir = opts.dir ?? defaultClosedIpoSnapshotDir();
  const now = opts.now ?? new Date();
  // One bound array parameter (a bare `${ids}` expands into a broken parameter list).
  const fieldSources = rowsOf(
    await db.execute(sql`SELECT * FROM field_sources WHERE ipo_id = ANY(${sql.param(ipoIds)}::uuid[]) ORDER BY ipo_id, table_name, row_key, field_name`)
  );
  const ipoRows = rowsOf(
    await db.execute(sql`SELECT * FROM ipos WHERE id = ANY(${sql.param(ipoIds)}::uuid[]) ORDER BY id`)
  );
  const payload: FieldSourcesSnapshot = {
    kind: 'closed-ipo-field-sources-snapshot',
    takenAt: now.toISOString(),
    ipoIds,
    fieldSources,
    ipos: ipoRows,
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `field-sources-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { path: file, rows: fieldSources.length };
}

/** Read a snapshot back (the rollback's input, and the proof that one exists). */
export function readFieldSourcesSnapshot(file: string): FieldSourcesSnapshot {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as FieldSourcesSnapshot;
  if (parsed.kind !== 'closed-ipo-field-sources-snapshot') {
    throw new Error(`${file} is not a closed-IPO field_sources snapshot`);
  }
  return parsed;
}
