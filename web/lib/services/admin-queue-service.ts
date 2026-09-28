/**
 * The admin data-quality queue (OD-63 + OD-136, spec §9.4): every unresolved conflict and every plan
 * row with no value, in one ordered list, each linking to the field in the IPO-page editor.
 *
 * Nothing is hidden: a conflict a spec rule takes off the disagreement list (F-173: OD-75 / OD-60 /
 * OD-59) stays in the list with that rule as its reason, and a plan row with a NULL reason code is
 * shown as "no reason recorded" (#1268 parked the repair of those codes). The one exclusion is a
 * missing value the admin already handled: a field holding an admin value or an admin delete
 * (OD-121) is no longer missing — the admin decided it.
 *
 * Source values appear only here, behind withAdminAuth (item 24, OD-61) — never in a public payload.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import type * as schema from '@ipodhan/shared/db/schema';
import {
  AdminQueueRepository,
  AdminQueueStoredRowsRepository,
  STORED_VALUE_TABLES,
  type ConflictRow,
  type IpoRow,
  type PlanRow,
  type HoldRow,
} from '@/lib/repositories/admin-queue-repository';
import { validateIPOData } from '@ipodhan/shared/utils/ipo-field-checks';
import { isoDay } from '@ipodhan/shared/utils/company-identity-fold';
import { ruleFilterFor, RULE_FILTER_LABELS, type RuleFilter } from '@/lib/admin/queue/conflict-rule-filter';
import { familyFor, loadComparisonFamilies } from '@/lib/admin/queue/comparison-families';
import { PUBLIC_PAGE_FIELDS } from '@/lib/admin/queue/public-page-fields';
import { ADMIN_ONLY_CONFLICT_REASONS, WRITER_BOOKKEEPING_FIELDS } from '@ipodhan/shared/utils/conflict-reasons';
import {
  AdminQueuePageRepository,
  type QueueCountRow,
  type QueuePageRow,
  type QueueSqlInputs,
  type QueueSqlView,
} from '@/lib/repositories/admin-queue-page-repository';
import {
  applyView,
  countQueue,
  DISAGREEMENT_REASON,
  NO_REASON_RECORDED,
  editorHref,
  groupOf,
  orderIpoItems,
  orderQueue,
  paginate,
  reasonForConflict,
  reasonForMissing,
  type QueueCounts,
  type QueueEntry,
  type QueueGroup,
  type QueueIpo,
  type QueueItem,
  type QueueView,
} from '@/lib/admin/queue/queue-order';

/** ipo_field_plan stores snake_case field names; data_conflicts, holds and the editor use camelCase. */
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function toIpo(r: IpoRow): QueueIpo {
  return {
    id: r.ipo_id,
    slug: r.slug,
    companyName: r.company_name,
    status: r.status,
    openDate: r.open_date,
    closeDate: r.close_date,
    listingDate: r.listing_date,
  };
}

function holdKey(ipoId: string, holdTable: string, fieldName: string): string {
  return `${ipoId}|${holdTable}|${fieldName}`;
}

export function conflictToItem(r: ConflictRow, family?: string): QueueItem {
  const ruleFilter = ruleFilterFor({
    family,
    fieldName: r.field_name,
    source1: r.source1,
    source2: r.source2,
    value1: r.value1,
    value2: r.value2,
    resolutionReason: r.resolution_reason,
  });
  return {
    id: `conflict:${r.id}`,
    kind: 'conflict',
    ipo: toIpo(r),
    tableName: r.table_name,
    fieldName: r.field_name,
    rowKey: r.row_key ?? '',
    ruleFilter,
    reason: reasonForConflict(ruleFilter),
    reasons: [reasonForConflict(ruleFilter)],
    sources: [
      { source: r.source1, value: r.value1 },
      { source: r.source2, value: r.value2 },
    ],
    editorHref: editorHref(r.slug, r.table_name, r.field_name, r.row_key ?? ''),
  };
}

export function planToItem(r: PlanRow): QueueItem {
  const fieldName = snakeToCamel(r.field_name);
  return {
    id: `plan:${r.id}`,
    kind: 'missing',
    ipo: toIpo(r),
    tableName: r.table_name,
    fieldName,
    rowKey: r.row_key ?? '',
    ruleFilter: null,
    reason: reasonForMissing(r.reason_code),
    reasons: [reasonForMissing(r.reason_code)],
    planState: r.state,
    editorHref: editorHref(r.slug, r.table_name, fieldName, r.row_key ?? ''),
  };
}

/** Population (b): no-value plan rows; a missing value the admin already holds is handled, so it is left out. */
export function missingItems(plans: PlanRow[], holds: HoldRow[]): QueueItem[] {
  const held = new Set(holds.map((h) => holdKey(h.ipo_id, h.table_name, h.field_name)));
  const items: QueueItem[] = [];
  for (const p of plans) {
    const item = planToItem(p);
    const holdTable = item.rowKey === '' ? item.tableName : `${item.tableName}:${item.rowKey}`;
    if (held.has(holdKey(p.ipo_id, holdTable, item.fieldName))) continue;
    items.push(item);
  }
  return items;
}

/** OD-62's code for a value read but refused by its shape check. */
export const FAILED_VALIDATION = 'FAILED_VALIDATION';

/** Same numeric coercion the admin write applies before validateIPOData (admin-field-write.ts ipoFieldCheckFailure). */
const NUMERIC_CHECK_FIELDS = ['lotSize', 'priceRangeMin', 'priceRangeMax'];

function displayValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoDay(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function ipoOfRow(row: Record<string, unknown>): QueueIpo {
  return {
    id: String(row.id),
    slug: String(row.slug),
    companyName: String(row.companyName ?? row.slug),
    status: String(row.status),
    openDate: isoDay(row.openDate),
    closeDate: isoDay(row.closeDate),
    listingDate: isoDay(row.listingDate),
  };
}

/**
 * Population (c): a stored `ipos` value refused by the SAME shared field check the admin write and
 * every scraper write run (validateIPOData, packages/shared/src/utils/ipo-field-checks.ts). OD-62: a
 * value that failed its shape check is FAILED_VALIDATION; §2.6: the queue must make a gap visible
 * even when the plan row says nothing — a wrong value can sit in a SUPPLIED field, or on an IPO with
 * no plan rows at all. So this runs over every IPO's stored row, not only IPOs with plan rows.
 */
export function flaggedItems(rows: Array<Record<string, unknown>>): QueueItem[] {
  const items: QueueItem[] = [];
  for (const row of rows) {
    const checked: Record<string, unknown> = { ...row };
    for (const k of NUMERIC_CHECK_FIELDS) {
      const v = checked[k];
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) checked[k] = Number(v);
    }
    const byField = new Map<string, string[]>();
    for (const e of validateIPOData(checked as never, 'STORED').errors) {
      byField.set(e.field, [...(byField.get(e.field) ?? []), e.message]);
    }
    const ipo = ipoOfRow(row);
    for (const [fieldName, messages] of byField) {
      // A check can name a derived rule rather than a column (measured on staging: `lotEconomics`,
      // lot size x price band). There is no single editor field for it, so the item opens the IPO
      // page itself and shows no stored value, rather than pointing at a column that does not exist.
      const isColumn = Object.prototype.hasOwnProperty.call(row, fieldName);
      items.push({
        id: `flag:${ipo.id}:${fieldName}`,
        kind: 'flagged',
        ipo,
        tableName: 'ipos',
        fieldName,
        rowKey: '',
        ruleFilter: null,
        reason: FAILED_VALIDATION,
        reasons: [FAILED_VALIDATION],
        messages,
        storedValue: isColumn ? displayValue(row[fieldName]) : undefined,
        editorHref: isColumn ? editorHref(ipo.slug, 'ipos', fieldName, '') : `/ipos/${encodeURIComponent(ipo.slug)}`,
      });
    }
  }
  return items;
}

/**
 * One field appears once with all its reasons: a missing (b) and a flagged (c) item on the same
 * (IPO, table, field, row) become one 'missing' item carrying both. Conflicts stay separate items.
 */
export function mergeFieldItems(items: QueueItem[]): QueueItem[] {
  const out: QueueItem[] = [];
  const byField = new Map<string, QueueItem>();
  for (const item of items) {
    if (item.kind === 'conflict') {
      out.push(item);
      continue;
    }
    const key = `${item.ipo.id}|${item.tableName}|${item.fieldName}|${item.rowKey}`;
    const seen = byField.get(key);
    if (!seen) {
      const copy = { ...item, reasons: [...item.reasons] };
      byField.set(key, copy);
      out.push(copy);
      continue;
    }
    const [missing, flagged] = seen.kind === 'missing' ? [seen, item] : [item, seen];
    Object.assign(seen, {
      ...missing,
      kind: 'missing' as const,
      reasons: [...new Set([...missing.reasons, ...flagged.reasons])],
      messages: [...(missing.messages ?? []), ...(flagged.messages ?? [])],
      storedValue: flagged.storedValue !== undefined ? flagged.storedValue : missing.storedValue,
    });
  }
  return out;
}

/** Populations (a) and (b) merged from raw rows. */
export function buildQueueItems(conflicts: ConflictRow[], plans: PlanRow[], holds: HoldRow[]): QueueItem[] {
  return [...conflicts.map((c) => conflictToItem(c)), ...missingItems(plans, holds)];
}

/**
 * One population of the queue. Each source loads its own items; the service merges every source
 * and ONE ordering function (queue-order.ts) orders them, so a further population (a value a
 * detection check flagged, planned as (c)) plugs in as another source without touching the ordering.
 */
export interface QueueSource {
  readonly name: string;
  load(ipoSlug?: string): Promise<QueueItem[]>;
}

/** Population (a): unresolved data_conflicts; F-173 rule-filtered rows kept with their label. */
export function conflictSource(repo: AdminQueueRepository): QueueSource {
  const families = loadComparisonFamilies();
  return {
    name: 'conflict',
    load: async (slug) =>
      (await repo.listUnresolvedConflicts(slug)).map((r) => conflictToItem(r, familyFor(families, r.table_name, r.field_name))),
  };
}

/** Population (c): stored `ipos` values the shared field check refuses. */
export function flaggedValueSource(rows: AdminQueueStoredRowsRepository): QueueSource {
  return { name: 'flagged', load: async (slug) => flaggedItems(await rows.listIposRows(slug)) };
}

/** Population (b): ipo_field_plan rows with no value, minus admin-held fields. */
export function missingValueSource(repo: AdminQueueRepository): QueueSource {
  return {
    name: 'missing',
    load: async (slug) => {
      const [plans, holds] = await Promise.all([repo.listNoValuePlanRows(slug), repo.listAdminHolds()]);
      return missingItems(plans, holds);
    },
  };
}

export interface QueueRequest extends QueueView {
  page: number;
  pageSize: number;
}

export interface QueueResponse {
  counts: QueueCounts;
  view: QueueView;
  page: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
  entries: Array<QueueEntry | { type: 'item'; group: QueueGroup; item: QueueItem }>;
}

export class AdminQueueService {
  private sources: QueueSource[];
  private rows: AdminQueueStoredRowsRepository;
  private repo: AdminQueueRepository;
  private pages: AdminQueuePageRepository;

  constructor(db: NodePgDatabase<typeof schema>, redis: Redis, sources?: QueueSource[]) {
    const repo = new AdminQueueRepository(db, redis);
    this.repo = repo;
    this.pages = new AdminQueuePageRepository(db, redis);
    this.rows = new AdminQueueStoredRowsRepository(db, redis);
    this.sources = sources ?? [conflictSource(repo), missingValueSource(repo), flaggedValueSource(this.rows)];
  }

  async loadItems(ipoSlug?: string): Promise<QueueItem[]> {
    const loaded = await Promise.all(this.sources.map((s) => s.load(ipoSlug)));
    return mergeFieldItems(loaded.flat());
  }

  /**
   * The stored value next to a missing item's plan state (a NOT_AVAILABLE_YET field often still
   * holds an old, wrong value — the plan STATE defines "missing", never a NULL column). Loaded for the
   * listed page only, from one-row-per-IPO tables; a row table's value stays undefined (not loaded).
   */
  async attachStoredValues(entries: QueueResponse['entries']): Promise<void> {
    const need = new Map<string, QueueItem[]>();
    for (const e of entries) {
      if (e.type !== 'item' || e.item.kind === 'conflict' || e.item.storedValue !== undefined || e.item.rowKey !== '') continue;
      if (!STORED_VALUE_TABLES.includes(e.item.tableName)) continue;
      need.set(e.item.tableName, [...(need.get(e.item.tableName) ?? []), e.item]);
    }
    for (const [table, items] of need) {
      const stored = await this.rows.storedRows(table, [...new Set(items.map((i) => i.ipo.id))]);
      for (const i of items) {
        // No row for this IPO in a one-row table means nothing is stored: shown as empty, not unknown.
        const row = stored.get(i.ipo.id);
        i.storedValue = row ? displayValue(row[i.fieldName]) : null;
      }
    }
  }

  /**
   * Counts are always over the whole queue; the view narrows only the listed entries. One IPO
   * (`view.ipo`) is listed item by item even when it is a collapsed group-3 IPO.
   */
  async getQueue(req: QueueRequest): Promise<QueueResponse> {
    // Computed in SQL (admin-queue-page-repository.ts): only the requested page leaves the database.
    const view: QueueView = { group: req.group, reason: req.reason, kind: req.kind, ipo: req.ipo };
    const { inputs, flaggedByKey, ipoById } = await this.sqlInputs();
    const sqlView = toSqlView(view);
    const [countRows, first] = await Promise.all([
      this.pages.counts(inputs),
      this.pages.page(inputs, sqlView, (Math.max(1, req.page) - 1) * req.pageSize, req.pageSize),
    ]);
    const totalEntries = totalOf(first);
    const totalPages = Math.max(1, Math.ceil(totalEntries / req.pageSize));
    const pageNo = Math.min(Math.max(1, req.page), totalPages);
    const rows = pageNo === req.page ? first : await this.pages.page(inputs, sqlView, (pageNo - 1) * req.pageSize, req.pageSize);
    const entries = await this.entriesFromRows(rows.filter((r) => r.ord > 0), flaggedByKey, ipoById);
    await this.attachStoredValues(entries);
    return { counts: countsFromRows(countRows), view, page: pageNo, pageSize: req.pageSize, totalEntries, totalPages, entries };
  }

  /** The JS-side inputs of the SQL queue, each from its one implementation. */
  async sqlInputs(): Promise<{ inputs: QueueSqlInputs; flaggedByKey: Map<string, QueueItem>; ipoById: Map<string, QueueIpo> }> {
    const families = loadComparisonFamilies();
    const [candidates, holds, iposRows] = await Promise.all([
      this.pages.listCandidateConflicts(ADMIN_ONLY_CONFLICT_REASONS, WRITER_BOOKKEEPING_FIELDS),
      this.repo.listAdminHolds(),
      this.rows.listIposRows(),
    ]);
    const classified: Array<[string, string]> = [];
    for (const c of candidates) {
      const rule = ruleFilterFor({
        family: familyFor(families, c.table_name, c.field_name),
        fieldName: c.field_name,
        source1: c.source1,
        source2: c.source2,
        value1: c.value1,
        value2: c.value2,
        resolutionReason: c.resolution_reason,
      });
      if (rule !== null) classified.push([c.id, rule]);
    }
    const flagged = flaggedItems(iposRows);
    const publicFields = Object.entries(PUBLIC_PAGE_FIELDS).flatMap(([t, fs]) => fs.map((f) => `${t}.${f}`));
    return {
      inputs: {
        od75Reasons: ADMIN_ONLY_CONFLICT_REASONS,
        bookkeepingFields: WRITER_BOOKKEEPING_FIELDS,
        classified,
        heldKeys: holds.map((h) => holdKey(h.ipo_id, h.table_name, h.field_name)),
        publicFields,
        flagged: flagged.map((f) => [f.ipo.id, f.fieldName]),
      },
      flaggedByKey: new Map(flagged.map((f) => [`${f.ipo.id}|${f.fieldName}`, f])),
      ipoById: new Map(iposRows.map((r) => [String(r.id), ipoOfRow(r)])),
    };
  }

  /** Page rows -> entries: conflict values and plan states are read for the page's rows only. */
  async entriesFromRows(
    rows: QueuePageRow[],
    flaggedByKey: Map<string, QueueItem>,
    ipoById: Map<string, QueueIpo>
  ): Promise<QueueResponse['entries']> {
    const idsWith = (prefix: string) =>
      rows.filter((r) => r.id?.startsWith(prefix)).map((r) => (r.id as string).slice(prefix.length));
    const [conflicts, plans] = await Promise.all([
      this.pages.conflictDetails(idsWith('conflict:')),
      this.pages.planDetails(idsWith('plan:')),
    ]);
    const conflictById = new Map(conflicts.map((c) => [`conflict:${c.id}`, c]));
    const planById = new Map(plans.map((p) => [`plan:${p.id}`, p]));
    const entries: QueueResponse['entries'] = [];
    for (const r of rows) {
      const ipo = ipoById.get(r.ipo_id);
      if (!ipo) continue;
      if (r.entry === 'ipo') {
        entries.push({
          type: 'ipo',
          group: 3,
          summary: {
            ipo,
            conflicts: r.disagreements ?? 0,
            missing: r.missing ?? 0,
            flagged: r.flagged ?? 0,
            ruled: r.ruled ?? 0,
            editorHref: `/ipos/${encodeURIComponent(ipo.slug)}`,
          },
        });
        continue;
      }
      const item = itemFromRow(r, conflictById, planById, flaggedByKey);
      if (item) entries.push({ type: 'item', group: Number(r.grp) as QueueGroup, item });
    }
    return entries;
  }
}

/** The page query's sentinel row (ord 0) carries the filtered queue's length. */
function totalOf(rows: QueuePageRow[]): number {
  return Number(rows.find((r) => r.ord === 0)?.total ?? 0);
}

const RULE_BY_LABEL = new Map<string, RuleFilter>(
  (Object.entries(RULE_FILTER_LABELS) as Array<[RuleFilter, string]>).map(([rule, label]) => [label, rule])
);

/** A reason label (as shown in counts.byReason) -> the SQL condition that selects it. */
export function toSqlView(view: QueueView): QueueSqlView {
  const out: QueueSqlView = { group: view.group, kind: view.kind, ipoSlug: view.ipo };
  if (view.reason !== undefined) {
    const rule = RULE_BY_LABEL.get(view.reason);
    if (rule) out.reason = { cat: rule };
    else if (view.reason === DISAGREEMENT_REASON) out.reason = { cat: 'disagreement' };
    else if (view.reason === FAILED_VALIDATION) out.reason = { failedValidation: true };
    else if (view.reason === NO_REASON_RECORDED) out.reason = { reasonCode: null };
    else out.reason = { reasonCode: view.reason };
  }
  return out;
}

function reasonOfCat(cat: string, reasonCode: string | null): string {
  if (cat === 'missing') return reasonForMissing(reasonCode);
  if (cat === 'flagged') return FAILED_VALIDATION;
  return reasonForConflict(cat === 'disagreement' ? null : (cat as RuleFilter));
}

/** SQL count rows -> QueueCounts (the shape countQueue returns). */
export function countsFromRows(rows: QueueCountRow[]): QueueCounts {
  const counts: QueueCounts = {
    total: 0,
    byGroup: { 1: { items: 0, ipos: 0 }, 2: { items: 0, ipos: 0 }, 3: { items: 0, ipos: 0 } },
    byKind: { disagreement: 0, missing: 0, flagged: 0, ruled: 0 },
    byReason: {},
  };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.tag === 'group') {
      counts.byGroup[Number(r.grp) as QueueGroup] = { items: n, ipos: Number(r.ipos ?? 0) };
      counts.total += n;
      continue;
    }
    const cat = r.cat as string;
    const kind = cat === 'disagreement' || cat === 'missing' || cat === 'flagged' ? cat : 'ruled';
    counts.byKind[kind] += n;
    const reason = reasonOfCat(cat, r.reason_code);
    counts.byReason[reason] = (counts.byReason[reason] ?? 0) + n;
    if (r.has_flag) counts.byReason[FAILED_VALIDATION] = (counts.byReason[FAILED_VALIDATION] ?? 0) + n;
  }
  return counts;
}

function itemFromRow(
  r: QueuePageRow,
  conflictById: Map<string, ConflictRow>,
  planById: Map<string, PlanRow>,
  flaggedByKey: Map<string, QueueItem>
): QueueItem | null {
  const id = r.id as string;
  if (id.startsWith('conflict:')) {
    const c = conflictById.get(id);
    if (!c) return null;
    const ruleFilter = r.cat === 'disagreement' ? null : (r.cat as RuleFilter);
    const reason = reasonForConflict(ruleFilter);
    return {
      id,
      kind: 'conflict',
      ipo: toIpo(c),
      tableName: c.table_name,
      fieldName: c.field_name,
      rowKey: c.row_key ?? '',
      ruleFilter,
      reason,
      reasons: [reason],
      sources: [
        { source: c.source1, value: c.value1 },
        { source: c.source2, value: c.value2 },
      ],
      editorHref: editorHref(c.slug, c.table_name, c.field_name, c.row_key ?? ''),
    };
  }
  if (id.startsWith('plan:')) {
    const p = planById.get(id);
    if (!p) return null;
    const item = planToItem(p);
    const flag = r.has_flag ? flaggedByKey.get(`${p.ipo_id}|${item.fieldName}`) : undefined;
    if (!flag) return item;
    return { ...item, reasons: [...new Set([...item.reasons, ...flag.reasons])], messages: flag.messages, storedValue: flag.storedValue };
  }
  return flaggedByKey.get(`${r.ipo_id}|${r.field_name}`) ?? null;
}

export function shapeQueue(all: QueueItem[], req: QueueRequest): QueueResponse {
  const counts = countQueue(all);
  const view: QueueView = { group: req.group, reason: req.reason, kind: req.kind, ipo: req.ipo };
  const viewed = applyView(all, view);
  if (view.ipo) {
    const ordered = orderIpoItems(viewed).map((item) => ({ type: 'item' as const, group: groupOf(item), item }));
    const p = paginate(ordered, req.page, req.pageSize);
    return { counts, view, ...p, entries: p.entries };
  }
  const p = paginate(orderQueue(viewed), req.page, req.pageSize);
  return { counts, view, ...p, entries: p.entries };
}
