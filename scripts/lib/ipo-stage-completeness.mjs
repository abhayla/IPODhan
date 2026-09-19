// SSOT for "what 100% means" per IPO lifecycle stage (Stage A of the
// 2026-06-19 foolproof-pipeline contract). PURE: no DB, no IO, no clock.
//
// The real-world IPO data lifecycle (validated with the IPO-domain expert role):
//   UPCOMING (DRHP filed) -> PRE_OPEN (RHP+anchor filed) -> OPEN -> CLOSED -> LISTED
// Each later stage's "due" field set is CUMULATIVE of all earlier stages.
//
// `audit-ipo-coverage.mjs --gate` imports this to run a per-IPO, stage-aware
// completeness check: for each genuine IPO, derive its stage, compute the due
// field set, and report which stage-due fields are missing. A field is presence-
// judged with SUBSTANCE awareness (e.g. issue_size must be > 0, not merely
// non-null) so the gate never reports a domain-absurd value as "covered".
//
// Pass/fail policy (contract §2 + decision #9):
//   - GO-FORWARD rows (created on/after the pipeline activation date) MUST have
//     every required stage-due field populated or a logged deferral -> else FAIL.
//   - HISTORICAL rows (pre-activation) are best-effort: missing fields are a
//     dashboard gap, not a hard fail (an unreachable historical doc auto-defers).
//   The activation date is supplied by the caller (env PIPELINE_ACTIVATION_DATE);
//   when unset there are no go-forward rows yet (pipeline activation is §GATE).

export const STAGES = ['UPCOMING', 'PRE_OPEN', 'OPEN', 'CLOSED', 'LISTED'];

// Field descriptors. `sql` is a boolean SQL fragment evaluated per IPO row aliased
// `i` (the audit builds one query from these). `severity`:
//   'required'    -> a missing value FAILS a go-forward row.
//   'best_effort' -> always dashboard-only (genuinely optional / segment-dependent:
//                    GMP is unofficial hearsay; demand is mainboard-only; anchor may
//                    be absent for small SME issues).
export const FIELDS = {
  // --- UPCOMING / DRHP-filed: the company's own filing data ---
  company_description: {
    label: 'Company description', severity: 'required',
    sql: `(i.company_description IS NOT NULL AND i.company_description <> '' OR EXISTS(SELECT 1 FROM ipo_details d WHERE d.ipo_id=i.id AND d.company_description IS NOT NULL AND d.company_description <> ''))`,
  },
  sector: { label: 'Sector', severity: 'required', sql: `(i.sector IS NOT NULL AND i.sector <> '')` },
  financials: { label: 'Financials', severity: 'required', sql: `EXISTS(SELECT 1 FROM financial_data f WHERE f.ipo_id=i.id)` },
  objectives: {
    label: 'Objects of the issue', severity: 'required',
    sql: `(i.objectives IS NOT NULL AND i.objectives::text NOT IN ('[]','null','{}',''))`,
  },
  peers: { label: 'Peer comparison', severity: 'required', sql: `EXISTS(SELECT 1 FROM peer_companies p WHERE p.ipo_id=i.id)` },
  promoter_holding: {
    label: 'Promoter holding', severity: 'best_effort',
    sql: `EXISTS(SELECT 1 FROM financial_data f WHERE f.ipo_id=i.id AND (f.promoter_holding_pre_issue IS NOT NULL OR f.promoter_holding_post_issue IS NOT NULL))`,
  },

  // --- PRE_OPEN / RHP+anchor-filed: issue terms ---
  price_band: { label: 'Price band', severity: 'required', sql: `(i.price_range_min IS NOT NULL AND i.price_range_min > 0)` },
  lot_size: { label: 'Lot size', severity: 'required', sql: `(i.lot_size IS NOT NULL AND i.lot_size > 0)` },
  open_date: { label: 'Open date', severity: 'required', sql: `i.open_date IS NOT NULL` },
  close_date: { label: 'Close date', severity: 'required', sql: `i.close_date IS NOT NULL` },
  issue_size: { label: 'Issue size', severity: 'required', sql: `(i.issue_size IS NOT NULL AND i.issue_size > 0)` },
  registrar: { label: 'Registrar', severity: 'required', sql: `(i.registrar IS NOT NULL AND i.registrar <> '')` },
  lead_managers: {
    label: 'Lead managers', severity: 'required',
    sql: `(i.lead_managers IS NOT NULL OR EXISTS(SELECT 1 FROM ipo_details d WHERE d.ipo_id=i.id AND d.lead_managers IS NOT NULL))`,
  },
  anchor: { label: 'Anchor investors', severity: 'best_effort', sql: `EXISTS(SELECT 1 FROM anchor_investors a WHERE a.ipo_id=i.id)` },

  // --- OPEN: live data ---
  subscription: {
    label: 'Subscription', severity: 'required',
    sql: `(i.subscription_total IS NOT NULL OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.ipo_id=i.id))`,
  },
  demand: { label: 'Demand graph', severity: 'best_effort', sql: `EXISTS(SELECT 1 FROM ipo_demand_graph g WHERE g.ipo_id=i.id)` },
  gmp: { label: 'GMP (unofficial)', severity: 'best_effort', sql: `(i.gmp IS NOT NULL OR EXISTS(SELECT 1 FROM gmp_records r WHERE r.ipo_id=i.id))` },

  // --- CLOSED: post-close, pre-listing ---
  allotment_date: { label: 'Allotment date', severity: 'required', sql: `i.allotment_date IS NOT NULL` },

  // --- LISTED ---
  listing_date: { label: 'Listing date', severity: 'required', sql: `i.listing_date IS NOT NULL` },
  listing_performance: {
    label: 'Listing price/gain', severity: 'required',
    sql: `(i.listing_price_historical IS NOT NULL OR EXISTS(SELECT 1 FROM listing_performance lp WHERE lp.ipo_id=i.id))`,
  },
};

// Stage -> the field keys that BECOME due at that stage (non-cumulative).
export const STAGE_DUE_FIELDS = {
  UPCOMING: ['company_description', 'sector', 'financials', 'objectives', 'peers', 'promoter_holding'],
  PRE_OPEN: ['price_band', 'lot_size', 'open_date', 'close_date', 'issue_size', 'registrar', 'lead_managers', 'anchor'],
  OPEN: ['subscription', 'demand', 'gmp'],
  CLOSED: ['allotment_date'],
  LISTED: ['listing_date', 'listing_performance'],
};

// Cumulative due-field keys for a stage (this stage + all earlier stages).
export function dueFieldKeysForStage(stage) {
  const idx = STAGES.indexOf(stage);
  if (idx < 0) throw new Error(`unknown stage: ${stage}`);
  const keys = [];
  for (let i = 0; i <= idx; i++) keys.push(...STAGE_DUE_FIELDS[STAGES[i]]);
  return keys;
}

// Item 24 (#795): see deriveLifecycleStage in
// scraper/src/scheduler/stage-reconciler.ts for the full reasoning. N = 7 days,
// from the 17 IPOs we knew about at least two days before their band was
// recorded (median 4, p90 5.8, max 7); the upper end is taken deliberately
// because 29% had the band recorded 0-1 days before open.
export const PRE_OPEN_WINDOW_DAYS = 7;

// Only an IPO ever files a price band advertisement — measured 21 of 21. Every
// other offering type stores min = max, a single fixed price.
export const BAND_BEARING_OFFERING_TYPES = ['IPO'];

export function isBandBearingOfferingType(offeringType) {
  const t = String(offeringType ?? 'IPO').trim().toUpperCase();
  return BAND_BEARING_OFFERING_TYPES.includes(t === '' ? 'IPO' : t);
}

// Derive an IPO's lifecycle stage from its status and the signals that say it is
// about to open.
//
// Item 24 (#795) — THE RULE: a promotion condition must depend only on facts our
// own pipeline cannot suppress, never on an output of the work it gates. The old
// rule promoted UPCOMING -> PRE_OPEN only on a price band already being present,
// but PRICE_BAND_AD (the document that SUPPLIES the band) is first due at
// PRE_OPEN — so no band meant the ad was never fetched, which meant no band.
//
// This function is the SECOND implementation of the rule; the first is
// `deriveLifecycleStage` in scraper/src/scheduler/stage-reconciler.ts. The two
// are pinned together by the parity test in
// scraper/tests/unit/scheduler/stage-gate-deadlock.test.ts. Change both or
// neither.
export function deriveStage(row, opts = {}) {
  const status = String(row.status || '').toUpperCase();
  if (status === 'LISTED') return 'LISTED';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'OPEN') return 'OPEN';
  if (status !== 'UPCOMING') return 'UPCOMING';

  // An issue that can never file a price band ad is never sent hunting one.
  if (!isBandBearingOfferingType(row.offering_type)) return 'UPCOMING';

  const today = opts.today ?? new Date();

  // Signal 1 — the issue opens soon (null-safe: an absent or unparseable
  // open_date is "no signal", never 0).
  const raw = row.open_date;
  let days = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      days = Math.floor((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    }
  }
  if (days !== null && days <= PRE_OPEN_WINDOW_DAYS) return 'PRE_OPEN';

  // Signal 2 — an RHP is already on file.
  if (row.has_rhp_on_file === true) return 'PRE_OPEN';

  // Signal 3 — the band is already present. Kept for continuity; no longer the
  // trigger.
  const min = row.price_range_min;
  if (min !== null && min !== undefined && Number(min) > 0) return 'PRE_OPEN';

  // A row with NO usable signal at all must be VISIBLE, not silently stalled —
  // silent stalling is the bug this change removes. A known-far-off open_date is
  // resolved, not unresolved.
  if (days === null && typeof opts.onUnresolved === 'function') {
    opts.onUnresolved({
      id: row.id,
      companyName: row.company_name,
      reason:
        'UPCOMING with no promotion signal: no open_date, no RHP on file, no price band — stage cannot advance, so no pre-open document will ever become due',
    });
  }

  return 'UPCOMING';
}

// Given a per-IPO presence map { fieldKey: boolean }, return the missing due
// fields for the IPO's stage, split by severity.
//   presence: { [fieldKey]: boolean }
//   returns { stage, missingRequired: [keys], missingBestEffort: [keys], dueCount, presentCount }
export function computeStageGaps(row, presence) {
  const stage = deriveStage(row);
  const due = dueFieldKeysForStage(stage);
  const missingRequired = [];
  const missingBestEffort = [];
  let presentCount = 0;
  for (const key of due) {
    const present = presence[key] === true;
    if (present) { presentCount++; continue; }
    if (FIELDS[key].severity === 'best_effort') missingBestEffort.push(key);
    else missingRequired.push(key);
  }
  return { stage, due, missingRequired, missingBestEffort, dueCount: due.length, presentCount };
}
