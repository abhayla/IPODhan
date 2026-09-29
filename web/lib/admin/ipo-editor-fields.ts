/**
 * Which fields the IPO page editor offers, and how (spec §9.2 items 2, 5, 7; OD-105; OD-106; OD-110;
 * Appendix A). Server-only: it reads the generated field manifest, which is never sent to a reader.
 *
 * The §1 class and the ranked sources come from `scraper/config/field-manifest.json`, the generated
 * implementable form of Appendix A (classes D, T, M; X/W fields are job-owned and carry no row). The
 * manifest has no row for the calculated (C) or bookkeeping (I) fields, so the ones in the editor's
 * tables are listed below; `tests/unit/lib/admin/ipo-editor.test.ts:62` checks both lists
 * against the spec's own table (docs/design/field-source-resolution.spec.mjs), so a field added
 * there cannot silently go missing here.
 */
import manifestJson from '../../../scraper/config/field-manifest.json';
import { IPO_FIELDS_AWAITING_PHASE_B } from '@ipodhan/shared/services/admin-field-write';
import { PLAN_INVALIDATING_IPO_FIELDS } from '@ipodhan/shared/services/plan-invalidating-rebuild';

export type FieldClass = 'D' | 'T' | 'X' | 'W' | 'M' | 'C' | 'I';

/**
 * How the editor treats a field (§9.2 item 7):
 * - `panel`:    the per-source panel plus a typed value (class D; class T except `ipos.status`)
 * - `setting`:  a plain value or on/off control (the two ADMIN settings on the IPO, class I)
 * - `derived`:  read-only "calculated from ..." (class C, item 5)
 * - `readonly`: shown, never edited (X/W/M and `ipos.status`)
 */
export type EditorMode = 'panel' | 'setting' | 'derived' | 'readonly';

interface ManifestRow {
  class: 'D' | 'T' | 'X' | 'W' | 'M';
  rank: Record<string, string[]>;
  unit: 'rupee' | 'crore' | 'keep' | 'per_row';
  comparisonFamily: string;
  na?: string[];
}

const MANIFEST = (manifestJson as unknown as { fields: Record<string, ManifestRow> }).fields;

/**
 * The one-row-per-IPO tables the ONE admin write accepts (ADMIN_WRITABLE_TABLES in
 * packages/shared/src/services/admin-field-write.ts) that the manifest has rows for. List-shaped
 * tables (lead managers, peers, anchors, financial-statement years, ...) are item 8 (OD-107), Phase B.
 */
export const EDITOR_TABLES = ['ipos', 'ipo_details', 'financial_data', 'listing_performance'] as const;
export type EditorTable = (typeof EDITOR_TABLES)[number];

/** Class C fields in the editor's tables, with what they are calculated from (spec table, `formula`). */
export const DERIVED_FIELDS: Readonly<Record<string, string>> = {
  'ipos.registrar_id': 'the registrar name',
  'ipos.slug': 'the company name',
  'listing_performance.issue_price': 'the upper price band at listing',
  'listing_performance.listing_gain_percent': 'the listing price and the issue price',
  'listing_performance.current_gain_percent': 'the current price and the issue price',
  'listing_performance.symbol': 'the IPO symbol',
  'listing_performance.company_name': 'the IPO company name',
  'listing_performance.listing_date': 'the IPO listing date',
};

/** The only class I fields an admin sets (§9.2 item 7, OD-110). Every other class I field is bookkeeping. */
export const ADMIN_SETTING_FIELDS = ['ipos.rating_override', 'ipos.scraper_locked'] as const;

/**
 * Release 1: the `ipos` fields the ONE write refuses until Phase B (identifier alias, item 26; plan
 * rebuild, item 18), keyed `ipos.<sql column>`, with the write's own reason. Shown read-only.
 */
export const AWAITING_PHASE_B: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IPO_FIELDS_AWAITING_PHASE_B).map(([camel, reason]) => [
    `ipos.${camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
    `Not editable yet: ${reason}.`,
  ])
);

/**
 * §2.8 / §9.2 item 18: shown before the save on the three plan-invalidating fields (offering type,
 * segment, listing exchanges), keyed like the manifest (`ipos.offering_type`).
 */
export const PLAN_REBUILD_KEYS: ReadonlySet<string> = new Set(
  PLAN_INVALIDATING_IPO_FIELDS.map((camel) => `ipos.${camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`)
);
export const PLAN_REBUILD_NOTICE =
  "Saving this rebuilds this IPO's source plan (§2.8): which sources are asked for each field, and in which order, change with the offering type, segment and listing exchanges. The IPO stays the same row. Fields the new type does not use disappear from the page; any admin value on them stays in the audit history.";

/** OD-106, shown to the admin on every class T (E-1 timetable) field the editor offers. */
export const E1_RULE_TEXT =
  'Exchange timetable date (E-1, OD-106): if NSE or BSE later publishes a newer, different date, it replaces your value and you are alerted.';

/**
 * Amounts the reader sees in Rs crore while the column stores rupees (OD-108: typed "in the unit the
 * reader sees"). Each is rendered on the page with formatIssueSizeCrores (IPODetailsTable,
 * page.tsx fact ribbon). The manifest tags each of these `unit: rupee`.
 */
export const CRORE_INPUT_FIELDS = new Set(['ipos.issue_size', 'ipo_details.fresh_issue', 'ipo_details.ofs_issue']);

export interface EditorFieldSpec {
  /** `table.column`, the manifest's key (SQL names). */
  key: string;
  tableName: EditorTable;
  column: string;
  fieldClass: FieldClass;
  mode: EditorMode;
  /** Appendix A ranks 1-3 for this IPO's type; empty for non-panel fields. */
  sources: string[];
  unit: ManifestRow['unit'] | null;
  comparisonFamily: string | null;
  /** Offering types for which the field does not apply (§1.11). */
  na: string[];
  derivedFrom?: string;
  /** Set when release 1 shows the field read-only although its class is editable (AWAITING_PHASE_B). */
  readonlyReason: string | null;
  /** §2.8 / §9.2 item 18: a save of this field rebuilds the IPO's plan; the editor says so first. */
  planRebuild: boolean;
  e1: boolean;
  croreInput: boolean;
}

/** The Appendix A type column for an IPO (same rule as resolveIpoTypeKey in field-plan-generator.ts). */
export function ipoTypeKey(ipo: { segment?: string | null; listingExchanges?: string[] | null }): string {
  if (ipo.segment !== 'SME') return 'MAINBOARD';
  return (ipo.listingExchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}

/** §9.2 item 7 as a function of the class and the key. */
export function editorModeFor(fieldClass: FieldClass, key: string): EditorMode {
  if (AWAITING_PHASE_B[key]) return 'readonly';
  if (fieldClass === 'D') return 'panel';
  if (fieldClass === 'T') return key === 'ipos.status' ? 'readonly' : 'panel';
  if (fieldClass === 'C') return 'derived';
  if (fieldClass === 'I') return (ADMIN_SETTING_FIELDS as readonly string[]).includes(key) ? 'setting' : 'readonly';
  return 'readonly';
}

/**
 * Every field the editor lists for an IPO of this type, in manifest order then C, then settings.
 * Bookkeeping (class I) fields other than the two settings are left out: there is nothing to edit.
 */
export function editorFieldCatalog(typeKey: string): EditorFieldSpec[] {
  const out: EditorFieldSpec[] = [];
  for (const [key, row] of Object.entries(MANIFEST)) {
    const [tableName, column] = key.split('.');
    if (!(EDITOR_TABLES as readonly string[]).includes(tableName)) continue;
    const mode = editorModeFor(row.class, key);
    out.push({
      key,
      tableName: tableName as EditorTable,
      column,
      fieldClass: row.class,
      mode,
      sources: mode === 'panel' ? (row.rank[typeKey] ?? row.rank.MAINBOARD ?? []).slice(0, 3) : [],
      unit: row.unit,
      comparisonFamily: row.comparisonFamily,
      na: row.na ?? [],
      readonlyReason: AWAITING_PHASE_B[key] ?? null,
      planRebuild: PLAN_REBUILD_KEYS.has(key),
      e1: row.class === 'T',
      croreInput: CRORE_INPUT_FIELDS.has(key),
    });
  }
  for (const [key, from] of Object.entries(DERIVED_FIELDS)) {
    const [tableName, column] = key.split('.');
    out.push({
      key,
      tableName: tableName as EditorTable,
      column,
      fieldClass: 'C',
      mode: 'derived',
      sources: [],
      unit: null,
      comparisonFamily: null,
      na: [],
      derivedFrom: from,
      readonlyReason: null,
      planRebuild: false,
      e1: false,
      croreInput: false,
    });
  }
  for (const key of ADMIN_SETTING_FIELDS) {
    const [tableName, column] = key.split('.');
    out.push({
      key,
      tableName: tableName as EditorTable,
      column,
      fieldClass: 'I',
      mode: 'setting',
      sources: [],
      unit: null,
      comparisonFamily: null,
      na: [],
      readonlyReason: null,
      planRebuild: false,
      e1: false,
      croreInput: false,
    });
  }
  return out;
}

/** Counts per class and mode over the editor's tables, for the report and the tests. */
export function editorCatalogCounts(typeKey = 'MAINBOARD'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of editorFieldCatalog(typeKey)) {
    const k = `${f.fieldClass}:${f.mode}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
