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
 * WHAT: for the IPOs selected this run, every `field_sources` row, the `ipos`
 * row itself, and the CURRENT rows of every child table those `field_sources`
 * rows name (field_sources stores provenance and the PREVIOUS value, not the
 * current one -- the current value lives in the target table; review round 2
 * MINOR). A child table is read only if it exists and has an `ipo_id` column
 * (checked against information_schema, then quoted as an identifier). Written
 * as one JSON file. No new table and no new column (a schema change is
 * owner-gated); the file path is logged and returned so the run's summary
 * names it.
 *
 * TARGET: the payload AND the file name carry `DEPLOY_SLOT` and
 * `current_database()`, and `readFieldSourcesSnapshot(file, expected)` refuses
 * a snapshot taken on another database or slot -- a staging snapshot can never
 * be applied to prod (review round 2 MINOR).
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
  /** `current_database()` at the moment of the snapshot. */
  database: string;
  /** `DEPLOY_SLOT` of the process that took it (`unset` when absent). */
  deploySlot: string;
  ipoIds: string[];
  fieldSources: Array<Record<string, unknown>>;
  ipos: Array<Record<string, unknown>>;
  /** Current rows of each child table named by `fieldSources`, keyed by table name. */
  childRows: Record<string, Array<Record<string, unknown>>>;
}

export function currentDeploySlot(env: NodeJS.ProcessEnv = process.env): string {
  const slot = env.DEPLOY_SLOT?.trim();
  return slot ? slot : 'unset';
}

/** File-name safe: a slot or database name never adds a path separator. */
function fileToken(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, '_');
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
  const [dbRow] = rowsOf(await db.execute(sql`SELECT current_database() AS db`));
  const database = String(dbRow?.db ?? '');
  if (!database) throw new Error('F-31 snapshot: current_database() returned nothing');
  const deploySlot = currentDeploySlot();

  const named = [...new Set(fieldSources.map((r) => String(r.table_name ?? '')))].filter((t) => t && t !== 'ipos');
  const childRows: Record<string, Array<Record<string, unknown>>> = {};
  if (named.length > 0) {
    const readable = rowsOf(
      await db.execute(sql`SELECT table_name FROM information_schema.columns
                            WHERE table_schema = current_schema() AND column_name = 'ipo_id'
                              AND table_name = ANY(${sql.param(named)}::text[])
                            ORDER BY table_name`)
    ).map((r) => String(r.table_name));
    for (const table of readable) {
      childRows[table] = rowsOf(
        await db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE ipo_id = ANY(${sql.param(ipoIds)}::uuid[]) ORDER BY 1`)
      );
    }
  }

  const payload: FieldSourcesSnapshot = {
    kind: 'closed-ipo-field-sources-snapshot',
    takenAt: now.toISOString(),
    database,
    deploySlot,
    ipoIds,
    fieldSources,
    ipos: ipoRows,
    childRows,
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `field-sources-${fileToken(deploySlot)}-${fileToken(database)}-${now.toISOString().replace(/[:.]/g, '-')}.json`
  );
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { path: file, rows: fieldSources.length };
}

/**
 * Read a snapshot back (the rollback's input, and the proof that one exists).
 * `expected` is the target the caller is about to apply it to: a snapshot taken
 * on another database or slot is refused, so a staging snapshot can never be
 * applied to prod. A snapshot with no database/slot recorded is refused when a
 * target is given -- it cannot prove where it came from.
 */
export function readFieldSourcesSnapshot(
  file: string,
  expected?: { database: string; deploySlot: string }
): FieldSourcesSnapshot {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as FieldSourcesSnapshot;
  if (parsed.kind !== 'closed-ipo-field-sources-snapshot') {
    throw new Error(`${file} is not a closed-IPO field_sources snapshot`);
  }
  if (expected && (parsed.database !== expected.database || parsed.deploySlot !== expected.deploySlot)) {
    throw new Error(
      `refusing snapshot ${path.basename(file)}: taken on database '${parsed.database}' slot '${parsed.deploySlot}', ` +
        `not the target database '${expected.database}' slot '${expected.deploySlot}'`
    );
  }
  parsed.childRows = parsed.childRows ?? {};
  return parsed;
}
