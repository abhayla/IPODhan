/**
 * Reads the two populations of the admin queue (OD-63, spec §9.4): unresolved data_conflicts and
 * ipo_field_plan rows that hold no value, plus the admin holds that mark a field as handled.
 *
 * This repository's own reads are NOT cached (BaseRepository.getFromCache is not used here): the
 * queue is the admin's to-do list, and an item the admin just fixed in the IPO-page editor must
 * leave it on the next load. The paged queue built on top of it (admin-queue-page-repository.ts)
 * DOES cache its JS-side setup and whole-queue counts for CacheTTL.ADMIN_QUEUE seconds — every
 * admin save drops that cache at once (adminQueueCacheKeys) — but the page's own SQL always runs
 * live, so a brand-new IPO or a resolved conflict is never delayed by that cache (item 1, A4 review).
 * Dates are selected as ::text so no pool timezone can shift a calendar day (ist-timezone.md).
 */
import { eq, sql } from 'drizzle-orm';
import { ipos } from '@ipodhan/shared/db/schema';
import { ADMIN_WRITABLE_TABLES } from '@ipodhan/shared/services/admin-field-write';
import { BaseRepository } from './base-repository';

/** OD-62 / S4: the plan states that mean "no source supplied a value". */
export const NO_VALUE_PLAN_STATES = ['NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED'] as const;

export interface IpoRow {
  ipo_id: string;
  slug: string;
  company_name: string;
  status: string;
  open_date: string | null;
  close_date: string | null;
  listing_date: string | null;
}

export interface ConflictRow extends IpoRow {
  id: string;
  table_name: string;
  row_key: string;
  field_name: string;
  source1: string;
  value1: string | null;
  source2: string;
  value2: string | null;
  resolution_reason: string | null;
  document_id: string | null;
  /** The row's evidence (a list suggestion carries its rows to add / remove / change, OD-107). */
  evidence?: unknown;
}

export interface PlanRow extends IpoRow {
  id: string;
  table_name: string;
  row_key: string;
  field_name: string;
  state: string;
  reason_code: string | null;
}

export interface HoldRow {
  ipo_id: string;
  table_name: string;
  field_name: string;
}

export const IPO_COLUMNS = sql`i.id AS ipo_id, i.slug, i.company_name, i.status::text AS status,
  i.open_date::text AS open_date, i.close_date::text AS close_date, i.listing_date::text AS listing_date`;

export class AdminQueueRepository extends BaseRepository {
  async listUnresolvedConflicts(ipoSlug?: string): Promise<ConflictRow[]> {
    const r = await this.db.execute(sql`
      SELECT c.id, c.table_name, c.row_key, c.field_name, c.source1::text AS source1, c.value1,
             c.source2::text AS source2, c.value2, c.resolution_reason, c.document_id, c.evidence, ${IPO_COLUMNS}
        FROM data_conflicts c JOIN ipos i ON i.id = c.ipo_id
       WHERE c.resolved_at IS NULL ${ipoSlug ? sql`AND i.slug = ${ipoSlug}` : sql``}`);
    return (r.rows ?? []) as unknown as ConflictRow[];
  }

  async listNoValuePlanRows(ipoSlug?: string): Promise<PlanRow[]> {
    const r = await this.db.execute(sql`
      SELECT p.id, p.table_name, p.row_key, p.field_name, p.state::text AS state, p.reason_code, ${IPO_COLUMNS}
        FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
       WHERE p.state::text IN ('NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED')
         ${ipoSlug ? sql`AND i.slug = ${ipoSlug}` : sql``}`);
    return (r.rows ?? []) as unknown as PlanRow[];
  }

  /**
   * Admin holds backed by an admin value or an admin delete (the one admin write sets both
   * is_protected and manually_edited_at, packages/shared/src/services/admin-field-write.ts). A
   * row table's hold is keyed `<table>:<rowKey>` (protectionTableName).
   */
  async listAdminHolds(): Promise<HoldRow[]> {
    const r = await this.db.execute(sql`
      SELECT ipo_id, table_name, field_name FROM field_protection_metadata
       WHERE is_protected = true AND manually_edited_at IS NOT NULL`);
    return (r.rows ?? []) as unknown as HoldRow[];
  }
}

/** One-row-per-IPO tables whose stored value the queue may show next to a plan state (admin write's list). */
export const STORED_VALUE_TABLES: readonly string[] = ADMIN_WRITABLE_TABLES;

export class AdminQueueStoredRowsRepository extends BaseRepository {
  /**
   * Every IPO's stored `ipos` row, as drizzle maps it (the shape validateIPOData checks on every
   * write). ~400 rows on staging: one indexless scan, measured in the A4 report.
   */
  async listIposRows(ipoSlug?: string): Promise<Array<Record<string, unknown>>> {
    const q = this.db.select().from(ipos);
    const rows = ipoSlug ? await q.where(eq(ipos.slug, ipoSlug)) : await q;
    return rows as unknown as Array<Record<string, unknown>>;
  }

  /** The stored rows of one one-row-per-IPO table for the given IPOs, keys in camelCase. */
  async storedRows(tableName: string, ipoIds: string[]): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    if (!STORED_VALUE_TABLES.includes(tableName) || ipoIds.length === 0) return out;
    const idCol = tableName === 'ipos' ? sql`t.id` : sql`t.ipo_id`;
    const r = await this.db.execute(sql`
      SELECT ${idCol}::text AS ipo_id, to_jsonb(t) AS row FROM ${sql.identifier(tableName)} t
       WHERE ${idCol} IN (${sql.join(ipoIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const row of (r.rows ?? []) as Array<{ ipo_id: string; row: Record<string, unknown> }>) {
      const camel: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.row)) camel[k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = v;
      out.set(row.ipo_id, camel);
    }
    return out;
  }
}
