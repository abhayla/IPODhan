/**
 * §9.2 item 18 / §1.11: a field the IPO's type makes not applicable disappears from the page. After
 * an admin corrects the type (§2.8, the Mopshop shape), a value stored under the OLD type may still
 * sit in its column; the reader never sees it. `NOT_APPLICABLE` is derived, never stored (§2.7), so
 * this is a read-time rule: the column (and the admin audit row) keep the value, the payload does not.
 *
 * The rule is `isFieldApplicable` over the generated field manifest — the same function the plan
 * (`registryRanksFor`) and the admin editor (`isEditorFieldApplicable`) ask. No second table of rules.
 * Server-only: it reads the manifest, which is never sent to a reader.
 */
import manifestJson from '../../scraper/config/field-manifest.json';
import { isFieldApplicable, type ApplicabilityEntry } from '@ipodhan/shared/services/field-plan-generator';

const MANIFEST = (manifestJson as unknown as { fields: Record<string, ApplicabilityEntry> }).fields;

/**
 * Where each manifest table's columns live on the IPO detail object (`IPOWithRelations`): `ipos` at
 * the top level, the others under their relation property (an object, or a list of rows).
 */
export const DETAIL_PROPERTY_BY_TABLE: Readonly<Record<string, string | null>> = {
  ipos: null,
  ipo_details: 'ipoDetails',
  financial_data: 'financialData',
  listing_performance: 'listingPerformance',
  anchor_investors: 'anchorInvestor',
  peer_companies: 'peerCompanies',
};

function camel(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export interface ApplicabilityIpo {
  segment?: string | null;
  listingExchanges?: readonly string[] | null;
  offeringType?: string | null;
}

/** Every manifest `table.column` that does not apply to this IPO. */
export function notApplicableFieldKeys(ipo: ApplicabilityIpo): string[] {
  const probe = {
    segment: ipo.segment ?? null,
    listingExchanges: ipo.listingExchanges ?? null,
    offeringType: ipo.offeringType ?? null,
  };
  return Object.entries(MANIFEST)
    .filter(([, entry]) => !isFieldApplicable(entry, probe))
    .map(([key]) => key);
}

function blank(target: unknown, prop: string): void {
  if (target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, prop)) {
    (target as Record<string, unknown>)[prop] = null;
  }
}

/**
 * A copy of the IPO detail object with every not-applicable field set to null. Applicability is
 * decided from the IPO's own type BEFORE anything is blanked (blanking `segment` on an INVITS must
 * not change the type the rest is judged by).
 */
export function hideNotApplicableFields<T extends ApplicabilityIpo>(ipo: T): T {
  const keys = notApplicableFieldKeys(ipo);
  if (keys.length === 0) return ipo;
  const out: Record<string, unknown> = { ...(ipo as unknown as Record<string, unknown>) };
  const copied = new Set<string>();
  for (const key of keys) {
    const [table, column] = key.split('.');
    if (!(table in DETAIL_PROPERTY_BY_TABLE)) continue;
    const prop = DETAIL_PROPERTY_BY_TABLE[table];
    const field = camel(column);
    if (prop === null) {
      blank(out, field);
      continue;
    }
    const rel = out[prop];
    if (rel === null || rel === undefined) continue;
    if (!copied.has(prop)) {
      out[prop] = Array.isArray(rel) ? rel.map((r) => ({ ...(r as object) })) : { ...(rel as object) };
      copied.add(prop);
    }
    const target = out[prop];
    if (Array.isArray(target)) target.forEach((r) => blank(r, field));
    else blank(target, field);
  }
  return out as unknown as T;
}
