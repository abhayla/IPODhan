/**
 * §9.2 item 18 / §1.11: a field the IPO's type makes not applicable disappears from the page. After
 * an admin corrects the type (§2.8, the Mopshop shape), a value stored under the OLD type may still
 * sit in its column; the reader never sees it. `NOT_APPLICABLE` is derived, never stored (§2.7), so
 * this is a read-time rule: the column (and the admin audit row) keep the value, the payload does not.
 *
 * The rule is `isFieldApplicable` over the generated field manifest — the same function the plan
 * (`registryRanksFor`) and the admin editor (`isEditorFieldApplicable`) ask. No second table of rules.
 * Server-only: it reads the manifest, which is never sent to a reader.
 *
 * ONE helper for every reader path (PR #1327 Tier A MAJOR-2): the IPO detail object
 * (`hideNotApplicableFields`, findBySlug and the list rows of findAll) and every route that reads a
 * child table on its own (`hideNotApplicableRows`: /financials, /peers, /listing-performance,
 * /api/tools/compare, the page's promoters). Every manifest table is declared in
 * `READER_TABLE_EXPOSURE`; a manifest table missing from it fails at module load, and a table name
 * this module does not know fails at the call, so nothing is skipped silently.
 */
import manifestJson from '../../scraper/config/field-manifest.json';
import { isFieldApplicable, type ApplicabilityEntry } from '@ipodhan/shared/services/field-plan-generator';

const MANIFEST = (manifestJson as unknown as { fields: Record<string, ApplicabilityEntry> }).fields;

/**
 * How each manifest table reaches a reader:
 *   - `null`: the `ipos` row itself (top level of the detail object and of a list row);
 *   - a string: the relation property of the IPO detail object (`IPOWithRelations`) that carries it;
 *   - `'rows-only'`: not on the detail object; a reader of the table blanks its rows with
 *     `hideNotApplicableRows(ipo, table, rows)`.
 */
export const READER_TABLE_EXPOSURE: Readonly<Record<string, string | null | 'rows-only'>> = {
  ipos: null,
  ipo_details: 'ipoDetails',
  financial_data: 'financialData',
  listing_performance: 'listingPerformance',
  anchor_investors: 'anchorInvestor',
  peer_companies: 'peerCompanies',
  registrars: 'registrarRelation',
  documents: 'documents',
  financial_statements: 'rows-only',
  ipo_valuation: 'rows-only',
  promoters: 'rows-only',
  promoter_acquisition_ranges: 'rows-only',
  ipo_risk_factors: 'rows-only',
  brlm_track_record: 'rows-only',
  ipo_intermediaries: 'rows-only',
};

/** Back-compat name for the detail-object slice of the map (tests and the editor read it). */
export const DETAIL_PROPERTY_BY_TABLE: Readonly<Record<string, string | null>> = Object.fromEntries(
  Object.entries(READER_TABLE_EXPOSURE).filter(([, v]) => v !== 'rows-only')
) as Record<string, string | null>;

/**
 * Tables a reader shows that the manifest does not describe column by column, and the manifest
 * table whose applicability they follow as a WHOLE: `ipo_financials` (Story 4.10) holds the same
 * financials as `financial_data` under other column names, so the row is hidden exactly when every
 * `financial_data` field is not applicable to the IPO.
 */
export const WHOLE_ROW_ALIASES: Readonly<Record<string, string>> = {
  ipo_financials: 'financial_data',
};

const MANIFEST_TABLES = new Set(Object.keys(MANIFEST).map((k) => k.split('.')[0]));
{
  const undeclared = [...MANIFEST_TABLES].filter((t) => !(t in READER_TABLE_EXPOSURE));
  if (undeclared.length > 0) {
    throw new Error(
      `ipo-field-applicability: manifest table(s) ${undeclared.join(', ')} have no reader exposure; ` +
        'declare each in READER_TABLE_EXPOSURE so a not-applicable field can never reach a reader unhidden'
    );
  }
}

function camel(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export interface ApplicabilityIpo {
  segment?: string | null;
  listingExchanges?: readonly string[] | null;
  offeringType?: string | null;
}

function probeOf(ipo: ApplicabilityIpo) {
  return { segment: ipo.segment ?? null, listingExchanges: ipo.listingExchanges ?? null, offeringType: ipo.offeringType ?? null };
}

/** Every manifest `table.column` that does not apply to this IPO. */
export function notApplicableFieldKeys(ipo: ApplicabilityIpo): string[] {
  const probe = probeOf(ipo);
  return Object.entries(MANIFEST)
    .filter(([, entry]) => !isFieldApplicable(entry, probe))
    .map(([key]) => key);
}

/** The camelCase columns of one manifest table that do not apply to this IPO. */
export function notApplicableColumns(ipo: ApplicabilityIpo, table: string): string[] {
  const prefix = `${table}.`;
  return notApplicableFieldKeys(ipo)
    .filter((k) => k.startsWith(prefix))
    .map((k) => camel(k.slice(prefix.length)));
}

/** True when EVERY manifest field of `table` is not applicable to this IPO. */
function wholeTableNotApplicable(ipo: ApplicabilityIpo, table: string): boolean {
  const probe = probeOf(ipo);
  const entries = Object.entries(MANIFEST).filter(([k]) => k.startsWith(`${table}.`));
  return entries.length > 0 && entries.every(([, entry]) => !isFieldApplicable(entry, probe));
}

function blank(target: unknown, prop: string): void {
  if (target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, prop)) {
    (target as Record<string, unknown>)[prop] = null;
  }
}

function blankedCopy<R>(rows: R, fields: readonly string[]): R {
  if (rows === null || rows === undefined || fields.length === 0) return rows;
  const copyOne = (r: unknown) => {
    if (!r || typeof r !== 'object') return r;
    const c = { ...(r as object) };
    for (const f of fields) blank(c, f);
    return c;
  };
  return (Array.isArray(rows) ? rows.map(copyOne) : copyOne(rows)) as R;
}

/**
 * A copy of `rows` (one row, a list, or null) of `table` with every column this IPO's type makes not
 * applicable set to null; for a `WHOLE_ROW_ALIASES` table, null (or an empty list) when its manifest
 * table does not apply at all. Throws for a table this module does not know.
 */
export function hideNotApplicableRows<R>(ipo: ApplicabilityIpo, table: string, rows: R): R {
  if (table in WHOLE_ROW_ALIASES) {
    if (!wholeTableNotApplicable(ipo, WHOLE_ROW_ALIASES[table])) return rows;
    return (Array.isArray(rows) ? [] : rows === undefined ? undefined : null) as R;
  }
  if (!(table in READER_TABLE_EXPOSURE)) {
    throw new Error(`hideNotApplicableRows: ${table} is neither a manifest table nor a declared alias`);
  }
  return blankedCopy(rows, notApplicableColumns(ipo, table));
}

/**
 * A copy of the IPO detail object (or a list row) with every not-applicable field set to null.
 * Applicability is decided from the IPO's own type BEFORE anything is blanked (blanking `segment`
 * on an INVITS must not change the type the rest is judged by).
 */
export function hideNotApplicableFields<T extends ApplicabilityIpo>(ipo: T): T {
  const probe: ApplicabilityIpo = probeOf(ipo);
  const out: Record<string, unknown> = { ...(ipo as unknown as Record<string, unknown>) };
  let changed = false;
  for (const [table, prop] of Object.entries(READER_TABLE_EXPOSURE)) {
    if (prop === 'rows-only') continue;
    const cols = notApplicableColumns(probe, table);
    if (cols.length === 0) continue;
    if (prop === null) {
      for (const c of cols) {
        if (Object.prototype.hasOwnProperty.call(out, c) && out[c] !== null) changed = true;
        blank(out, c);
      }
      continue;
    }
    if (out[prop] === null || out[prop] === undefined) continue;
    out[prop] = blankedCopy(out[prop], cols);
    changed = true;
  }
  if ('ipoFinancials' in out && out.ipoFinancials != null) {
    const hidden = hideNotApplicableRows(probe, 'ipo_financials', out.ipoFinancials);
    if (hidden !== out.ipoFinancials) changed = true;
    out.ipoFinancials = hidden;
  }
  return (changed ? out : ipo) as unknown as T;
}
