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
  | 'allotment';       // allotment_date

// Stage -> fetches that BECOME due at that stage (non-cumulative).
const STAGE_FETCHES: Record<LifecycleStage, FetchKind[]> = {
  UPCOMING: ['documents', 'financials', 'peers', 'objectives'],
  PRE_OPEN: ['anchor'],
  // P3-2 (T-287): allotment becomes due at OPEN, not CLOSED — source detail
  // pages (Chittorgarh) publish the tentative allotment date while an IPO is
  // still open for subscription (Tempsens shape). CLOSED remains a covered
  // catch-up stage because `dueFetchKindsForStage` is cumulative.
  OPEN: ['subscription', 'demand', 'gmp', 'allotment'],
  CLOSED: [],
  LISTED: ['listing'],
};

/** A minimal IPO row the reconciler reasons over. */
export interface ReconcilerIpoRow {
  id: string;
  companyName: string;
  status: string | null;
  priceRangeMin: number | string | null;
  /** presence[kind] === true when that data is already populated for this IPO. */
  presence: Partial<Record<FetchKind, boolean>>;
}

export interface StagePlan {
  id: string;
  companyName: string;
  stage: LifecycleStage;
  dueFetches: FetchKind[]; // due at-or-before this stage AND currently missing
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
 */
export function planStageReconciliation(rows: ReconcilerIpoRow[]): StagePlan[] {
  return rows.map((row) => {
    const stage = deriveLifecycleStage(row);
    const due = dueFetchKindsForStage(stage).filter((kind) => row.presence[kind] !== true);
    return { id: row.id, companyName: row.companyName, stage, dueFetches: due };
  });
}
