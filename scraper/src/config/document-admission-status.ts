/**
 * #869 — what status a newly discovered document is admitted with.
 *
 * WHY THIS LIVES IN config/ AND NOT NEXT TO THE CONSUMER. The predicate is read
 * by two modules on opposite sides of the §7.6 layer order: the DISCOVERY layer
 * (`document-discovery-runner.ts`) decides the status when it admits a document,
 * and the CONSOLIDATION layer (`filing-auto-persist.ts`) decides what to dispatch.
 * Discovery is the BOTTOM layer, so it may not import consolidation — putting the
 * predicate beside the consumer made `document-discovery-runner -> filing-auto-persist`
 * an upward edge, which `scripts/ci/check-module-boundaries.mjs` correctly refused:
 *
 *   discovery imports consolidation — discovery is below consolidation in the layer order
 *
 * `scraper/src/config/` carries no layer, so both sides may read it. That is also
 * the honest home on its own terms: which document types have an extractor is
 * configuration, not consolidation logic.
 *
 * WHAT IT FIXES. `extraction_status = 'PENDING'` carried two opposite meanings with
 * nothing to tell them apart — "queued, will be processed" for a type the consumer
 * dispatches on, and "can never be processed" for every other type. The consumer
 * silently skips what it does not recognise, so such a row was admitted, stamped
 * PENDING, skipped on every pass, and stayed PENDING forever. Measured on
 * ipodhan_staging 2026-09-23: 71 documents across 8 types, 100% PENDING, ZERO ever
 * COMPLETED.
 *
 * Owner decision 2026-09-23 (option A of #869): stamp the honest status at admission
 * rather than build eight extractors whose value nobody has measured. Reversible — if
 * an extractor is ever written for one of these types, the stamp comes off and the
 * rows re-enter the queue.
 */

/** The terminal status for a document whose type has no extractor. */
export const NOT_EXTRACTABLE_STATUS = 'NOT_EXTRACTABLE';

/**
 * The doc types the automatic door will CONSIDER: the four the python filing
 * extractor parses, plus the anchor report (its own extractor, its own write door).
 *
 * This is the SET both layers read. `filing-auto-persist.ts` re-exports it and its
 * predicate rather than defining them, so there is exactly one list — the admission
 * stamp and the consumer's dispatch cannot disagree about which types have an
 * extractor, which is the whole mechanism of #869's fix.
 */
export const AUTO_PERSIST_DOC_TYPES: readonly string[] = [
  'PRICE_BAND_AD',
  'RHP',
  'DRHP',
  'PROSPECTUS',
  'ANCHOR_ALLOCATION_REPORT',
];

/** Whether a document type has any extractor at all. */
export function isExtractableDocType(type: string): boolean {
  return AUTO_PERSIST_DOC_TYPES.includes(String(type ?? '').toUpperCase());
}

/**
 * The status a newly discovered document is admitted with.
 *
 * It reads `isExtractableDocType` above — the SAME predicate the consumer dispatches
 * on, because `filing-auto-persist.ts` re-exports it from here rather than keeping a
 * second copy. That single list is the mechanism: fixing the eight measured types
 * while leaving the class intact is what #869 explicitly warns against, and a ninth
 * type gets the honest status the day it appears with no code change.
 *
 * An empty, null or unknown type resolves to NOT_EXTRACTABLE, never PENDING:
 * defaulting an unrecognised shape to "queued" would re-create the bug for the one
 * case least likely to have an extractor.
 */
export function resolveAdmissionExtractionStatus(type: string): string {
  return isExtractableDocType(type) ? 'PENDING' : NOT_EXTRACTABLE_STATUS;
}
