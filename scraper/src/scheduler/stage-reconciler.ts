/**
 * Stage-transition reconciler (Stage F of the foolproof-pipeline contract) — the
 * self-sustaining "brain". Instead of blindly running every scraper on a timer, it
 * computes each IPO's lifecycle stage and the set of data fetches that are DUE-but-
 * MISSING at that stage, so the scheduler can enqueue exactly the newly-due work as an
 * IPO crosses DRHP→RHP→OPEN→CLOSED→LISTED.
 *
 * This module is the PURE, unit-testable core: `deriveLifecycleStage` +
 * `planStageReconciliation` take plain rows (status + presence flags) and return the
 * plan. The live runner (query the tunnel DB for presence, enqueue/trigger the due
 * jobs, record per-source metrics) is flag-gated (`ENABLE_STAGE_RECONCILER`, default
 * OFF) and its enqueue side is activated only on Abhay's §GATE.
 *
 * The stage model mirrors scripts/lib/ipo-stage-completeness.mjs (the audit measures
 * "what is covered"; this decides "what to fetch") — kept in deliberate lock-step.
 */

import { STAGE_DOCUMENT_TYPES } from '../services/document-state-machine.js';
import type { DocumentType } from '../services/document-types.js';

export type LifecycleStage = 'UPCOMING' | 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'LISTED';
const STAGE_ORDER: LifecycleStage[] = ['UPCOMING', 'PRE_OPEN', 'OPEN', 'CLOSED', 'LISTED'];

/** The data fetches (scraper jobs / writers) keyed by the stage at which they become due. */
export type FetchKind =
  | 'documents'        // DRHP/RHP/anchor discovery (primary-source)
  | 'financials'       // financial_data
  | 'peers'            // peer_companies
  | 'objectives'       // ipos.objectives
  | 'anchor'           // anchor_investors
  | 'subscription'     // subscriptions
  | 'demand'           // ipo_demand_graph
  | 'gmp'              // gmp_records
  | 'listing'          // listing_performance
  | 'allotment'        // allotment_date
  // T-403 WP B: per-DOCUMENT fetch kinds. The pre-existing 'documents' kind is
  // one coarse flag for 'has any document at all', which cannot express 'the RHP
  // is in but the Prospectus is still due' — the distinction the whole state
  // machine turns on. These name each filing so the reconciler and the
  // document-fetch-state machine derive due-ness from the same stage model,
  // rather than two lists drifting apart.
  | 'docDrhp'
  | 'docRhp'
  | 'docPriceBandAd'
  | 'docCorrigendum'
  | 'docAnchorReport'
  | 'docProspectus'
  | 'purgePdfs';       // delete local PDFs, close_date + PROSPECTUS_RETENTION_DAYS (D4)

// Stage -> fetches that BECOME due at that stage (non-cumulative).
/**
 * N6: the DOCUMENT fetch kinds are DERIVED from the state machine's own stage map
 * rather than hand-listed a second time.
 *
 * Two hand-maintained copies of 'which filings are due at which stage' is exactly
 * the class `scraper/src/index.ts`'s STEP_NAMES comment warns about: a type added
 * to one and forgotten in the other produces a reconciler that thinks a document
 * is due while the machine never fetches it, with no error anywhere. The mapping
 * below is the ONLY place the two vocabularies meet, and a document type with no
 * entry here is a compile-time gap rather than a silent one.
 */
export const DOC_TYPE_TO_FETCH_KIND: Partial<Record<DocumentType, FetchKind>> = {
  DRHP: 'docDrhp',
  RHP: 'docRhp',
  PRICE_BAND_AD: 'docPriceBandAd',
  CORRIGENDUM: 'docCorrigendum',
  ANCHOR_ALLOCATION_REPORT: 'docAnchorReport',
  PROSPECTUS: 'docProspectus',
};

/** The document fetch kinds that become due at `stage`, from the ONE stage map. */
function documentKindsAt(stage: LifecycleStage): FetchKind[] {
  return STAGE_DOCUMENT_TYPES[stage]
    .map((t) => DOC_TYPE_TO_FETCH_KIND[t])
    .filter((k): k is FetchKind => k !== undefined);
}

const STAGE_FETCHES: Record<LifecycleStage, FetchKind[]> = {
  UPCOMING: ['documents', 'financials', 'peers', 'objectives', ...documentKindsAt('UPCOMING')],
  PRE_OPEN: ['anchor', ...documentKindsAt('PRE_OPEN')],
  // P3-2 (T-287): allotment becomes due at OPEN, not CLOSED — source detail
  // pages (Chittorgarh) publish the tentative allotment date while an IPO is
  // still open for subscription (Tempsens shape). CLOSED remains a covered
  // catch-up stage because `dueFetchKindsForStage` is cumulative.
  OPEN: ['subscription', 'demand', 'gmp', 'allotment', ...documentKindsAt('OPEN')],
  CLOSED: [...documentKindsAt('CLOSED')],
  // purgePdfs becomes due at LISTED, but only fires once close_date +
  // PROSPECTUS_RETENTION_DAYS has passed — that date test lives in
  // `document-store.isPurgeDue`, which owns the D4 retention rule.
  LISTED: ['listing', 'purgePdfs', ...documentKindsAt('LISTED')],
};

/** A minimal IPO row the reconciler reasons over. */
export interface ReconcilerIpoRow {
  id: string;
  companyName: string;
  status: string | null;
  priceRangeMin: number | string | null;
  /** close_date (YYYY-MM-DD or ISO), used only for the W-127 stale-CLOSED check below. */
  closeDate?: string | null;
  /** listing_date (YYYY-MM-DD or ISO), used only for the W-127 stale-CLOSED check below. */
  listingDate?: string | null;
  /** presence[kind] === true when that data is already populated for this IPO. */
  presence: Partial<Record<FetchKind, boolean>>;
}

export interface StagePlan {
  id: string;
  companyName: string;
  stage: LifecycleStage;
  dueFetches: FetchKind[]; // due at-or-before this stage AND currently missing
  /**
   * W-127: true when this is a CLOSED row whose close_date is older than the
   * staleness window and which has never picked up a listing_date. Its
   * dueFetches is forced to [] — the reconciler stops treating it as a live
   * candidate every cycle — but the row is NOT reclassified (the ipo status
   * enum has no "closed, listing unknown" value; see status-updater-service.ts).
   */
  staleClosed?: boolean;
}

/** Default staleness window (days since close_date) — overridable via STALE_CLOSED_DAYS. */
export const DEFAULT_STALE_CLOSED_DAYS = 30;

/**
 * W-127: a CLOSED IPO whose close_date is older than `staleDays` and which has
 * never received a listing_date is "closed long ago, listing unknown" — the
 * schema has no status for that state (CLOSED/LISTED/WITHDRAWN/POSTPONED all
 * assert something untrue), so the row stays CLOSED but is treated as no
 * longer a live reconciliation candidate (see planStageReconciliation).
 *
 * Pure — no IO, `today` is injected so this is deterministic in tests.
 */
export function isStaleClosedWithoutListing(
  row: Pick<ReconcilerIpoRow, 'status' | 'closeDate' | 'listingDate'>,
  today: Date,
  staleDays: number = DEFAULT_STALE_CLOSED_DAYS
): boolean {
  if (String(row.status || '').toUpperCase() !== 'CLOSED') return false;
  if (row.listingDate) return false; // a listing date means the status updater will advance it
  if (!row.closeDate) return false; // no close_date at all — nothing to measure staleness from
  const close = new Date(row.closeDate);
  if (Number.isNaN(close.getTime())) return false;
  const ageDays = (today.getTime() - close.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays > staleDays;
}

/**
 * Derive an IPO's lifecycle stage from status + whether a real price band (RHP terms)
 * exists. UPCOMING splits: DRHP-only (no band) vs PRE_OPEN (RHP filed → band present).
 * Mirrors deriveStage in scripts/lib/ipo-stage-completeness.mjs.
 */
export function deriveLifecycleStage(row: Pick<ReconcilerIpoRow, 'status' | 'priceRangeMin'>): LifecycleStage {
  const status = String(row.status || '').toUpperCase();
  if (status === 'LISTED') return 'LISTED';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'OPEN') return 'OPEN';
  if (status === 'UPCOMING') {
    const min = row.priceRangeMin;
    const hasBand = min !== null && min !== undefined && Number(min) > 0;
    return hasBand ? 'PRE_OPEN' : 'UPCOMING';
  }
  return 'UPCOMING';
}

/** Cumulative fetch kinds due at-or-before a stage. */
export function dueFetchKindsForStage(stage: LifecycleStage): FetchKind[] {
  const idx = STAGE_ORDER.indexOf(stage);
  const kinds: FetchKind[] = [];
  for (let i = 0; i <= idx; i++) kinds.push(...STAGE_FETCHES[STAGE_ORDER[i]]);
  return kinds;
}

/**
 * For each IPO, compute its stage and the fetches that are due (at-or-before the stage)
 * AND not yet present. This is the work the scheduler would enqueue. Pure — no IO.
 *
 * W-127: a stale CLOSED-without-listing row (see isStaleClosedWithoutListing) is
 * excluded from the due-fetch computation — its dueFetches is forced to [] so it
 * stops being a live reconciliation candidate every cycle — and flagged
 * `staleClosed: true` so the caller can log it for the nightly audit.
 */
export function planStageReconciliation(
  rows: ReconcilerIpoRow[],
  opts: { today?: Date; staleClosedDays?: number } = {}
): StagePlan[] {
  const today = opts.today ?? new Date();
  const staleClosedDays = opts.staleClosedDays ?? DEFAULT_STALE_CLOSED_DAYS;
  return rows.map((row) => {
    const stage = deriveLifecycleStage(row);
    const staleClosed = isStaleClosedWithoutListing(row, today, staleClosedDays);
    const due = staleClosed
      ? []
      : dueFetchKindsForStage(stage).filter((kind) => row.presence[kind] !== true);
    return { id: row.id, companyName: row.companyName, stage, dueFetches: due, staleClosed };
  });
}
