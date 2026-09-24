/**
 * Item 19 / OD-92 (spec §2.3.3.3): what an EXACT unmerge needs, captured inside the merge
 * transaction before anything is deleted.
 *
 * §2.3.3.3 asks for "a merge log, not a diff ... the rows themselves" and says "every automatic
 * merge is reversible". Before OD-92 the log kept only a COUNT of the scraper-derived rows a merge
 * deletes (measured on ipodhan_staging 2026-09-24: the rays-of-belief merge removed 540 such rows
 * across 13 tables, including 119 gmp_records and 2 documents, none restorable). This module walks
 * the LIVE foreign-key graph from `pg_constraint` (not a hand-kept list) and captures:
 *   - every row the merge deletes directly, whole, as `to_jsonb(t.*)` text;
 *   - every row an ON DELETE CASCADE removes as a consequence, whole, at any depth;
 *   - every reference an ON DELETE SET NULL / SET DEFAULT clears, as (table, col, id, value).
 *
 * Reads only. The writes that put these rows back live in `IPORepository.unmergeDuplicate`.
 */
import { sql } from 'drizzle-orm';
import { reverseDependencyOrder, type FkEdge } from '../utils/duplicate-ipo-merge';

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** One single-column FK edge from the live catalog, with the referenced column and delete rule. */
export interface FkRuleEdge {
  child: string;
  col: string;
  parent: string;
  pcol: string;
  /** pg_constraint.confdeltype: a = no action, r = restrict, c = cascade, n = set null, d = set default */
  del: string;
}

export interface CapturedTableRows {
  table: string;
  /** Rows whole, as to_jsonb text (numerics keep their scale, timestamps their text). */
  rows: string[];
}

export interface NulledRef {
  table: string;
  col: string;
  id: string;
  value: string;
}

export interface MergeCapture {
  /** Parent-before-child restore order. */
  deletedRows: CapturedTableRows[];
  nulledRefs: NulledRef[];
}

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];

export async function readFkRuleEdges(tx: Exec): Promise<FkRuleEdge[]> {
  // Single-column FKs only; a multi-column FK would need tuple matching. Measured 2026-09-24:
  // ipodhan_test and ipodhan_staging both have zero multi-column FKs. One is refused, not skipped.
  const multi = rowsOf<{ n: number }>(
    await tx.execute(sql`
      select count(*)::int as n from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace and array_length(conkey, 1) > 1
    `)
  )[0]?.n;
  if (multi && multi > 0) {
    throw new Error(`merge capture: ${multi} multi-column foreign key(s) in public — capture cannot follow them, refusing`);
  }
  return rowsOf<FkRuleEdge>(
    await tx.execute(sql`
      select c.conrelid::regclass::text as child, a.attname::text as col,
             c.confrelid::regclass::text as parent, af.attname::text as pcol, c.confdeltype::text as del
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    `)
  );
}

function rowKey(text: string): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return parsed.id !== undefined && parsed.id !== null ? String(parsed.id) : text;
}

/**
 * Captures every row deleting `dropId`'s rows from `deleteTables` will remove, directly or by
 * cascade, plus every reference a SET NULL cascade will clear. Must run inside the merge
 * transaction, after the pair is locked and before the first delete.
 */
export async function captureMergeDeletions(
  tx: Exec,
  dropId: string,
  deleteTables: { table: string; col: string }[]
): Promise<MergeCapture> {
  const edges = await readFkRuleEdges(tx);
  const captured = new Map<string, Map<string, string>>();
  const nulled = new Map<string, NulledRef>();

  const add = (table: string, texts: string[]): string[] => {
    let m = captured.get(table);
    if (!m) captured.set(table, (m = new Map()));
    const fresh: string[] = [];
    for (const t of texts) {
      const k = rowKey(t);
      if (!m.has(k)) {
        m.set(k, t);
        fresh.push(t);
      }
    }
    return fresh;
  };

  let frontier: { table: string; rows: string[] }[] = [];
  for (const { table, col } of deleteTables) {
    const r = rowsOf<{ row: string }>(
      await tx.execute(sql`
        select to_jsonb(t.*)::text as row from ${sql.identifier(table)} t
        where t.${sql.identifier(col)} = ${dropId}
      `)
    ).map((x) => x.row);
    const fresh = add(table, r);
    if (fresh.length) frontier.push({ table, rows: fresh });
  }

  while (frontier.length) {
    const next: { table: string; rows: string[] }[] = [];
    for (const { table, rows } of frontier) {
      for (const e of edges.filter((x) => x.parent === table)) {
        const values = [
          ...new Set(
            rows
              .map((t) => (JSON.parse(t) as Record<string, unknown>)[e.pcol])
              .filter((v) => v !== null && v !== undefined)
              .map(String)
          ),
        ];
        if (!values.length) continue;
        if (e.del === 'c') {
          const r = rowsOf<{ row: string }>(
            await tx.execute(sql`
              select to_jsonb(t.*)::text as row from ${sql.identifier(e.child)} t
              where t.${sql.identifier(e.col)}::text = any(array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)))
            `)
          ).map((x) => x.row);
          const fresh = add(e.child, r);
          if (fresh.length) next.push({ table: e.child, rows: fresh });
        } else if (e.del === 'n' || e.del === 'd') {
          const r = rowsOf<{ id: string | null; value: string }>(
            await tx.execute(sql`
              select to_jsonb(t.*) ->> 'id' as id, t.${sql.identifier(e.col)}::text as value
              from ${sql.identifier(e.child)} t
              where t.${sql.identifier(e.col)}::text = any(array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)))
            `)
          );
          for (const x of r) {
            if (x.id === null || x.id === undefined) {
              throw new Error(`merge capture: ${e.child} has no id column, so a cleared ${e.col} cannot be logged — refusing`);
            }
            nulled.set(`${e.child}|${e.col}|${x.id}`, { table: e.child, col: e.col, id: x.id, value: x.value });
          }
        }
      }
    }
    frontier = next;
  }

  // A reference on a row that is itself deleted is restored with that row, not by an update.
  const nulledRefs = [...nulled.values()].filter((n) => !captured.get(n.table)?.has(n.id));
  return { deletedRows: restoreOrder(captured, edges), nulledRefs };
}

/** Parent-before-child order over the captured tables (the merge's delete order, reversed). */
export function restoreOrder(captured: Map<string, Map<string, string>>, edges: FkRuleEdge[]): CapturedTableRows[] {
  const reach = new Map<string, { col: string; parent: string }>();
  for (const t of captured.keys()) reach.set(t, { col: '', parent: '' });
  const fks: FkEdge[] = edges.filter((e) => e.child !== e.parent).map((e) => ({ child: e.child, col: e.col, parent: e.parent }));
  const childFirst = reverseDependencyOrder(reach, fks);
  return childFirst
    .reverse()
    .map((table) => ({ table, rows: [...(captured.get(table)?.values() ?? [])] }))
    .filter((t) => t.rows.length > 0);
}

/** What a merge log entry cannot restore; empty for an OD-92 (format 3) entry. */
export function missingForUnmerge(log: {
  restoreData: unknown;
  deletedChildCounts: unknown;
  dropRow: unknown;
}): string[] {
  const missing: string[] = [];
  const drop = (log.dropRow ?? {}) as Record<string, unknown>;
  if (!('company_name' in drop)) missing.push('drop_row predates #900 (declared columns only, camelCase)');
  const rd = log.restoreData as { format?: number } | null;
  if (rd && rd.format === 3) return missing;
  const counts = Array.isArray(log.deletedChildCounts) ? (log.deletedChildCounts as { table: string; count: number }[]) : [];
  for (const c of counts) {
    if (c.table !== 'field_sources' && c.count > 0) missing.push(`${c.table}: ${c.count} deleted row(s) logged as a count only`);
  }
  missing.push('rows removed by FK cascades below the deleted tables were not logged');
  missing.push('references cleared by ON DELETE SET NULL were not logged');
  missing.push('source keys superseded by an OD-86 relaunch merge: prior state not logged');
  return missing;
}
