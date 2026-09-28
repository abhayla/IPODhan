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
import { AdminQueueRepository, type ConflictRow, type IpoRow, type PlanRow, type HoldRow } from '@/lib/repositories/admin-queue-repository';
import { ruleFilterFor } from '@/lib/admin/queue/conflict-rule-filter';
import {
  applyView,
  countQueue,
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

export function conflictToItem(r: ConflictRow): QueueItem {
  const ruleFilter = ruleFilterFor({
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

/** Populations (a) and (b) merged from raw rows. */
export function buildQueueItems(conflicts: ConflictRow[], plans: PlanRow[], holds: HoldRow[]): QueueItem[] {
  return [...conflicts.map(conflictToItem), ...missingItems(plans, holds)];
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
  return { name: 'conflict', load: async (slug) => (await repo.listUnresolvedConflicts(slug)).map(conflictToItem) };
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

  constructor(db: NodePgDatabase<typeof schema>, redis: Redis, sources?: QueueSource[]) {
    const repo = new AdminQueueRepository(db, redis);
    this.sources = sources ?? [conflictSource(repo), missingValueSource(repo)];
  }

  async loadItems(ipoSlug?: string): Promise<QueueItem[]> {
    const loaded = await Promise.all(this.sources.map((s) => s.load(ipoSlug)));
    return loaded.flat();
  }

  /**
   * Counts are always over the whole queue; the view narrows only the listed entries. One IPO
   * (`view.ipo`) is listed item by item even when it is a collapsed group-3 IPO.
   */
  async getQueue(req: QueueRequest): Promise<QueueResponse> {
    const all = await this.loadItems();
    return shapeQueue(all, req);
  }
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
