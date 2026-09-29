/**
 * §2.9 + OD-120 (§9.2 item 27, item 28(c)): when a POSTPONED IPO's relaunch filing arrives, admin
 * values on its DOCUMENT fields are cleared with the rest — the old terms must not survive the
 * relaunch. Runs inside the transaction that marks the relaunch document COMPLETED
 * (`writeReceiptAndReopen`), so the clear commits or rolls back with the document's status.
 *
 * For each admin-held document field set BEFORE this filing was discovered (`documents.created_at`):
 *   - the value is emptied (ipos / one-row child tables; a NOT NULL column keeps its value);
 *   - the hold (`field_protection_metadata`) and the ADMIN provenance row are removed, so the walk and
 *     the writers supply the new filing's value;
 *   - the field's plan row is re-asked (PENDING, due now);
 *   - one audit row keeps the old value, the admin's lineage (typed / picked / EMPTY with its reason)
 *     and what the new filing says — the handle the one-click re-apply uses (relaunch-reapply.ts).
 * An admin value written AFTER the filing arrived, or after an earlier relaunch clear of this IPO (a
 * re-apply), is already the relaunch's terms and stays,
 * so a later addendum on the still-POSTPONED IPO does not clear it again.
 *
 * Which fields are document fields is the caller's (the scraper's field manifest: a field any
 * document source ranks, never an E-1 timetable field). Identity fields are never cleared here: a
 * relaunch is the SAME company (OD-83) and emptying CIN / ISIN / symbol / name would break the OD-34
 * binding the relaunch record itself needs. Several-rows tables (peer_companies, documents) and
 * admin-owned lists (§9.2 item 8, not built yet) are out of this slice.
 */
import { sql, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { E1_EXCHANGE_STATED_FIELDS } from '../repositories/field-sources-repository';

export const RELAUNCH_CLEARED_AUDIT_ACTION = 'Relaunch Cleared';
export const RELAUNCH_SYSTEM_ACTOR = 'system (relaunch, OD-120)';

/** Never cleared on a relaunch: the identity the relaunch record binds by (OD-34, OD-83). */
export const RELAUNCH_KEEP_FIELDS: ReadonlySet<string> = new Set(['companyName', 'symbol', 'cin', 'isin']);

/** Read at call time, never at module load (a test that mocks the schema can still import the alert module). */
function oneRowTable(tableName: string): PgTable | undefined {
  const tables: Record<string, PgTable> = {
    ipos: schema.ipos,
    ipo_details: schema.ipoDetails,
    financial_data: schema.financialData,
    listing_performance: schema.listingPerformance,
    ipo_financials: schema.ipoFinancials,
    ipo_scores: schema.ipoScores,
  };
  return tables[tableName];
}

export interface ExecuteLike {
  execute: (query: any) => Promise<any>;
}

export interface RelaunchClearedValue {
  auditId: string;
  tableName: string;
  fieldName: string;
  oldValue: string | null;
  adminEmpty: boolean;
  newFilingValue: string | null;
}

export interface RelaunchClearSummary {
  ipoId: string;
  slug: string;
  companyName: string;
  status: string;
  documentId: string;
  documentType: string;
  cleared: RelaunchClearedValue[];
}

function rowsOf(r: unknown): Record<string, unknown>[] {
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  return ((r as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

function snake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Inside the COMPLETED transaction. Returns null when the IPO is not POSTPONED (nothing to do), else
 * the summary (possibly with no cleared values) for the one alert sent after commit.
 */
export async function clearAdminValuesOnRelaunch(
  tx: ExecuteLike,
  doc: { id: string; ipoId: string; type: string },
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>,
  isDocumentField: (tableName: string, fieldName: string) => boolean,
  now: Date = new Date()
): Promise<RelaunchClearSummary | null> {
  // The same row lock the admin write and every scraper writer take (field-hold.ts).
  const ipo = rowsOf(
    await tx.execute(sql`SELECT slug, company_name, status::text AS status FROM ipos WHERE id = ${doc.ipoId}::uuid FOR NO KEY UPDATE`)
  )[0] as { slug: string; company_name: string; status: string } | undefined;
  if (!ipo || ipo.status !== 'POSTPONED') return null;

  const held = rowsOf(
    await tx.execute(sql`
      SELECT fpm.table_name, fpm.field_name, fs.data_lineage, fs.id AS fs_id
        FROM field_protection_metadata fpm
        JOIN field_sources fs
          ON fs.ipo_id = fpm.ipo_id AND fs.table_name = fpm.table_name AND fs.row_key = '' AND fs.field_name = fpm.field_name
        JOIN documents d ON d.id = ${doc.id}::uuid
       WHERE fpm.ipo_id = ${doc.ipoId}::uuid
         AND fpm.is_protected = true
         AND fs.source = 'ADMIN'
         AND fpm.manually_edited_at < d.created_at
         -- set after an earlier relaunch clear of this IPO = already the relaunch's terms (a re-apply)
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs a
            WHERE a.ipo_id = fpm.ipo_id AND a.action_type = ${RELAUNCH_CLEARED_AUDIT_ACTION} AND a.success = true
              AND a.timestamp <= fpm.manually_edited_at)
       ORDER BY fpm.table_name, fpm.field_name`)
  ) as Array<{ table_name: string; field_name: string; data_lineage: Record<string, unknown> | null; fs_id: string }>;

  const summary: RelaunchClearSummary = {
    ipoId: doc.ipoId,
    slug: ipo.slug,
    companyName: ipo.company_name,
    status: ipo.status,
    documentId: doc.id,
    documentType: doc.type,
    cleared: [],
  };

  for (const h of held) {
    const table = oneRowTable(h.table_name);
    if (!table) continue; // `<table>:<rowKey>` holds (row tables) are out of this slice
    if (RELAUNCH_KEEP_FIELDS.has(h.field_name) || E1_EXCHANGE_STATED_FIELDS.has(h.field_name)) continue;
    if (!isDocumentField(h.table_name, h.field_name)) continue;
    const column = (getTableColumns(table) as Record<string, { name: string; notNull: boolean }>)[h.field_name];
    if (!column) continue;

    const whereCol = h.table_name === 'ipos' ? sql.raw('id') : sql.raw('ipo_id');
    const tbl = sql.raw(`"${h.table_name}"`);
    const col = sql.raw(`"${column.name}"`);
    const before = rowsOf(await tx.execute(sql`SELECT ${col}::text AS v FROM ${tbl} WHERE ${whereCol} = ${doc.ipoId}::uuid`))[0] as
      | { v: string | null }
      | undefined;
    const oldValue = before?.v ?? null;
    if (!column.notNull) {
      await tx.execute(sql`UPDATE ${tbl} SET ${col} = NULL WHERE ${whereCol} = ${doc.ipoId}::uuid`);
    }
    await tx.execute(sql`
      DELETE FROM field_protection_metadata WHERE ipo_id = ${doc.ipoId}::uuid AND table_name = ${h.table_name} AND field_name = ${h.field_name}`);
    await tx.execute(sql`DELETE FROM field_sources WHERE id = ${h.fs_id}::uuid`);
    await tx.execute(sql`
      UPDATE ipo_field_plan
         SET state = 'PENDING', next_due_at = ${now.toISOString()}::timestamptz, reason_code = NULL,
             cause = ${`relaunch filing ${doc.type} ${doc.id} cleared the admin value (OD-120)`},
             updated_at = ${now.toISOString()}::timestamptz
       WHERE ipo_id = ${doc.ipoId}::uuid AND table_name = ${h.table_name} AND row_key = ''
         AND field_name IN (${h.field_name}, ${snake(h.field_name)})`);

    const lineage = h.data_lineage ?? {};
    const adminEmpty = lineage.adminEmpty === true;
    const newFilingValue =
      receipt.find((r) => r.tableName === h.table_name && (r.rowKey ?? '') === '' && r.fieldName === h.field_name)?.value ?? null;
    const details = {
      method: 'RELAUNCH_CLEAR',
      decision: 'OD-120',
      documentId: doc.id,
      documentType: doc.type,
      adminEmpty,
      ...(adminEmpty ? { emptyReason: lineage.emptyReason ?? null } : {}),
      previousLineage: lineage,
      newFilingValue,
      valueKept: column.notNull,
    };
    const audit = rowsOf(
      await tx.execute(sql`
        INSERT INTO audit_logs (timestamp, admin_user, action_type, ipo_id, table_name, field_name, old_value, new_value, details, success, created_at)
        VALUES (${now.toISOString()}, ${RELAUNCH_SYSTEM_ACTOR}, ${RELAUNCH_CLEARED_AUDIT_ACTION}, ${doc.ipoId}::uuid, ${h.table_name},
                ${h.field_name}, ${oldValue}, ${column.notNull ? oldValue : null}, ${JSON.stringify(details)}::jsonb, true, ${now.toISOString()})
        RETURNING id`)
    )[0] as { id: string };
    summary.cleared.push({ auditId: audit.id, tableName: h.table_name, fieldName: h.field_name, oldValue, adminEmpty, newFilingValue });
  }
  return summary;
}
