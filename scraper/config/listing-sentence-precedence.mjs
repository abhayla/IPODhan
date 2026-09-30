// #1233 round 2 (OD-129, OD-30): the ONE order in which offer documents decide the listing
// sentence fields, `ipos.segment` (the board) and `ipos.listing_exchanges`. Plain ESM so the
// scraper's write gate (filing-persister.ts, via listing-sentence-precedence.d.mts), the write
// matrix (field-priority-matrix.ts) and the nightly check d_segment_document_board
// (scripts/lib/detection-floor-checks.mjs) all run this same code; there is no second copy.
//
// OD-129: "Prospectus, then RHP, then DRHP (the later filing wins, OD-30); a price band
// advertisement counts only when it names the exchanges". The ad's place (below RHP, above DRHP)
// is inferred, not spec-stated: it is published with the RHP and after the draft, so "an older
// draft can never overwrite a final advertisement" (spec, document type order) keeps it above DRHP.
// This is NOT the price-field order (field-priority-matrix.ts DOCUMENT_TYPE_RANK, where the ad
// ranks first); the listing sentence is a fact about the filing, not about the price.

/** Higher number = decides. A type not listed here never decides these fields (fail closed). */
export const LISTING_SENTENCE_ORDER = Object.freeze({ PROSPECTUS: 4, RHP: 3, PRICE_BAND_AD: 2, DRHP: 1 });

/** The `ipos` fields (camelCase) the listing sentence decides. */
export const LISTING_SENTENCE_FIELDS = Object.freeze(['segment', 'listingExchanges']);

function day(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Compare two documents for the listing sentence. a, b: { docType, filingDate }.
 * 1 = a decides over b, -1 = b over a, 0 = same type and same filing date (the later
 * extraction decides), null = not ordered (an unlisted type, or the same type with a missing
 * or unreadable filing date) - a caller that must decide treats null as "not allowed".
 */
export function compareListingDocuments(a, b) {
  const ra = LISTING_SENTENCE_ORDER[a?.docType];
  const rb = LISTING_SENTENCE_ORDER[b?.docType];
  if (ra === undefined || rb === undefined) return null;
  if (ra !== rb) return ra > rb ? 1 : -1;
  const fa = day(a.filingDate);
  const fb = day(b.filingDate);
  if (!fa || !fb) return null;
  if (fa === fb) return 0;
  return fa > fb ? 1 : -1;
}

/**
 * The write gate. `self` is the document being persisted; `others` are this IPO's OTHER active
 * documents that have stated a listing sentence (the caller's reader decides which count).
 * Returns { outranked: false } or { outranked: true, reason }. Fails closed: an unlisted self
 * type, or any other document it cannot be ordered against, refuses the claim.
 */
export function listingClaimOutranked(self, others) {
  if (LISTING_SENTENCE_ORDER[self?.docType] === undefined) {
    return { outranked: true, reason: `${self?.docType} is not a listing-sentence document (OD-129: Prospectus > RHP > price band ad > DRHP)` };
  }
  for (const o of others ?? []) {
    const c = compareListingDocuments(o, self);
    if (c === null) {
      return {
        outranked: true,
        reason: `cannot order ${self.docType} (filed ${day(self.filingDate) ?? 'unknown'}) against ${o.docType} ${o.id ?? ''} (filed ${day(o.filingDate) ?? 'unknown'}) - fail closed`,
      };
    }
    if (c > 0) {
      return {
        outranked: true,
        reason: `${o.docType} ${o.id ?? ''} (filed ${day(o.filingDate) ?? 'unknown'}) outranks ${self.docType} (filed ${day(self.filingDate) ?? 'unknown'}) (OD-129 order, OD-30 later filing date)`,
      };
    }
  }
  return { outranked: false };
}

/**
 * The deciding document among one IPO's documents that stated the sentence, for the check.
 * docs: [{ docType, filingDate, extractedAt, ... }]. Returns { doc } (null when none is ranked)
 * or { doc: null, unordered: true } when the best candidates cannot be ordered.
 * Same filing date and type: the later extraction decides, as it does at the gate.
 */
export function pickListingSentenceDocument(docs) {
  const ranked = (docs ?? []).filter((d) => LISTING_SENTENCE_ORDER[d?.docType] !== undefined);
  if (ranked.length === 0) return { doc: null };
  const top = Math.max(...ranked.map((d) => LISTING_SENTENCE_ORDER[d.docType]));
  let best = null;
  for (const d of ranked.filter((x) => LISTING_SENTENCE_ORDER[x.docType] === top)) {
    if (!best) { best = d; continue; }
    const c = compareListingDocuments(d, best);
    if (c === null) return { doc: null, unordered: true };
    if (c > 0 || (c === 0 && String(d.extractedAt ?? '') > String(best.extractedAt ?? ''))) best = d;
  }
  return { doc: best };
}
