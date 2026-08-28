/**
 * The document vocabulary shared by the classifier, the BSE/NSE parsers, the
 * fetch-state machine and the discovery runner (T-403, WP A+B).
 *
 * Kept as ONE module so a new document type cannot be added to the classifier
 * and forgotten in the state machine's due-map — the exact "hand-typed a second
 * list" class that `scraper/src/index.ts`'s STEP_NAMES comment warns about.
 *
 * Every value here MUST exist in `documentTypeEnum`
 * (`packages/shared/src/db/schema.ts`); migration 0035 adds the three the
 * classifier fix needs (PRICE_BAND_AD, CORRIGENDUM, BASIS_OF_ALLOTMENT_AD).
 */

export const DOCUMENT_TYPES = [
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'CORRIGENDUM',
  'ADDENDUM',
  'PRICE_BAND_AD',
  'ANCHOR_ALLOCATION_REPORT',
  'BASIS_OF_ALLOTMENT_AD',
  'RATIOS_BASIS_ISSUE_PRICE',
  'BIDDING_CENTERS',
  'SAMPLE_APPLICATION_FORMS',
  'SECURITY_PARAMS_PRE_ANCHOR',
  'SECURITY_PARAMS_POST_ANCHOR',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Where a document link came from. Ordered by the matrix §1 decision tree. */
export const DOC_SOURCES = ['BSE', 'NSE', 'SEBI', 'COMPANY', 'VERIFIER'] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

/**
 * Types that SUPERSEDE an earlier filing for the fields they carry
 * (matrix §7.1 / lifecycle-plan E2). A newer document of one of these types
 * marks the earlier row SUPERSEDED — ordered by `filing_date`, never by fetch
 * order (E1/E8).
 */
export const SUPERSEDING_TYPES: readonly DocumentType[] = [
  'PROSPECTUS',
  'CORRIGENDUM',
  'ADDENDUM',
];

/**
 * Precedence for "which filing wins for a field it carries"
 * (lifecycle-plan header: Prospectus > RHP + Corrigendum + Addenda + PBA > DRHP).
 * Higher number wins. Consumed by supersession and, later, by WP C's resolver.
 */
export const DOCUMENT_PRECEDENCE: Record<DocumentType, number> = {
  PROSPECTUS: 100,
  BASIS_OF_ALLOTMENT_AD: 90,
  CORRIGENDUM: 80,
  ADDENDUM: 75,
  PRICE_BAND_AD: 70,
  ANCHOR_ALLOCATION_REPORT: 60,
  RHP: 50,
  RATIOS_BASIS_ISSUE_PRICE: 40,
  SECURITY_PARAMS_POST_ANCHOR: 30,
  SECURITY_PARAMS_PRE_ANCHOR: 25,
  BIDDING_CENTERS: 20,
  SAMPLE_APPLICATION_FORMS: 15,
  DRHP: 10,
};

/** True when `value` is one of the tracked document types. */
export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}
