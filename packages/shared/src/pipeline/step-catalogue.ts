/**
 * Per-IPO pipeline step catalogue (S-01).
 *
 * Single source of truth for the step ids written to `ipo_pipeline_steps.step_id`.
 * Ids and labels come from the DEEPA walk ledger section 1
 * (docs/walks/2026-09-02-deepa-pipeline-walk.md) and the spec section 3
 * (docs/specs/per-ipo-due-step-pipeline.md).
 *
 * The order of `PIPELINE_STEPS` is the catalogue order the reconciler executes in.
 */

export type PipelineStepGroup = 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

export interface PipelineStepDefinition {
  id: string;
  group: PipelineStepGroup;
  label: string;
}

export const PIPELINE_STEP_GROUP_LABELS: Record<PipelineStepGroup, string> = {
  B: 'Discover',
  C: 'Find filings',
  D: 'Download / store',
  E: 'Extract',
  F: 'Cross-verify',
  G: 'Persist',
  H: 'Live numbers',
  I: 'Lifecycle',
  J: 'Show',
};

export const PIPELINE_STEPS: readonly PipelineStepDefinition[] = [
  // B — Discover
  { id: 'B1', group: 'B', label: 'Fetch BSE IPO board JSON' },
  { id: 'B2', group: 'B', label: 'Fetch NSE current + all-upcoming lists' },
  { id: 'B3', group: 'B', label: 'Parse candidate row (exchange fields)' },
  { id: 'B4', group: 'B', label: 'Classify offering type' },
  { id: 'B5', group: 'B', label: 'Validate raw record' },
  { id: 'B6', group: 'B', label: 'Identity match new vs existing' },
  { id: 'B7', group: 'B', label: 'Write through upsertIPO (update + insert paths)' },

  // C — Find filings
  { id: 'C1', group: 'C', label: 'Find filing links on BSE detail page' },
  { id: 'C2', group: 'C', label: 'Find filing links on NSE detail page' },
  { id: 'C3', group: 'C', label: 'Find filing on SEBI filings site' },
  { id: 'C4', group: 'C', label: 'Fallback filing source (aggregator link)' },
  { id: 'C5', group: 'C', label: 'Classify filing type (DRHP / RHP / PBA / corrigendum / prospectus)' },

  // D — Download / store
  { id: 'D1', group: 'D', label: 'Download document' },
  { id: 'D2', group: 'D', label: 'Reject HTML / non-PDF payload' },
  { id: 'D3', group: 'D', label: 'sha256 dedup against stored documents' },
  { id: 'D4', group: 'D', label: 'Store document + metadata' },
  { id: 'D5', group: 'D', label: 'Zero-call re-run (already-stored short circuit)' },
  { id: 'D6', group: 'D', label: 'Route scanned document to OCR' },

  // E — Extract (ids from price-band-ad-field-inventory.md)
  { id: 'E1', group: 'E', label: 'Extract terms + timeline (inventory groups A+B)' },
  { id: 'E2', group: 'E', label: 'Extract category reservation percentages' },
  { id: 'E3', group: 'E', label: 'Extract financials + fiscal years' },
  { id: 'E4', group: 'E', label: 'Extract KPIs' },
  { id: 'E5', group: 'E', label: 'Extract objects of the issue' },
  { id: 'E6', group: 'E', label: 'Extract peer comparison' },
  { id: 'E7', group: 'E', label: 'Extract promoters + intermediaries' },
  { id: 'E8', group: 'E', label: 'Extract risk factors + litigation' },
  { id: 'E9', group: 'E', label: 'Arithmetic checks on extracted values' },
  { id: 'E10', group: 'E', label: 'Detect unresolved `[•]` placeholders' },

  // F — Cross-verify
  { id: 'F1', group: 'F', label: 'Cross-verify against Chittorgarh' },
  { id: 'F2', group: 'F', label: 'Cross-verify against Moneycontrol' },
  { id: 'F3', group: 'F', label: 'Cross-verify against InvestorGain' },
  { id: 'F4', group: 'F', label: 'Compare static fields across tiers' },
  { id: 'F5', group: 'F', label: 'Write data_conflicts rows for mismatches' },
  { id: 'F6', group: 'F', label: 'Write field_sources confidence' },

  // G — Persist
  { id: 'G1', group: 'G', label: 'Persist via field-priority matrix' },
  { id: 'G2', group: 'G', label: 'Honour admin field locks' },
  { id: 'G3', group: 'G', label: 'Write through upsertIPO' },
  { id: 'G4', group: 'G', label: 'Write extracted child tables' },
  { id: 'G5', group: 'G', label: 'Write new columns (W-09 inventory)' },

  // H — Live numbers
  { id: 'H1', group: 'H', label: 'Subscription figures' },
  { id: 'H2', group: 'H', label: 'GMP' },
  { id: 'H3', group: 'H', label: 'Anchor allocation (T-1 anchor)' },
  { id: 'H4', group: 'H', label: 'Category demand graph' },

  // I — Lifecycle
  { id: 'I1', group: 'I', label: 'Derive lifecycle stage' },
  { id: 'I2', group: 'I', label: 'Compute due-step list' },
  { id: 'I3', group: 'I', label: 'Handle filing supersession' },
  { id: 'I4', group: 'I', label: 'Detect withdrawn / deferred issues' },
  { id: 'I5', group: 'I', label: 'Record listing outcome' },
  { id: 'I6', group: 'I', label: 'Purge / stop fetching after close+7d' },

  // J — Show
  { id: 'J1', group: 'J', label: 'Invalidate caches for the slug' },
  { id: 'J2', group: 'J', label: 'Render public IPO page' },
  { id: 'J3', group: 'J', label: 'Admin conflict view' },
] as const;

export const PIPELINE_STEP_IDS: readonly string[] = PIPELINE_STEPS.map((s) => s.id);

const STEP_BY_ID = new Map(PIPELINE_STEPS.map((s) => [s.id, s]));

export function isPipelineStepId(id: string): boolean {
  return STEP_BY_ID.has(id);
}

export function getPipelineStep(id: string): PipelineStepDefinition | undefined {
  return STEP_BY_ID.get(id);
}

export function getPipelineStepsByGroup(): Array<{
  group: PipelineStepGroup;
  label: string;
  steps: PipelineStepDefinition[];
}> {
  const groups: PipelineStepGroup[] = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  return groups.map((group) => ({
    group,
    label: PIPELINE_STEP_GROUP_LABELS[group],
    steps: PIPELINE_STEPS.filter((s) => s.group === group),
  }));
}
