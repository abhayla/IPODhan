/**
 * Admin amount-unit edge conversion (F-156, item 11).
 *
 * OD-67 keeps the five rupee columns (ipos.issue_size, ipo_details.fresh_issue,
 * ipo_details.ofs_issue, ipo_valuation.mcap_at_floor, ipo_valuation.mcap_at_cap) stored in
 * RUPEES. The admin UI (field-labels.ts, dynamic-validation-rules.ts) shows and validates these
 * as CRORE-scale values for a human editor. This module is the one edge that converts between
 * the two — the admin keeps typing/reading crores, the DB keeps holding exact rupees.
 *
 * Only `ipos.issueSize` has a live admin input today (grep 2026-09-24: no admin UI edits
 * fresh_issue / ofs_issue / mcap_at_floor / mcap_at_cap — DynamicFormGenerator only renders
 * ipos + financialData column sets, and those four columns are not in either table's
 * exposed field set). Add a table/field pair here the day one gets an editable input.
 */
import { RUPEES_PER_CRORE } from '@/lib/utils';

export const ADMIN_CRORE_EDGE_FIELDS: Record<string, ReadonlySet<string>> = {
  ipos: new Set(['issueSize']),
};

export function isAdminCroreEdgeField(table: string, field: string): boolean {
  return ADMIN_CRORE_EDGE_FIELDS[table]?.has(field) ?? false;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

/** Stored rupees -> the crore value the admin sees. */
export function rupeesToDisplayCrore(rupees: unknown): number | null {
  const n = toFiniteNumber(rupees);
  if (n === null) return null;
  return n / RUPEES_PER_CRORE;
}

/** The crore value the admin typed -> the exact rupees value to store. */
export function croreToStoredRupees(crore: unknown): number | null {
  const n = toFiniteNumber(crore);
  if (n === null) return null;
  // toFixed(2) guards against float dust from the crore division/multiplication round trip —
  // the column is numeric(18,2), so anything past 2 decimal places is not a real distinction.
  return Number((n * RUPEES_PER_CRORE).toFixed(2));
}

/** Applied once, right after a record loads, before it reaches the form as initialData. */
export function applyCroreEdgeForDisplay<T extends Record<string, unknown>>(table: string, data: T): T {
  const fields = ADMIN_CRORE_EDGE_FIELDS[table];
  if (!fields || !data) return data;
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (field in out) out[field] = rupeesToDisplayCrore(out[field]);
  }
  return out as T;
}

/** Applied once, right before the form's data is sent to the save API. */
export function applyCroreEdgeForSave<T extends Record<string, unknown>>(table: string, data: T): T {
  const fields = ADMIN_CRORE_EDGE_FIELDS[table];
  if (!fields || !data) return data;
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (field in out) out[field] = croreToStoredRupees(out[field]);
  }
  return out as T;
}
