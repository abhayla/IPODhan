/**
 * §2.9 + OD-120 (§9.2 items 27, 28(c), 8): when a POSTPONED IPO's RELAUNCH FILING arrives, admin
 * values on its DOCUMENT fields, and its admin-owned lists, are cleared — the old terms must not
 * survive the relaunch.
 *
 * "Relaunch filing" (§9.2 item 27, defined 2026-09-29 from OD-83 / OD-86) is exactly one of:
 *   - SOURCE_KEY_RELAUNCH: an exchange record that supersedes the IPO's older source key under OD-83
 *     (`state_reason` 'OD-83 relaunch: ...') or an OD-86 relaunch merge ('OD-86 relaunch merge: ...');
 *   - OFFER_DOCUMENT: an RHP, PROSPECTUS or PRICE_BAND_AD first discovered AFTER the IPO became
 *     POSTPONED whose own extracted open/close date or price band differs from the stored one.
 * A postponement notice, an addendum or corrigendum of the old offer, a re-extraction of an old
 * document, or a side document clears nothing.
 *
 * For each admin value set BEFORE this relaunch started (the earliest relaunch event after the latest
 * postponement; a value set after it, such as a re-apply, is already the relaunch's terms):
 *   - the value is emptied (ipos / one-row child tables; a NOT NULL column keeps its value);
 *   - the hold and the ADMIN provenance row are removed, the field's plan row is re-asked;
 *   - one audit row keeps the old value, the admin lineage (typed / picked / EMPTY + reason) and what
 *     the new filing says: the handle the re-apply uses (relaunch-reapply.ts).
 * An admin-owned child list (item 8) has its whole-list hold released (rows kept, so the new filing's
 * list replaces them) and one audit row with the list as it was.
 *
 * #1298 (§2.9, the rest): every NON-admin document-sourced value set before this relaunch started is
 * invalidated the same way (emptied, provenance removed, plan row re-asked), and one `Relaunch Filing`
 * audit row records that the relaunch arrived — the evidence `readPostponedRelaunchState` gives the
 * status guard, so an exchange may then move the IPO off POSTPONED.
 *
 * Identity fields are never cleared: a relaunch is the SAME company (OD-83), and emptying CIN / ISIN /
 * symbol / name would break the OD-34 binding the relaunch record itself needs. E-1 exchange fields
 * follow OD-106, not this rule.
 */
import { sql, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { readDatabaseNow } from '../db/database-clock';
import { E1_EXCHANGE_STATED_FIELDS } from '../repositories/field-sources-repository';
import { ADMIN_LISTS, ADMIN_LIST_SPECS, LIST_HOLD_FIELD, type AdminListName } from './admin-list-hold';

export const RELAUNCH_CLEARED_AUDIT_ACTION = 'Relaunch Cleared';
/**
 * #1298 (§2.9): ONE row per confirmed relaunch filing of a POSTPONED IPO, written whether or not
 * anything was cleared. It is the record that the relaunch arrived (the status reader below reads it)
 * and the audit trail of the non-admin document values it invalidated.
 */
export const RELAUNCH_FILING_AUDIT_ACTION = 'Relaunch Filing';
export const RELAUNCH_SYSTEM_ACTOR = 'system (relaunch, OD-120)';

/** Never cleared on a relaunch: the identity the relaunch record binds by (OD-34, OD-83). */
export const RELAUNCH_KEEP_FIELDS: ReadonlySet<string> = new Set(['companyName', 'symbol', 'cin', 'isin']);

/** Offer documents that can carry a relaunch's new terms. An addendum / corrigendum amends the old offer. */
export const RELAUNCH_OFFER_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['RHP', 'PROSPECTUS', 'PRICE_BAND_AD']);

/** The `ipo_source_keys.state_reason` prefixes the OD-83 supersede and the OD-86 merge write. */
export const RELAUNCH_KEY_REASON_PREFIXES = ['OD-83 relaunch:', 'OD-86 relaunch merge:'] as const;

/** The window and band a relaunch changes (OD-83: "new exchange dates"; §2.9 "a revised price band"). */
const WINDOW_BAND_FIELDS: ReadonlyArray<{ field: string; column: string; kind: 'date' | 'number' }> = [
  { field: 'openDate', column: 'open_date', kind: 'date' },
  { field: 'closeDate', column: 'close_date', kind: 'date' },
  { field: 'priceRangeMin', column: 'price_range_min', kind: 'number' },
  { field: 'priceRangeMax', column: 'price_range_max', kind: 'number' },
];

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

/** The multi-row document lists §2.9 invalidates (the admin-list tables that are child rows). */
function relaunchListTables(): Record<string, PgTable> {
  return {
    promoters: schema.promoters,
    peer_companies: schema.peerCompanies,
    ipo_intermediaries: schema.ipoIntermediaries,
    ipo_risk_factors: schema.ipoRiskFactors,
    financial_statements: schema.financialStatements,
  };
}

export interface ExecuteLike {
  execute: (query: any) => Promise<any>;
}

export type RelaunchTrigger =
  | { kind: 'OFFER_DOCUMENT'; documentId: string; documentType: string }
  | { kind: 'SOURCE_KEY_RELAUNCH'; supersededKeyIds: readonly string[] };

export interface RelaunchClearedValue {
  auditId: string;
  tableName: string;
  fieldName: string;
  oldValue: string | null;
  adminEmpty: boolean;
  newFilingValue: string | null;
  /** Set for an admin-owned list (item 8): its hold was released; there is no one-click re-apply. */
  list?: string;
}

export interface RelaunchClearSummary {
  ipoId: string;
  slug: string;
  companyName: string;
  status: string;
  /** The relaunch handle: the offer document's id, or the superseded source key's id. */
  documentId: string;
  /** What the relaunch filing was, for the alert ("RHP", "OD-83 relaunch: superseded by 7900 ..."). */
  documentType: string;
  cleared: RelaunchClearedValue[];
  /** #1298 (§2.9): non-admin document-sourced values invalidated by this relaunch (no alert, no re-apply). */
  invalidated?: RelaunchInvalidatedValue[];
}

/** #1298: a document-sourced (source DRHP), non-admin value the relaunch emptied and re-asked. */
export interface RelaunchInvalidatedValue {
  tableName: string;
  fieldName: string;
  oldValue: string | null;
  /** A NOT NULL column keeps its value (only its provenance and plan row are reset). */
  valueKept: boolean;
}

function rowsOf(r: unknown): Record<string, unknown>[] {
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  return ((r as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

function snake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toInstant(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * #1304 M1 (§2.9, clarified 2026-10-01): when the IPO last MOVED to POSTPONED - ipos.postponed_at,
 * stamped on the database clock by the status write itself (trigger ipos_stamp_postponed_at). Not the
 * status provenance row: its updated_at is the last provenance write, which can come after the
 * relaunch filing, and 41 of 397 staging IPOs had none. NULL = unknown: the offer-document clear does
 * not fire (a clear missed, never added) and the IPO is listed for the admin.
 */
export async function readPostponedAt(tx: ExecuteLike, ipoId: string): Promise<Date | null> {
  return toInstant(
    (rowsOf(await tx.execute(sql`SELECT postponed_at::text AS at FROM ipos WHERE id = ${ipoId}::uuid`))[0] as
      | { at?: string | null }
      | undefined)?.at
  );
}

function sameWindowBandValue(kind: 'date' | 'number', a: unknown, b: unknown): boolean {
  if (kind === 'date') return String(a).slice(0, 10) === String(b).slice(0, 10);
  return Number(a) === Number(b);
}

/**
 * Pure: the window / band fields the new document states differently from the stored row. Only a
 * value the document actually states counts; a field it does not state is no evidence either way.
 */
export function windowOrBandChanges(
  stored: Record<string, unknown>,
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>
): string[] {
  const changed: string[] = [];
  for (const f of WINDOW_BAND_FIELDS) {
    const r = receipt.find((x) => x.tableName === 'ipos' && (x.rowKey ?? '') === '' && x.fieldName === f.field);
    if (r?.value == null || r.value === '') continue;
    const cur = stored[f.column];
    if (cur == null || cur === '' || !sameWindowBandValue(f.kind, cur, r.value)) changed.push(f.field);
  }
  return changed;
}

/**
 * Is this a relaunch filing (definition above)? Returns the instant the relaunch arrived and a label,
 * or null. Reads inside the caller's transaction, after the `ipos` row lock.
 */
async function relaunchPoint(
  tx: ExecuteLike,
  ipoId: string,
  trigger: RelaunchTrigger,
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>,
  postponedAt: Date | null
): Promise<{ at: Date; handle: string; label: string } | null> {
  if (trigger.kind === 'SOURCE_KEY_RELAUNCH') {
    if (trigger.supersededKeyIds.length === 0) return null;
    const ids = sql.join(trigger.supersededKeyIds.map((id) => sql`${id}::uuid`), sql`, `);
    const keys = rowsOf(
      await tx.execute(sql`
        SELECT id, state_reason, state_changed_at::text AS at FROM ipo_source_keys
         WHERE ipo_id = ${ipoId}::uuid AND state = 'SUPERSEDED' AND id IN (${ids})
         ORDER BY state_changed_at DESC`)
    ) as Array<{ id: string; state_reason: string | null; at: string | null }>;
    const hit = keys.find((k) => RELAUNCH_KEY_REASON_PREFIXES.some((p) => (k.state_reason ?? '').startsWith(p)));
    const at = hit ? toInstant(hit.at) : null;
    return hit && at ? { at, handle: hit.id, label: hit.state_reason ?? 'OD-83 relaunch' } : null;
  }
  if (!RELAUNCH_OFFER_DOCUMENT_TYPES.has(trigger.documentType)) return null;
  // Discovered after the postponement: a document seen before it (re-extracted now) is the old offer.
  if (!postponedAt) return null;
  const doc = rowsOf(
    await tx.execute(sql`SELECT created_at::text AS at FROM documents WHERE id = ${trigger.documentId}::uuid AND ipo_id = ${ipoId}::uuid`)
  )[0] as { at: string | null } | undefined;
  const discoveredAt = toInstant(doc?.at);
  if (!discoveredAt || !(discoveredAt.getTime() > postponedAt.getTime())) return null;
  const stored = rowsOf(
    await tx.execute(sql`
      SELECT open_date::text AS open_date, close_date::text AS close_date, price_range_min, price_range_max
        FROM ipos WHERE id = ${ipoId}::uuid`)
  )[0] ?? {};
  // #1298 round 1: in production the filing persister writes this document's values BEFORE the clear
  // runs, so the stored band already IS the new one. A window/band value written at or after this
  // document was discovered is compared through its provenance's previous value (what was stored before).
  const prov = rowsOf(
    await tx.execute(sql`
      SELECT field_name, previous_value, updated_at::text AS at, data_lineage->>'documentId' AS doc FROM field_sources
       WHERE ipo_id = ${ipoId}::uuid AND table_name = 'ipos' AND row_key = ''
         AND field_name IN ('openDate', 'closeDate', 'priceRangeMin', 'priceRangeMax')`)
  ) as Array<{ field_name: string; previous_value: string | null; at: string | null; doc: string | null }>;
  const before: Record<string, unknown> = { ...stored };
  for (const f of WINDOW_BAND_FIELDS) {
    const r = prov.find((x) => x.field_name === f.field);
    const at = toInstant(r?.at);
    if (r && (r.doc === trigger.documentId || (at && at.getTime() >= discoveredAt.getTime()))) before[f.column] = r.previous_value;
  }
  if (windowOrBandChanges(before, receipt).length === 0) return null;
  return { at: discoveredAt, handle: trigger.documentId, label: trigger.documentType };
}

/**
 * Inside the relaunch's transaction. Returns null when nothing here is a relaunch filing of a POSTPONED
 * IPO, else the summary (possibly with no cleared values) for the one alert sent after commit.
 */
export async function clearAdminValuesOnRelaunch(
  tx: ExecuteLike,
  ipoId: string,
  trigger: RelaunchTrigger,
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>,
  isDocumentField: (tableName: string, fieldName: string) => boolean,
  nowOverride?: Date
): Promise<RelaunchClearSummary | null> {
  // The same row lock the admin write and every scraper writer take (field-hold.ts).
  const ipo = rowsOf(
    await tx.execute(sql`SELECT slug, company_name, status::text AS status FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`)
  )[0] as { slug: string; company_name: string; status: string } | undefined;
  if (!ipo || ipo.status !== 'POSTPONED') return null;

  const postponedAt = await readPostponedAt(tx, ipoId);
  const point = await relaunchPoint(tx, ipoId, trigger, receipt, postponedAt);
  if (!point) return null;
  // F-210 (mixed-clock-ordering): the clear's audit and plan stamps are ordered against database-stamped
  // times (documents.created_at, field_sources.updated_at), so they come from the database clock. Read
  // only once a relaunch is confirmed, so a non-relaunch filing costs no extra query.
  const now = nowOverride ?? (await readDatabaseNow(tx));

  /**
   * The start of THIS relaunch: the earliest relaunch event after the latest postponement (this one, an
   * earlier relaunch clear's arrival, or an earlier OD-83 / OD-86 key supersede). A value set at or after
   * it is already the relaunch's terms (a re-apply, or a value typed after the new filing arrived) and
   * stays, so a later filing of the same relaunch does not clear it again. A value set before it is the
   * old terms, including one re-applied after an earlier relaunch and then postponed again.
   */
  const afterPostponement = (d: Date | null) => d != null && (postponedAt == null || d.getTime() > postponedAt.getTime());
  const earlierClears = rowsOf(
    await tx.execute(sql`
      SELECT coalesce(details->>'relaunchAt', timestamp::text) AS at FROM audit_logs
       WHERE ipo_id = ${ipoId}::uuid AND success = true
         AND action_type IN (${RELAUNCH_CLEARED_AUDIT_ACTION}, ${RELAUNCH_FILING_AUDIT_ACTION})`)
  ).map((r) => toInstant(r.at));
  const earlierKeys = rowsOf(
    await tx.execute(sql`
      SELECT state_changed_at::text AS at, state_reason FROM ipo_source_keys
       WHERE ipo_id = ${ipoId}::uuid AND state = 'SUPERSEDED'`)
  )
    .filter((r) => RELAUNCH_KEY_REASON_PREFIXES.some((p) => String(r.state_reason ?? '').startsWith(p)))
    .map((r) => toInstant(r.at));
  const relaunchStart = [point.at, ...earlierClears, ...earlierKeys]
    .filter((d): d is Date => afterPostponement(d) || d === point.at)
    .reduce((a, b) => (b.getTime() < a.getTime() ? b : a));
  const clearable = (editedAtRaw: unknown): boolean => {
    const editedAt = toInstant(editedAtRaw);
    return editedAt != null && editedAt.getTime() < relaunchStart.getTime();
  };

  const summary: RelaunchClearSummary = {
    ipoId,
    slug: ipo.slug,
    companyName: ipo.company_name,
    status: ipo.status,
    documentId: point.handle,
    documentType: point.label,
    cleared: [],
  };
  const trig = {
    relaunchAt: point.at.toISOString(),
    ...(trigger.kind === 'OFFER_DOCUMENT' ? { documentId: trigger.documentId, documentType: trigger.documentType } : { sourceKeyId: point.handle, relaunch: point.label }),
  };

  const held = rowsOf(
    await tx.execute(sql`
      SELECT fpm.table_name, fpm.field_name, fpm.manually_edited_at::text AS edited_at, fs.data_lineage, fs.id AS fs_id
        FROM field_protection_metadata fpm
        JOIN field_sources fs
          ON fs.ipo_id = fpm.ipo_id AND fs.table_name = fpm.table_name AND fs.row_key = '' AND fs.field_name = fpm.field_name
       WHERE fpm.ipo_id = ${ipoId}::uuid AND fpm.is_protected = true AND fs.source = 'ADMIN'
       ORDER BY fpm.table_name, fpm.field_name`)
  ) as Array<{ table_name: string; field_name: string; edited_at: string | null; data_lineage: Record<string, unknown> | null; fs_id: string }>;

  const insertAudit = async (a: {
    tableName: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    details: Record<string, unknown>;
    action?: string;
  }) =>
    (rowsOf(
      await tx.execute(sql`
        INSERT INTO audit_logs (timestamp, admin_user, action_type, ipo_id, table_name, field_name, old_value, new_value, details, success, created_at)
        VALUES (${now.toISOString()}, ${RELAUNCH_SYSTEM_ACTOR}, ${a.action ?? RELAUNCH_CLEARED_AUDIT_ACTION}, ${ipoId}::uuid, ${a.tableName},
                ${a.fieldName}, ${a.oldValue}, ${a.newValue}, ${JSON.stringify(a.details)}::jsonb, true, ${now.toISOString()})
        RETURNING id`)
    )[0] as { id: string }).id;

  for (const h of held) {
    const table = oneRowTable(h.table_name);
    if (!table) continue;
    if (RELAUNCH_KEEP_FIELDS.has(h.field_name) || E1_EXCHANGE_STATED_FIELDS.has(h.field_name)) continue;
    if (!isDocumentField(h.table_name, h.field_name)) continue;
    if (!clearable(h.edited_at)) continue;
    const column = (getTableColumns(table) as Record<string, { name: string; notNull: boolean }>)[h.field_name];
    if (!column) continue;

    const whereCol = h.table_name === 'ipos' ? sql.raw('id') : sql.raw('ipo_id');
    const tbl = sql.raw(`"${h.table_name}"`);
    const col = sql.raw(`"${column.name}"`);
    const before = rowsOf(await tx.execute(sql`SELECT ${col}::text AS v FROM ${tbl} WHERE ${whereCol} = ${ipoId}::uuid`))[0] as
      | { v: string | null }
      | undefined;
    const oldValue = before?.v ?? null;
    if (!column.notNull) {
      await tx.execute(sql`UPDATE ${tbl} SET ${col} = NULL WHERE ${whereCol} = ${ipoId}::uuid`);
    }
    await tx.execute(sql`
      DELETE FROM field_protection_metadata WHERE ipo_id = ${ipoId}::uuid AND table_name = ${h.table_name} AND field_name = ${h.field_name}`);
    await tx.execute(sql`DELETE FROM field_sources WHERE id = ${h.fs_id}::uuid`);
    await tx.execute(sql`
      UPDATE ipo_field_plan
         SET state = 'PENDING', next_due_at = ${now.toISOString()}::timestamptz, reason_code = NULL,
             cause = ${`relaunch (${point.label}) cleared the admin value (OD-120)`},
             updated_at = ${now.toISOString()}::timestamptz
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${h.table_name} AND row_key = ''
         AND field_name IN (${h.field_name}, ${snake(h.field_name)})`);

    const lineage = h.data_lineage ?? {};
    const adminEmpty = lineage.adminEmpty === true;
    const newFilingValue =
      receipt.find((r) => r.tableName === h.table_name && (r.rowKey ?? '') === '' && r.fieldName === h.field_name)?.value ?? null;
    const auditId = await insertAudit({
      tableName: h.table_name,
      fieldName: h.field_name,
      oldValue,
      newValue: column.notNull ? oldValue : null,
      details: {
        method: 'RELAUNCH_CLEAR',
        decision: 'OD-120',
        trigger: trigger.kind,
        ...trig,
        adminEmpty,
        ...(adminEmpty ? { emptyReason: lineage.emptyReason ?? null } : {}),
        previousLineage: lineage,
        newFilingValue,
        valueKept: column.notNull,
      },
    });
    summary.cleared.push({ auditId, tableName: h.table_name, fieldName: h.field_name, oldValue, adminEmpty, newFilingValue });
  }

  // Admin-owned child lists (item 8, OD-107): release the whole-list hold; lead managers are the
  // ipos.leadManagers field hold above.
  const listHolds = rowsOf(
    await tx.execute(sql`
      SELECT table_name, manually_edited_at::text AS edited_at FROM field_protection_metadata
       WHERE ipo_id = ${ipoId}::uuid AND field_name = ${LIST_HOLD_FIELD} AND is_protected = true
       ORDER BY table_name`)
  ) as Array<{ table_name: string; edited_at: string | null }>;
  for (const lh of listHolds) {
    const list = ADMIN_LISTS.find((l) => l !== 'lead_managers' && ADMIN_LIST_SPECS[l].holdTable === lh.table_name) as AdminListName | undefined;
    if (!list || !clearable(lh.edited_at)) continue;
    const { readAdminList } = await import('./admin-list-write');
    const current = await readAdminList(tx as never, ipoId, list);
    await tx.execute(sql`
      DELETE FROM field_protection_metadata WHERE ipo_id = ${ipoId}::uuid AND table_name = ${lh.table_name} AND field_name = ${LIST_HOLD_FIELD}`);
    const oldValue = JSON.stringify(current.rows.map((r) => r.label));
    const auditId = await insertAudit({
      tableName: lh.table_name,
      fieldName: LIST_HOLD_FIELD,
      oldValue,
      newValue: null,
      details: { method: 'RELAUNCH_CLEAR', decision: 'OD-120', trigger: trigger.kind, ...trig, list, rowsAtRelease: current.rows.length },
    });
    summary.cleared.push({ auditId, tableName: lh.table_name, fieldName: LIST_HOLD_FIELD, oldValue, adminEmpty: false, newFilingValue: null, list });
  }
  // #1298 (§2.9, the non-admin half): every document-sourced value (provenance source DRHP, the one
  // document source in scraper_source) on a document field, set before this relaunch started and not
  // held by an admin, is invalidated the same way: emptied, its provenance row removed, its plan row
  // re-asked. Identity and E-1 fields are kept, exactly as for admin values above. A value the new
  // filing itself wrote is newer than the relaunch start and stays.
  const docRows = rowsOf(
    await tx.execute(sql`
      SELECT fs.id AS fs_id, fs.table_name, fs.field_name, fs.updated_at::text AS at
        FROM field_sources fs
       WHERE fs.ipo_id = ${ipoId}::uuid AND fs.row_key = '' AND fs.source = 'DRHP'
         AND NOT EXISTS (
           SELECT 1 FROM field_protection_metadata fpm
            WHERE fpm.ipo_id = fs.ipo_id AND fpm.table_name = fs.table_name
              AND fpm.field_name = fs.field_name AND fpm.is_protected = true)
       ORDER BY fs.table_name, fs.field_name`)
  ) as Array<{ fs_id: string; table_name: string; field_name: string; at: string | null }>;
  summary.invalidated = [];
  for (const d of docRows) {
    const table = oneRowTable(d.table_name);
    if (!table) continue;
    if (RELAUNCH_KEEP_FIELDS.has(d.field_name) || E1_EXCHANGE_STATED_FIELDS.has(d.field_name)) continue;
    if (!isDocumentField(d.table_name, d.field_name)) continue;
    if (!clearable(d.at)) continue;
    const column = (getTableColumns(table) as Record<string, { name: string; notNull: boolean }>)[d.field_name];
    if (!column) continue;
    const whereCol = d.table_name === 'ipos' ? sql.raw('id') : sql.raw('ipo_id');
    const tbl = sql.raw(`"${d.table_name}"`);
    const col = sql.raw(`"${column.name}"`);
    const before = rowsOf(await tx.execute(sql`SELECT ${col}::text AS v FROM ${tbl} WHERE ${whereCol} = ${ipoId}::uuid`))[0] as
      | { v: string | null }
      | undefined;
    if (!column.notNull) {
      await tx.execute(sql`UPDATE ${tbl} SET ${col} = NULL WHERE ${whereCol} = ${ipoId}::uuid`);
    }
    await tx.execute(sql`DELETE FROM field_sources WHERE id = ${d.fs_id}::uuid`);
    await tx.execute(sql`
      UPDATE ipo_field_plan
         SET state = 'PENDING', next_due_at = ${now.toISOString()}::timestamptz, reason_code = NULL,
             cause = ${`relaunch (${point.label}) invalidated the document value (§2.9)`},
             updated_at = ${now.toISOString()}::timestamptz
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${d.table_name} AND row_key = ''
         AND field_name IN (${d.field_name}, ${snake(d.field_name)})`);
    summary.invalidated.push({ tableName: d.table_name, fieldName: d.field_name, oldValue: before?.v ?? null, valueKept: column.notNull });
  }

  // #1298 round 1 (MINOR-4): the old offer's multi-row document lists. A list table whose rows carry
  // document provenance (source DRHP) and that no admin holds loses every row and provenance row written
  // before this relaunch started; the new filing re-answers the list. Rows written after it stay.
  for (const [tableName, table] of Object.entries(relaunchListTables())) {
    const heldNow = rowsOf(
      await tx.execute(sql`
        SELECT 1 FROM field_protection_metadata
         WHERE ipo_id = ${ipoId}::uuid AND table_name = ${tableName} AND field_name = ${LIST_HOLD_FIELD} AND is_protected = true LIMIT 1`)
    );
    if (heldNow.length > 0) continue;
    const docProv = rowsOf(
      await tx.execute(sql`
        SELECT count(*)::int AS n FROM field_sources
         WHERE ipo_id = ${ipoId}::uuid AND table_name = ${tableName} AND row_key <> '' AND source = 'DRHP'
           AND updated_at < ${relaunchStart.toISOString()}::timestamptz`)
    )[0] as { n: number } | undefined;
    if (!docProv || docProv.n === 0) continue;
    const cols = getTableColumns(table) as Record<string, { name: string }>;
    const stamp = cols.updatedAt ? sql.raw(`coalesce("${cols.updatedAt.name}", "${cols.createdAt.name}")`) : sql.raw(`"${cols.createdAt.name}"`);
    const tbl = sql.raw(`"${tableName}"`);
    const removed = rowsOf(
      await tx.execute(sql`
        DELETE FROM ${tbl} WHERE ipo_id = ${ipoId}::uuid AND ${stamp} < ${relaunchStart.toISOString()}::timestamptz RETURNING 1`)
    ).length;
    await tx.execute(sql`
      DELETE FROM field_sources
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${tableName} AND row_key <> ''
         AND updated_at < ${relaunchStart.toISOString()}::timestamptz`);
    await tx.execute(sql`
      UPDATE ipo_field_plan
         SET state = 'PENDING', next_due_at = ${now.toISOString()}::timestamptz, reason_code = NULL,
             cause = ${`relaunch (${point.label}) invalidated the document list (§2.9)`},
             updated_at = ${now.toISOString()}::timestamptz
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${tableName}`);
    summary.invalidated.push({ tableName, fieldName: '*', oldValue: `${removed} row(s)`, valueKept: false });
  }

  // #1298 round 1 (MAJOR-1): the document plan asks again. Every NOT_APPLICABLE row reopens (a
  // postponement once closed them all), and on a relaunch by exchange record or merge the offer
  // documents' rows reopen too, so the relaunch RHP / prospectus / price band ad is hunted even when
  // the old offer's rows were closed; the stage decides when each is due.
  const offerTypes = trigger.kind === 'SOURCE_KEY_RELAUNCH' ? [...RELAUNCH_OFFER_DOCUMENT_TYPES] : [];
  const reopened = rowsOf(
    await tx.execute(sql`
      UPDATE document_fetch_state
         SET state = 'WANTED', attempts = 0, last_attempt_at = NULL, attempted_at_stage = NULL,
             next_retry_at = NULL, blocked_since_at = NULL, updated_at = ${now.toISOString()}::timestamptz
       WHERE ipo_id = ${ipoId}::uuid
         AND (state = 'NOT_APPLICABLE'
              OR (doc_type::text IN (${sql.join([...offerTypes, '-'].map((t) => sql`${t}`), sql`, `)})
                  AND state IN ('EXTRACTED', 'SUPERSEDED', 'EXTRACT_FAILED', 'FOUND')))
      RETURNING doc_type::text AS doc_type`)
  ).map((r) => String(r.doc_type));

  // The record that this relaunch filing arrived (read by `readPostponedRelaunchState`), with what it invalidated.
  await insertAudit({
    tableName: 'ipos',
    fieldName: 'status',
    oldValue: ipo.status,
    newValue: null,
    details: {
      method: 'RELAUNCH_FILING',
      decision: '§2.9',
      trigger: trigger.kind,
      ...trig,
      adminCleared: summary.cleared.map((c) => `${c.tableName}.${c.fieldName}`),
      invalidated: summary.invalidated,
      documentPlanReopened: reopened.sort(),
    },
    action: RELAUNCH_FILING_AUDIT_ACTION,
  });
  return summary;
}

/**
 * #1298 (§2.9 "POSTPONED — not terminal, it comes back"): may an exchange's non-POSTPONED status now
 * replace a stored POSTPONED? Only after a relaunch filing (OD-139) arrived since the postponement.
 * Answer states:
 *   - NOT_POSTPONED: the stored status is not POSTPONED (the question does not apply);
 *   - RELAUNCHED: a relaunch record exists after the postponement — a `Relaunch Filing` / `Relaunch
 *     Cleared` audit row (both kinds of relaunch filing pass through `clearAdminValuesOnRelaunch`), or
 *     an `ipo_source_keys` row SUPERSEDED by the OD-83 relaunch or the OD-86 relaunch merge;
 *   - NO_RELAUNCH: POSTPONED and no such record after the postponement.
 * The postponement time is the status provenance row's; with no such row, any relaunch record counts.
 * Errors propagate: the caller fails closed (keeps POSTPONED).
 */
export type PostponedRelaunchState = 'NOT_POSTPONED' | 'RELAUNCHED' | 'NO_RELAUNCH';

export async function readPostponedRelaunchState(tx: ExecuteLike, ipoId: string): Promise<PostponedRelaunchState> {
  const ipo = rowsOf(await tx.execute(sql`SELECT status::text AS status FROM ipos WHERE id = ${ipoId}::uuid`))[0] as
    | { status: string }
    | undefined;
  if (!ipo || ipo.status !== 'POSTPONED') return 'NOT_POSTPONED';
  const postponedAt = await readPostponedAt(tx, ipoId);
  const marks = rowsOf(
    await tx.execute(sql`
      SELECT coalesce(details->>'relaunchAt', timestamp::text) AS at FROM audit_logs
       WHERE ipo_id = ${ipoId}::uuid AND success = true
         AND action_type IN (${RELAUNCH_FILING_AUDIT_ACTION}, ${RELAUNCH_CLEARED_AUDIT_ACTION})`)
  ).map((r) => toInstant(r.at));
  const keys = rowsOf(
    await tx.execute(sql`
      SELECT state_changed_at::text AS at, state_reason FROM ipo_source_keys
       WHERE ipo_id = ${ipoId}::uuid AND state = 'SUPERSEDED'`)
  )
    .filter((r) => RELAUNCH_KEY_REASON_PREFIXES.some((p) => String(r.state_reason ?? '').startsWith(p)))
    .map((r) => toInstant(r.at));
  const after = [...marks, ...keys].some((d) => d != null && (postponedAt == null || d.getTime() > postponedAt.getTime()));
  return after ? 'RELAUNCHED' : 'NO_RELAUNCH';
}
