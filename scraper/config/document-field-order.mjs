// #1364 (spec §1 "Document type order inside rank 1", OD-30, OD-129): the ONE comparator that decides
// which of two offer documents writes an `ipos` field at consolidation. Plain ESM beside
// listing-sentence-precedence.mjs and plan-supersession-rule.mjs, whose tables it reuses: there is no
// second copy of any order.
//
// Spec §1: price-dependent fields  PRICE_BAND_AD / CORRIGENDUM > RHP > PROSPECTUS > DRHP;
//          final post-issue facts  PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP;
//          "an older draft can never overwrite a final advertisement".
// OD-30:   within one document type the later FILING date wins.
// The spec does not say which fields are "final post-issue facts". Until the owner says
// (owner-questions-2026-10-01 Q3), a field that is neither price-dependent nor listing-sentence is
// ranked only where BOTH orders agree; where they disagree the stored value is kept (fail closed).
import { PRECEDENCE } from './plan-supersession-rule.mjs';
import { LISTING_SENTENCE_ORDER } from './listing-sentence-precedence.mjs';

const OFFER_DOCUMENT_TYPES = Object.freeze(['PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD', 'RHP', 'DRHP']);

/** Higher number decides. The ad and a corrigendum carry the final band and rank equal. */
export const PRICE_DEPENDENT_ORDER = Object.freeze({ PRICE_BAND_AD: 4, CORRIGENDUM: 4, RHP: 3, PROSPECTUS: 2, DRHP: 1 });

/** Higher number decides. The §2.5 PRECEDENCE table (document-precedence.json) restricted to offer documents. */
export const FINAL_POST_ISSUE_ORDER = Object.freeze(Object.fromEntries(OFFER_DOCUMENT_TYPES.map((t) => [t, PRECEDENCE[t]])));

const TABLES = Object.freeze({ PRICE: PRICE_DEPENDENT_ORDER, POST_ISSUE: FINAL_POST_ISSUE_ORDER, LISTING: LISTING_SENTENCE_ORDER });

function day(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** OD-30 between two documents of equal rank: true / false by filing date, null when not ordered. */
function byFilingDate(stored, incoming) {
  const fs = day(stored.filingDate);
  const fi = day(incoming.filingDate);
  if (!fs || !fi) return { outranks: null, reason: 'equal rank and a filing date is unknown (OD-30 cannot order): newest write' };
  if (fs === fi) return { outranks: null, reason: `equal rank, same filing date ${fs}: newest write` };
  return fi > fs
    ? { outranks: true, reason: `${incoming.docType} filed ${fi} is later than ${stored.docType} filed ${fs} (OD-30)` }
    : { outranks: false, reason: `${incoming.docType} filed ${fi} is not later than ${stored.docType} filed ${fs} (OD-30)` };
}

function inTable(table, stored, incoming) {
  const rs = table[stored.docType];
  const ri = table[incoming.docType];
  if (rs === undefined || ri === undefined) return { outranks: null, reason: `not ordered by this field's order (${stored.docType} / ${incoming.docType})` };
  if (rs === ri) return byFilingDate(stored, incoming);
  return ri > rs
    ? { outranks: true, reason: `${incoming.docType} outranks ${stored.docType}` }
    : { outranks: false, reason: `${stored.docType} outranks ${incoming.docType}` };
}

/**
 * stored / incoming: { docType, documentId?, filingDate? }. order: 'PRICE' | 'POST_ISSUE' | 'LISTING' |
 * 'UNDECIDED'. Returns { outranks: true | false | null, reason }: true writes the incoming value, false
 * keeps the stored one, null means the documents cannot be told apart (an unknown type, the same
 * document re-read, equal rank without both filing dates) and the caller keeps its newest-write rule.
 */
export function compareDocumentsForField(stored, incoming, order) {
  if (!stored?.docType || !incoming?.docType) return { outranks: null, reason: 'document type unknown on one side' };
  if (stored.documentId && stored.documentId === incoming.documentId) return { outranks: null, reason: 'the same document read again' };
  if (order !== 'UNDECIDED') {
    const table = TABLES[order];
    if (!table) return { outranks: null, reason: `unknown order ${order}` };
    return inTable(table, stored, incoming);
  }
  const price = inTable(PRICE_DEPENDENT_ORDER, stored, incoming);
  const post = inTable(FINAL_POST_ISSUE_ORDER, stored, incoming);
  if (price.outranks === post.outranks) return price;
  return {
    outranks: false,
    reason: `the spec's price and post-issue orders disagree on ${incoming.docType} vs ${stored.docType} and this field's order is not stated: stored kept (fail closed)`,
  };
}
