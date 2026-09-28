/**
 * Reads the two populations of the admin queue (OD-63, spec §9.4): unresolved data_conflicts and
 * ipo_field_plan rows that hold no value, plus the admin holds that mark a field as handled.
 *
 * Deliberately NOT cached (BaseRepository.getFromCache is not used): the queue is the admin's to-do
 * list, and an item the admin just fixed in the IPO-page editor must leave it on the next load.
 * Dates are selected as ::text so no pool timezone can shift a calendar day (ist-timezone.md).
 */
import { sql } from 'drizzle-orm';
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

const IPO_COLUMNS = sql`i.id AS ipo_id, i.slug, i.company_name, i.status::text AS status,
  i.open_date::text AS open_date, i.close_date::text AS close_date, i.listing_date::text AS listing_date`;

export class AdminQueueRepository extends BaseRepository {
  async listUnresolvedConflicts(ipoSlug?: string): Promise<ConflictRow[]> {
    const r = await this.db.execute(sql`
      SELECT c.id, c.table_name, c.row_key, c.field_name, c.source1::text AS source1, c.value1,
             c.source2::text AS source2, c.value2, c.resolution_reason, c.document_id, ${IPO_COLUMNS}
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
