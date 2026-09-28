/**
 * The admin queue's order (OD-136, OD-63, spec §9.4) — pure, no I/O, so the exact order is unit-tested.
 *
 * OD-136: "The OD-63 admin queue is ORDERED, never filtered: first, IPOs that are UPCOMING, OPEN, or
 * CLOSED and not yet listed, for the fields the public IPO page shows; then those IPOs' other fields;
 * then LISTED IPOs, collapsed, newest listing first. Nothing is hidden."
 *
 *   group 1  live IPO (UPCOMING / OPEN / CLOSED), field the public page shows
 *   group 2  live IPO, any other field
 *   group 3  every other IPO (LISTED; and — inferred, not spec-stated — DELISTED, WITHDRAWN and
 *            POSTPONED, which are not live either), collapsed to one line per IPO, newest listing
 *            first, IPOs with no listing date last.
 *
 * Within groups 1 and 2: grouped by IPO, live IPOs by their nearest date first (UPCOMING by open
 * date, OPEN by close date, CLOSED by listing date, else close date; no date last); inside an IPO,
 * real disagreements, then missing values, then rows a spec rule took off the disagreement list
 * (still shown, labelled); then field name, then row key.
 */
import { isPublicPageField } from './public-page-fields';
import { RULE_FILTER_LABELS, type RuleFilter } from './conflict-rule-filter';

export const LIVE_STATUSES = ['UPCOMING', 'OPEN', 'CLOSED'] as const;
export type QueueGroup = 1 | 2 | 3;
/**
 * conflict = (a) an unresolved data_conflicts row; missing = (b) a plan row in a no-value state;
 * flagged = (c) a stored value the shared field check (validateIPOData) refuses. A field that is
 * both missing and flagged is ONE item (kind 'missing') carrying both reasons.
 */
export type QueueKind = 'conflict' | 'missing' | 'flagged';

/** OD-62 absence with no code (rows settled before S4, #779; repair parked in #1268). */
export const NO_REASON_RECORDED = 'no reason recorded';

export interface QueueIpo {
  id: string;
  slug: string;
  companyName: string;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
}

export interface QueueItem {
  id: string;
  kind: QueueKind;
  ipo: QueueIpo;
  tableName: string;
  fieldName: string;
  rowKey: string;
  /** For a conflict: the rule that took it off the disagreement list, or null (a real one). */
  ruleFilter: RuleFilter | null;
  /** Plain reason: OD-62 code / 'no reason recorded' for missing, the rule label or 'disagreement' for a conflict. */
  reason: string;
  /** Every reason this field is in the queue (the primary first); a merged missing+flagged field has two. */
  reasons: string[];
  /** The field check's message(s), for a flagged field. */
  messages?: string[];
  /** The value stored in the column now (missing/flagged), shown next to the state; undefined = not loaded. */
  storedValue?: string | null;
  /** Missing only: the plan state (NOT_AVAILABLE_YET | CHECK_FAILED | EXHAUSTED). */
  planState?: string;
  /** Conflict only — admin-only (item 24), never in a public payload. */
  sources?: { source: string; value: string | null }[];
  editorHref: string;
}

export interface QueueIpoSummary {
  ipo: QueueIpo;
  conflicts: number;
  missing: number;
  flagged: number;
  ruled: number;
  editorHref: string;
}

export type QueueEntry =
  | { type: 'item'; group: 1 | 2; item: QueueItem }
  | { type: 'ipo'; group: 3; summary: QueueIpoSummary };

export const DISAGREEMENT_REASON = 'disagreement';

/** The IPO-page editor link (convention fixed by the supervisor; A3 honours it). */
export function editorHref(slug: string, tableName: string, fieldName: string, rowKey: string): string {
  const base = `/ipos/${encodeURIComponent(slug)}?edit=${encodeURIComponent(`${tableName}.${fieldName}`)}`;
  return rowKey === '' ? base : `${base}&row=${encodeURIComponent(rowKey)}`;
}

export function reasonForConflict(ruleFilter: RuleFilter | null): string {
  return ruleFilter === null ? DISAGREEMENT_REASON : RULE_FILTER_LABELS[ruleFilter];
}

export function reasonForMissing(reasonCode: string | null): string {
  return reasonCode ?? NO_REASON_RECORDED;
}

export function isLive(status: string): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export function groupOf(item: Pick<QueueItem, 'ipo' | 'tableName' | 'fieldName'>): QueueGroup {
  if (!isLive(item.ipo.status)) return 3;
  return isPublicPageField(item.tableName, item.fieldName) ? 1 : 2;
}

/** The live IPO's nearest date (OD-136 "live first"); null sorts last. */
export function nearestDate(ipo: QueueIpo): string | null {
  if (ipo.status === 'UPCOMING') return ipo.openDate ?? ipo.closeDate;
  if (ipo.status === 'OPEN') return ipo.closeDate ?? ipo.openDate;
  if (ipo.status === 'CLOSED') return ipo.listingDate ?? ipo.closeDate;
  return null;
}

/**
 * Code-unit order, identical to PostgreSQL `COLLATE "C"` — the SQL page query
 * (admin-queue-repository.ts) sorts with the same keys, so the JS order and the SQL order are one.
 */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNullsLast(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -dir : dir;
}

/**
 * Within one IPO: real disagreements, then missing values, then rows a spec rule took off the
 * disagreement list. A new population (e.g. a value a detection check flagged) adds its category
 * and rank here; the rest of the ordering is unchanged.
 */
export const CATEGORY_RANK = { disagreement: 0, missing: 1, flagged: 2, ruled: 3 } as const;
export type QueueCategory = keyof typeof CATEGORY_RANK;

export function categoryOf(i: Pick<QueueItem, 'kind' | 'ruleFilter'>): QueueCategory {
  if (i.kind === 'missing') return 'missing';
  if (i.kind === 'flagged') return 'flagged';
  return i.ruleFilter === null ? 'disagreement' : 'ruled';
}

function kindRank(i: QueueItem): number {
  return CATEGORY_RANK[categoryOf(i)];
}

function cmpIpoLive(a: QueueIpo, b: QueueIpo): number {
  return cmpNullsLast(nearestDate(a), nearestDate(b), 1) || cmpStr(a.slug, b.slug);
}

function cmpIpoListed(a: QueueIpo, b: QueueIpo): number {
  return cmpNullsLast(a.listingDate, b.listingDate, -1) || cmpStr(a.slug, b.slug);
}

export function compareItems(a: QueueItem, b: QueueItem): number {
  return (
    cmpIpoLive(a.ipo, b.ipo) ||
    kindRank(a) - kindRank(b) ||
    cmpStr(a.fieldName, b.fieldName) ||
    cmpStr(a.tableName, b.tableName) ||
    cmpStr(a.rowKey, b.rowKey) ||
    cmpStr(a.id, b.id)
  );
}

/** Orders every item into OD-136's three groups. Every input item is represented exactly once. */
export function orderQueue(items: QueueItem[]): QueueEntry[] {
  const g1: QueueItem[] = [];
  const g2: QueueItem[] = [];
  const listed = new Map<string, QueueIpoSummary>();
  for (const item of items) {
    const g = groupOf(item);
    if (g === 1) g1.push(item);
    else if (g === 2) g2.push(item);
    else {
      let s = listed.get(item.ipo.id);
      if (!s) {
        s = { ipo: item.ipo, conflicts: 0, missing: 0, flagged: 0, ruled: 0, editorHref: `/ipos/${encodeURIComponent(item.ipo.slug)}` };
        listed.set(item.ipo.id, s);
      }
      const cat = categoryOf(item);
      if (cat === 'disagreement') s.conflicts++;
      else s[cat]++;
    }
  }
  g1.sort(compareItems);
  g2.sort(compareItems);
  const g3 = [...listed.values()].sort((a, b) => cmpIpoListed(a.ipo, b.ipo));
  return [
    ...g1.map((item) => ({ type: 'item' as const, group: 1 as const, item })),
    ...g2.map((item) => ({ type: 'item' as const, group: 2 as const, item })),
    ...g3.map((summary) => ({ type: 'ipo' as const, group: 3 as const, summary })),
  ];
}

/** One IPO expanded (a group-3 line opened): its items in the within-IPO order. */
export function orderIpoItems(items: QueueItem[]): QueueItem[] {
  return [...items].sort(compareItems);
}

export interface QueueCounts {
  total: number;
  byGroup: Record<QueueGroup, { items: number; ipos: number }>;
  byKind: Record<QueueCategory, number>;
  byReason: Record<string, number>;
}

export function countQueue(items: QueueItem[]): QueueCounts {
  const byGroup: QueueCounts['byGroup'] = { 1: { items: 0, ipos: 0 }, 2: { items: 0, ipos: 0 }, 3: { items: 0, ipos: 0 } };
  const iposPerGroup: Record<QueueGroup, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set() };
  const byKind: Record<QueueCategory, number> = { disagreement: 0, missing: 0, flagged: 0, ruled: 0 };
  const byReason: Record<string, number> = {};
  for (const item of items) {
    const g = groupOf(item);
    byGroup[g].items++;
    iposPerGroup[g].add(item.ipo.id);
    byKind[categoryOf(item)]++;
    for (const r of item.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
  }
  for (const g of [1, 2, 3] as const) byGroup[g].ipos = iposPerGroup[g].size;
  return { total: items.length, byGroup, byKind, byReason };
}

export interface QueueView {
  group?: QueueGroup;
  reason?: string;
  kind?: QueueCategory;
  ipo?: string;
}

/** View filters only (the default view is everything); counts are always over the whole queue. */
export function applyView(items: QueueItem[], view: QueueView): QueueItem[] {
  return items.filter((i) => {
    if (view.ipo && i.ipo.slug !== view.ipo) return false;
    if (view.group && groupOf(i) !== view.group) return false;
    if (view.reason && !i.reasons.includes(view.reason)) return false;
    if (view.kind && categoryOf(i) !== view.kind) return false;
    return true;
  });
}

export function paginate<T>(entries: T[], page: number, pageSize: number): { entries: T[]; page: number; pageSize: number; totalEntries: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { entries: entries.slice((p - 1) * pageSize, p * pageSize), page: p, pageSize, totalEntries: entries.length, totalPages };
}
