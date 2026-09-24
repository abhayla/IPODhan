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

import { readFileSync } from 'node:fs';

/**
 * Item 6: the precedence table lives in ONE config file,
 * scraper/config/document-precedence.json, so the PULL-FROZEN audit check
 * (scripts/lib/pull-frozen-checks.mjs) reads the same numbers instead of a
 * hand copy.
 */
const DOCUMENT_PRECEDENCE_CONFIG = JSON.parse(
  readFileSync(new URL('../../config/document-precedence.json', import.meta.url), 'utf8')
) as { precedence: Record<string, number>; nonReopeningTypes: string[] };

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
export const DOCUMENT_PRECEDENCE: Record<DocumentType, number> = DOCUMENT_PRECEDENCE_CONFIG.precedence as Record<
  DocumentType,
  number
>;


/** True when `value` is one of the tracked document types. */
export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The `document_type` enum values that existed BEFORE migration 0035 (T-403 M5).
 *
 * The classifier fix is NOT behind `ENABLE_DOCUMENT_STATE_MACHINE`: it lives in
 * `primary-source-discovery.ts`, which the flag-OFF legacy backfill path also
 * calls. So the legacy path could emit `CORRIGENDUM` / `PRICE_BAND_AD` /
 * `BASIS_OF_ALLOTMENT_AD` into a database where the enum does not yet have them,
 * and the insert would fail at runtime.
 *
 * `deploy-linux.sh` migrates before it flips traffic, and
 * `assert-migrations-applied.sh` blocks the deploy on any gap, so in practice the
 * enum is always present first. This list plus `toPre0035DocumentType` make that
 * a guarantee rather than an ordering assumption.
 */
export const PRE_0035_DOCUMENT_TYPES: readonly string[] = [
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'BASIS_OF_ALLOTMENT',
  'ADDENDUM',
  'RATIOS_BASIS_ISSUE_PRICE',
  'BIDDING_CENTERS',
  'SAMPLE_APPLICATION_FORMS',
  'SECURITY_PARAMS_PRE_ANCHOR',
  'SECURITY_PARAMS_POST_ANCHOR',
  'ANCHOR_ALLOCATION_REPORT',
  'ASBA_PROCESSING_CIRCULAR',
];

/**
 * Map a post-0035 type down to the value the pre-0035 enum would have held.
 *
 * Used ONLY by the legacy backfill path, so it cannot insert a value the
 * database may not know. It deliberately reproduces the OLD, less precise
 * behaviour (a corrigendum and a price-band ad both became ADDENDUM) — the
 * legacy path is being replaced, and not crashing matters more there than
 * being precise. The state-machine path always uses the true type.
 */
export function toPre0035DocumentType(type: DocumentType): string {
  switch (type) {
    case 'CORRIGENDUM':
    case 'PRICE_BAND_AD':
      return 'ADDENDUM';
    case 'BASIS_OF_ALLOTMENT_AD':
      return 'BASIS_OF_ALLOTMENT';
    default:
      return type;
  }
}
/**
 * Document types the EXCHANGES actually host (T-403 B-1).
 *
 * Everything except the DRHP. Neither BSE nor NSE publishes a draft prospectus:
 * a company's DRHP sits with SEBI for months before an exchange has any listing
 * for it at all (decision-matrix §2, row S0 — "BSE/NSE do not host DRHPs before
 * the RHP").
 *
 * This is load-bearing, not documentation. The first cut escalated to SEBI only
 * when the exchanges FAILED, and an exchange that answers cleanly with no DRHP
 * link is not a failure — it is `no_link`. So the DRHP settled as NOT_YET_FILED
 * on every cycle forever and the SEBI rung, whose whole reason for existing is
 * the DRHP, could never fire. `no_link` may only settle a type the exchanges can
 * actually serve.
 */
export const EXCHANGE_SERVED_TYPES: readonly DocumentType[] = DOCUMENT_TYPES.filter(
  (t) => t !== 'DRHP'
);

/** True when an exchange could, in principle, serve this document type. */
export function isExchangeServedType(docType: DocumentType): boolean {
  return EXCHANGE_SERVED_TYPES.includes(docType);
}

/**
 * Item 24 (#795): offering types that can ever file a price band advertisement.
 *
 * Measured on staging 2026-09-19: only `offering_type='IPO'` has ever held a
 * PRICE_BAND_AD, 21 of 21. Every other type stores `min = max` — a single fixed
 * price, never a range (TENDER 16/16, RIGHTS 5/5, NCD 3/3, INVITS 3/3,
 * BUYBACK 1/1, REITS 1/1).
 *
 * Lives in this module — the shared vocabulary both the state machine and the
 * stage reconciler already depend on — so the two cannot drift, and so neither
 * has to import the other (the reconciler already imports from the state
 * machine; the reverse would be a cycle).
 */
export const BAND_BEARING_OFFERING_TYPES: readonly string[] = ['IPO'];

/**
 * True when this offering type can file a price band ad.
 *
 * An ABSENT/blank offering type is treated as 'IPO': every production caller
 * loads `offering_type = 'IPO'` rows only (`CANDIDATE_IPOS_SQL`,
 * `RECONCILER_PRESENCE_SQL`), so absence there means "the IPO filter already
 * ran", not "unknown". The `--ipos` selector harness has no such filter, which
 * is exactly why it must pass the real value through.
 */
export function isBandBearingOfferingType(offeringType?: string | null): boolean {
  const t = String(offeringType ?? 'IPO').trim().toUpperCase();
  return BAND_BEARING_OFFERING_TYPES.includes(t === '' ? 'IPO' : t);
}
