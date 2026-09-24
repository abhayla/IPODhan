// Item 6 (spec §2.5, §2.5.5 rules 1 and 3, OD-65, OD-90, OD-91): the ONE plan-row supersession
// rule. Plain ESM so both the scraper (TypeScript, via plan-supersession-rule.d.mts) and the
// nightly audit (node, scripts/lib/pull-frozen-checks.mjs) execute the same code. Data comes from
// document-precedence.json and document-families.json beside this file.
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const PRECEDENCE_CONFIG = read('document-precedence.json');
const FAMILY_CONFIG = read('document-families.json');

export const PRECEDENCE = Object.freeze({ ...PRECEDENCE_CONFIG.precedence });
export const NON_REOPENING_TYPES = Object.freeze([...PRECEDENCE_CONFIG.nonReopeningTypes]);
export const DOC_TYPE_FAMILIES = Object.freeze(
  Object.fromEntries(Object.entries(FAMILY_CONFIG.families).map(([k, v]) => [k, Object.freeze([...v])]))
);

/** The family for a manifest documentType (itself only, when unlisted). */
export function docTypeFamily(documentType) {
  return DOC_TYPE_FAMILIES[documentType] ?? [documentType];
}

/** A field's family: its manifest documentType's family, else only the chosen document's type. */
export function familyForField(manifestDocumentType, chosenDocType) {
  return manifestDocumentType ? docTypeFamily(manifestDocumentType) : [chosenDocType];
}

function day(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** §2.5.5 Rule 3 fixed-price test: issue_type, and where null, floor = cap. */
export function isFixedPriceIssue(issueType, floor, cap) {
  if (issueType === 'FIXED_PRICE') return true;
  if (issueType) return false;
  return floor != null && cap != null && Number(floor) === Number(cap);
}

/**
 * Does `incoming` supersede `chosen` for a field whose family is `family`?
 * chosen/incoming: { id, docType, filingDate, sha256? }.
 * Returns { supersede: true, reason } | { supersede: false, unordered, reason }.
 */
export function decidePlanRowSupersession(chosen, incoming, { family, fixedPrice }) {
  const no = (reason, unordered = false) => ({ supersede: false, unordered, reason });
  if (incoming.id === chosen.id) return no('same document (OD-65: one read per document)');
  if (NON_REOPENING_TYPES.includes(incoming.docType)) {
    return no(`${incoming.docType} never reopens a plan row (OD-90: admin-reviewed suggestions only)`);
  }
  if (!family.includes(incoming.docType)) return no(`${incoming.docType} cannot carry this field`);
  const pi = PRECEDENCE[incoming.docType];
  const pc = PRECEDENCE[chosen.docType];
  if (pi === undefined || pc === undefined) return no(`unknown document type (${chosen.docType} / ${incoming.docType})`);
  const fi = day(incoming.filingDate);
  const fc = day(chosen.filingDate);
  if (incoming.docType === chosen.docType) {
    if (!fi || !fc) return no(`same type ${incoming.docType} with a missing filing_date — not ordered`, true);
    if (incoming.sha256 && chosen.sha256 && incoming.sha256 === chosen.sha256) {
      return no('identical sha256 — same document via a different URL (R3)');
    }
    return fi > fc
      ? { supersede: true, reason: `newer filing of the same type ${incoming.docType} (§2.5.5 Rule 1)` }
      : no(`incoming filing_date ${fi} is not newer than ${fc}`);
  }
  if (chosen.docType === 'PROSPECTUS' && fixedPrice) {
    if (!fi || !fc) return no('fixed-price prospectus baseline vs a document with a missing filing_date — not ordered', true);
    return fi > fc
      ? { supersede: true, reason: `${incoming.docType} filed after a fixed-price prospectus (§2.5.5 Rule 3)` }
      : no('filed before the fixed-price prospectus');
  }
  return pi > pc
    ? { supersede: true, reason: `${incoming.docType} (${pi}) outranks ${chosen.docType} (${pc}) (§2.5)` }
    : no(`${incoming.docType} (${pi}) does not outrank ${chosen.docType} (${pc})`);
}

/**
 * Object keys sorted recursively; array order kept (arrays are ordered data). Postgres jsonb
 * returns keys in its own order (shorter keys first), so an unsorted serialisation of the value
 * read back never equals the one written.
 */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]));
  }
  return v;
}

/**
 * OD-91 / OD-73: the text a receipt stores, and the text a column's current value is compared
 * as. Numbers compare by value ("10.00" = 10), dates by calendar day, objects as JSON with keys
 * sorted recursively (array order kept). The same function runs on the receipt and on the column.
 */
export function normalizeReceiptValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return JSON.stringify(sortKeysDeep(v));
  const s = String(v).trim();
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z?)?$/.test(s)) return s.slice(0, 10);
  return s;
}
