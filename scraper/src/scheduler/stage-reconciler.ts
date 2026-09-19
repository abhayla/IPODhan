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
import { isBandBearingOfferingType } from '../services/document-types.js';
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
  /**
   * Item 24 (#795): open_date (YYYY-MM-DD or ISO). An UPCOMING issue opening
   * within `PRE_OPEN_WINDOW_DAYS` is pre-open whether or not we hold its band —
   * this is the signal the pipeline cannot suppress.
   */
  openDate?: string | Date | null;
  /**
   * Item 24 (#795): true when an RHP is already on file for this issue. A
   * second, weaker pre-open signal for an issue whose open_date is unknown.
   */
  hasRhpOnFile?: boolean;
  /**
   * Item 24 (#795): `ipos.offering_type`. Only an `IPO` ever files a price band
   * advertisement (measured 21 of 21); promoting any other type into PRE_OPEN
   * makes it hunt a document that cannot exist (W-40 churn). Absent = 'IPO',
   * because every caller today loads `offering_type = 'IPO'` rows only.
   */
  offeringType?: string | null;
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
 * Item 24 (#795): how many days before `open_date` an UPCOMING issue is treated
 * as PRE_OPEN.
 *
 * N = 7, from the only honest population available: the 17 IPOs we knew about
 * at least two days before their band was recorded. Its distribution is
 * `0d:2, 1d:3, 2d:3, 4d:4, 5d:3, 7d:2` — median 4, p90 5.8, max 7. The UPPER
 * end is taken deliberately, not the median: 5 of 17 (29%) had the band
 * recorded 0-1 days before open, so a median-sized window promotes too late for
 * nearly a third of issues. Being early costs a few NOT_YET_FILED attempts the
 * state machine already absorbs; being late costs a blank price band on a live
 * IPO. The measurement is of when WE RECORDED the band, not when the issuer
 * FILED it, so it is a LOWER bound on earliness — the true value pushes N up,
 * never down.
 */
export const PRE_OPEN_WINDOW_DAYS = 7;

/** Why an UPCOMING row could not be resolved to a stage on the available signals. */
export interface UnresolvedStageReport {
  id?: string;
  companyName?: string;
  reason: string;
}

export interface DeriveLifecycleStageOptions {
  /** Injected so the window test is deterministic in tests. Defaults to now. */
  today?: Date;
  /**
   * Item 24: called when an UPCOMING row has NO usable promotion signal at all.
   * The final clause of the rule is the point of the fix — an issue that cannot
   * be resolved must be VISIBLE, never silently stalled, because silent
   * stalling is the bug this change removes.
   */
  onUnresolved?: (report: UnresolvedStageReport) => void;
}

/**
 * Days from `today` until `openDate`, or null when the date is absent or
 * unparseable. Null-safe by construction: every caller treats null as
 * "no signal", never as 0.
 */
function daysUntil(openDate: string | Date | null | undefined, today: Date): number | null {
  if (openDate === null || openDate === undefined || openDate === '') return null;
  const d = openDate instanceof Date ? openDate : new Date(openDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Derive an IPO's lifecycle stage from its status and the signals that say it
 * is about to open.
 *
 * Item 24 (#795) — THE RULE THIS IMPLEMENTS: a promotion condition must depend
 * only on facts our own pipeline cannot suppress, never on an output of the
 * work it gates.
 *
 * Before this change, UPCOMING promoted to PRE_OPEN only when a price band was
 * already present. But PRICE_BAND_AD — the document that SUPPLIES the band — is
 * first due at PRE_OPEN. So: no band -> stage stays UPCOMING -> the ad is never
 * due -> the ad is never fetched -> no band. Measured on staging 2026-09-19:
 * 16 of 16 UPCOMING IPOs split perfectly — the 14 with a band held 6
 * document_fetch_state rows each, the 2 without held 1 (DRHP) and zero
 * documents. A gate produces that clean split; a budget problem scatters.
 *
 * The band test is KEPT below: it is harmless and still correct, it is simply
 * no longer the only way in.
 *
 * Mirrored by `deriveStage` in scripts/lib/ipo-stage-completeness.mjs — the two
 * are pinned together by the parity test in
 * scraper/tests/unit/scheduler/stage-gate-deadlock.test.ts. Change both or
 * neither.
 */
export function deriveLifecycleStage(
  row: Pick<
    ReconcilerIpoRow,
    'status' | 'priceRangeMin' | 'openDate' | 'hasRhpOnFile' | 'offeringType'
  > & { id?: string; companyName?: string },
  opts: DeriveLifecycleStageOptions = {}
): LifecycleStage {
  const status = String(row.status || '').toUpperCase();
  if (status === 'LISTED') return 'LISTED';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'OPEN') return 'OPEN';
  if (status !== 'UPCOMING') return 'UPCOMING';

  // An issue that can never file a price band ad is never sent hunting one.
  // Checked FIRST, so no later signal can promote a non-IPO type.
  if (!isBandBearingOfferingType(row.offeringType)) return 'UPCOMING';

  const today = opts.today ?? new Date();

  // Signal 1 — the issue opens soon. The strongest signal, and one the
  // document pipeline cannot suppress: open_date comes from the exchange board.
  const days = daysUntil(row.openDate, today);
  if (days !== null && days <= PRE_OPEN_WINDOW_DAYS) return 'PRE_OPEN';

  // Signal 2 — an RHP is on file. A proxy for pre-open, never the only signal:
  // the RHP is filed at the same stage the band ad is.
  if (row.hasRhpOnFile === true) return 'PRE_OPEN';

  // Signal 3 — the band is already present. Kept for continuity with the
  // pre-item-24 behaviour; harmless, and no longer the trigger.
  const min = row.priceRangeMin;
  if (min !== null && min !== undefined && Number(min) > 0) return 'PRE_OPEN';

  // A KNOWN-far-off issue is resolved, not unresolved: we have its open_date
  // and it simply is not pre-open yet. Only a row with NO usable signal at all
  // is reported.
  if (days === null) {
    opts.onUnresolved?.({
      id: row.id,
      companyName: row.companyName,
      reason:
        'UPCOMING with no promotion signal: no open_date, no RHP on file, no price band — stage cannot advance, so no pre-open document will ever become due',
    });
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
