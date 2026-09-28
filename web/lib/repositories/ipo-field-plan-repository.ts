/**
 * The read side of `ipo_field_plan` (lane A's item 5) — item 21 slice 4, OD-39.
 *
 * This repository answers one reader-facing question per field: who said this
 * number, and when was it last confirmed. It writes nothing. The walk that
 * fills the plan lives in the scraper workspace
 * (`scraper/src/services/field-plan-repository.ts`) and is not importable from
 * `web/`; this is a small read-only twin, not a reuse of that one.
 *
 * S2 (docs/design/s2-witnesses-plan.md) DROPPED `verify_due_at` and its four
 * sibling verify* columns from `ipo_field_plan` — 13,512/13,512 plan rows had
 * verify_due_at NULL, no scraper write path ever populated any of the five,
 * and the re-read loop that would have (item 9) was never built (OD-56
 * supersedes it). `FieldProvenance.isStale`, whose only input was that
 * column, is dropped with it — plan's option (a): drop the field, never
 * hard-code false, which would type-check as a permanently-false input a
 * later reader would trust.
 *
 * THE DATE is `chosen_confirmed_at` (item 21, OD-72): the moment the chosen
 * source was read, stamped by the plan repository when the row became
 * SUPPLIED. It used to be `updated_at`, which any write to the row bumps, so
 * the page's date drifted forward on churn. Rows supplied before the column
 * existed have no read date and the line names the source only.
 *
 * Cached under getIPOProvenanceKey(slug) so the OD-40 end-of-cycle call,
 * which carries slugs, drops it with the page's own key.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { fieldSources, ipoFieldPlan } from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';
import { getIPOProvenanceKey } from '@/lib/cache/cache-keys';

export interface FieldProvenance {
  /** `table.column` — the manifest's key and the plan row's own key. */
  key: string;
  tableName: string;
  fieldName: string;
  /** A `scraperSourceEnum`-shaped value, e.g. 'DOC', 'BSE'. */
  chosenSource: string | null;
  /** A `documentTypeEnum`-shaped value, e.g. 'RHP'. Null when the source is not a document. */
  chosenDocumentType: string | null;
  /**
   * When the chosen source was READ (`chosen_confirmed_at`, stamped when the
   * row became SUPPLIED). Null when no read date was recorded -- rows supplied
   * before the column existed. Never `updated_at`, which any write moves.
   */
  confirmedAt: Date | null;
}

/** Set by summariseFieldGroup when a block's fields do not share one source. */
export const MULTIPLE_SOURCES = 'MULTIPLE';

/** chosenSource of a TYPED admin value: the reader line says "Checked by the IPODhan team, <date>" (OD-109). */
export const ADMIN_TYPED_SOURCE = 'ADMIN';

/** camelCase property (field_sources.field_name) -> SQL column (the plan's and the manifest's key). */
function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** A stored text timestamp (UTC, no zone) as a Date. */
function utcDate(text: unknown): Date | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface AdminProvenanceRow {
  tableName: string;
  fieldName: string;
  lineage: unknown;
  updatedAt: string | null;
}

/**
 * §9.2 item 13 (OD-109): an admin value's reader line. A PICK names the source it was picked from and
 * that source's read date ("From NSE, read 25 Sep 2026"); a TYPED value is "Checked by the IPODhan
 * team, <date of the save>". Never the admin's name, never the word "correction". An admin-empty
 * value (OD-121) has no value to attribute, so it has no entry. Returns null for a row it cannot read.
 */
export function adminProvenanceFor(row: AdminProvenanceRow): FieldProvenance | { key: string; empty: true } | null {
  const lineage = row.lineage && typeof row.lineage === 'object' ? (row.lineage as Record<string, unknown>) : {};
  const key = `${row.tableName}.${toSnake(row.fieldName)}`;
  const note = typeof lineage.sourceNote === 'string' ? lineage.sourceNote.trim() : '';
  if (lineage.mode === 'typed' && lineage.adminEmpty === true && note === '') return { key, empty: true };
  if (lineage.mode === 'pick' && typeof lineage.sourceLabel === 'string') {
    return {
      key,
      tableName: row.tableName,
      fieldName: toSnake(row.fieldName),
      chosenSource: lineage.sourceLabel.trim().toUpperCase(),
      chosenDocumentType: null,
      confirmedAt: utcDate(lineage.readDate),
    };
  }
  if (lineage.mode === 'typed') {
    return {
      key,
      tableName: row.tableName,
      fieldName: toSnake(row.fieldName),
      chosenSource: ADMIN_TYPED_SOURCE,
      chosenDocumentType: null,
      confirmedAt: utcDate(row.updatedAt),
    };
  }
  return null;
}

export class IpoFieldPlanRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Every field this IPO's plan can speak for, keyed `table.column`.
   *
   * A field the plan has not supplied is left out rather than returned with
   * nulls. There is nothing truthful to say about it yet, and an entry with a
   * null source would reach the page as a line that names no source.
   */
  async getIPOProvenanceMap(ipoId: string, slug: string): Promise<Record<string, FieldProvenance>> {
    const cached = await this.getFromCache(
      getIPOProvenanceKey(slug),
      async () => {
        const [planRows, adminRows] = await Promise.all([
          this.db
            .select({
              tableName: ipoFieldPlan.tableName,
              rowKey: ipoFieldPlan.rowKey,
              fieldName: ipoFieldPlan.fieldName,
              state: ipoFieldPlan.state,
              chosenSource: ipoFieldPlan.chosenSource,
              chosenDocumentType: ipoFieldPlan.chosenDocumentType,
              chosenConfirmedAt: ipoFieldPlan.chosenConfirmedAt,
            })
            .from(ipoFieldPlan)
            .where(eq(ipoFieldPlan.ipoId, ipoId)),
          // An admin value is recorded in field_sources, never in the plan (the ONE admin write).
          this.db
            .select({
              tableName: fieldSources.tableName,
              fieldName: fieldSources.fieldName,
              lineage: fieldSources.dataLineage,
              updatedAt: sql<string>`${fieldSources.updatedAt}::text`,
            })
            .from(fieldSources)
            .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.rowKey, ''), eq(fieldSources.source, 'ADMIN'))),
        ]);
        return { planRows, adminRows };
      },
      900
    );
    // A value cached before this shape existed is a bare plan-row array.
    const rows = Array.isArray(cached) ? cached : cached?.planRows;
    const adminRows: AdminProvenanceRow[] = Array.isArray(cached) ? [] : (cached?.adminRows ?? []);

    const out: Record<string, FieldProvenance> = {};
    for (const row of rows ?? []) {
      if (!row.chosenSource) continue;
      // A singleton table's row_key is '' (see the schema comment on
      // ipoFieldPlan.rowKey), so its key collapses to the historical
      // `table.field` shape and every existing lookup (PROVENANCE_FIELD_GROUPS,
      // the manifest) still resolves. A multi-row table (financial_statements
      // per fiscal year) gets the row key threaded in, so two rows for the
      // same table.field never collapse onto one entry.
      const rowKey: string = (row.rowKey as string | undefined) ?? '';
      const key = rowKey ? `${row.tableName}.${rowKey}.${row.fieldName}` : `${row.tableName}.${row.fieldName}`;
      out[key] = {
        key,
        tableName: row.tableName,
        fieldName: row.fieldName,
        chosenSource: row.chosenSource,
        chosenDocumentType: row.chosenDocumentType ?? null,
        confirmedAt: row.chosenConfirmedAt ? new Date(row.chosenConfirmedAt) : null,
      };
    }
    for (const row of adminRows) {
      const p = adminProvenanceFor(row);
      if (!p) continue;
      if ('empty' in p) delete out[p.key];
      else out[p.key] = p;
    }
    return out;
  }
}

/**
 * One line for a block that shows several fields.
 *
 * The block is only as good as its weakest member, so: the OLDEST read date
 * wins, and one member with NO recorded read date leaves the whole block
 * without a date (a date shown for a block must be true of every field in
 * it -- OD-72, no fabricated date). The source is
 * named only when every field in the block agrees — a block whose issue size
 * came from the offer document and whose OFS came from BSE must not tell the
 * reader "from the offer document", which would be false about half of what
 * they are looking at.
 */
export function summariseFieldGroup(
  map: Record<string, FieldProvenance>,
  keys: readonly string[]
): FieldProvenance | null {
  const present = keys.map((key) => map[key]).filter(Boolean);
  if (present.length === 0) return null;

  const sources = new Set(present.map((p) => p.chosenSource));
  const unanimous = sources.size === 1;
  const undated = present.some((p) => !p.confirmedAt);
  const oldest = undated ? null : present.reduce<Date | null>((acc, p) => {
    if (!p.confirmedAt) return acc;
    if (!acc) return p.confirmedAt;
    return p.confirmedAt.getTime() < acc.getTime() ? p.confirmedAt : acc;
  }, null);

  return {
    key: present.map((p) => p.key).join('+'),
    tableName: unanimous ? present[0].tableName : '',
    fieldName: unanimous ? present[0].fieldName : '',
    chosenSource: unanimous ? present[0].chosenSource : MULTIPLE_SOURCES,
    chosenDocumentType: unanimous ? present[0].chosenDocumentType : null,
    confirmedAt: oldest,
  };
}
