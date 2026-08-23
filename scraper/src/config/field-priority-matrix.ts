/**
 * Field Priority Matrix
 * Defines which scraper source has priority for each field
 * Used by data consolidation service to resolve conflicts intelligently
 */

import { FINANCIAL_FIELD_BOUNDS } from '../scrapers/chittorgarh-detail-fields.js';

export type ScraperSource =
  | 'ADMIN'           // Manual admin overrides (highest priority)
  | 'DRHP'            // Official regulatory documents
  | 'NSE'             // NSE official scraper
  | 'BSE'             // BSE official scraper
  | 'MONEYCONTROL'    // Moneycontrol scraper
  | 'CHITTORGARH'     // Chittorgarh GMP scraper
  | 'INVESTORGAIN_GMP'// InvestorGain GMP scraper
  | 'API_FALLBACK';   // Fallback API scraper

export type NormalizationType =
  | 'currency'           // Indian currency formats (₹500 Cr, 500 Crores, etc.)
  | 'date'               // Date formats (DD-MM-YYYY, DD/MM/YYYY, etc.)
  | 'company_name'       // Company name variations (Ltd, Limited, Pvt, etc.)
  | 'percentage'         // Percentage formats (85%, 85, 0.85)
  | 'number'             // Plain numbers
  | 'none';              // No normalization

export interface FieldRules {
  /**
   * Priority order of sources (first = highest priority)
   * ADMIN always wins if present
   */
  sources: ScraperSource[];

  /**
   * Normalization type to apply before comparison
   */
  normalization?: NormalizationType;

  /**
   * Minimum confidence threshold (0-100)
   * Reject data below this confidence
   */
  confidenceThreshold?: number;

  /**
   * Time-based priority
   * If true, newest data wins regardless of source
   */
  timeBased?: boolean;

  /**
   * Allow a NEWER value from the SAME source to replace the stored value.
   *
   * T-276: a same-source conflict on a non-`timeBased` field previously
   * resolved to `DEFAULT_KEEP_EXISTING`, so once a wrong value landed the
   * source could never correct itself - production logged
   * `NSE 360 vs NSE 342 -> DEFAULT_KEEP_EXISTING` on `priceRangeMin` every
   * cycle for two days while NSE published the right band.
   *
   * Unlike `timeBased` (newest wins REGARDLESS of source), this only applies
   * when both values came from the SAME source AND the matrix lists that
   * source as authoritative for the field (`sources.indexOf(source) !== -1`).
   * Cross-source priority is untouched.
   */
  sameSourceRefresh?: boolean;

  /**
   * T-278 P3-7 (GitHub #165 F1): bounds WHICH sources may exercise
   * `sameSourceRefresh`. Without this, `allowsSameSourceRefresh()` treated
   * every source in `sources` as equally "authoritative" for self-refresh —
   * so a low-priority fallback source (e.g. MONEYCONTROL, listed only as a
   * last-resort) could silently overwrite a value another source had
   * already corrected, since a same-source match skips the cross-source
   * priority contest entirely. When set, ONLY these sources may self-refresh;
   * when omitted, falls back to the full `sources` list (existing behavior)
   * for any other field that opts into `sameSourceRefresh` in the future.
   */
  sameSourceRefreshSources?: ScraperSource[];

  /**
   * Ignore DRHP for this field (for real-time data)
   */
  ignoreDRHP?: boolean;

  /**
   * Validation rules
   */
  validation?: {
    min?: number;
    max?: number;
    regex?: string;
    allowNull?: boolean;
  };

  /**
   * Description for documentation
   */
  description?: string;
}

/**
 * Field Priority Matrix
 *
 * **How to read this**:
 * - sources: [A, B, C] means A wins over B, B wins over C
 * - ADMIN is implicit highest priority (always wins)
 * - timeBased: true means newest data wins
 * - ignoreDRHP: true means DRHP is not used for this field
 *
 * **Priority Principles**:
 * 1. Admin always wins (manual override)
 * 2. DRHP is authoritative for financial data
 * 3. NSE is primary for IPO core data
 * 4. BSE is better for lot size
 * 5. Chittorgarh specializes in GMP data
 * 6. Real-time data uses latest value
 */
export const FIELD_PRIORITY_MATRIX: Record<string, FieldRules> = {
  // ==================== FINANCIAL DATA (DRHP is authoritative) ====================

  revenue_fy1: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 1 - DRHP is most accurate',
  },

  revenue_fy2: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 2',
  },

  revenue_fy3: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 3',
  },

  profit_fy1: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 1',
  },

  profit_fy2: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 2',
  },

  profit_fy3: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 3',
  },

  // Specific fiscal year fields (camelCase - actual database fields)
  revenueFy2022: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2022 - DRHP is most accurate',
  },

  revenueFy2023: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2023 - DRHP is most accurate',
  },

  revenueFy2024: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2024 - DRHP is most accurate',
  },

  profitFy2022: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2022 - DRHP is most accurate',
  },

  profitFy2023: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2023 - DRHP is most accurate',
  },

  profitFy2024: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2024 - DRHP is most accurate',
  },

  // ==================== C3b: Chittorgarh detail-page financials/peers/objectives ====================
  // Live source for these is the per-IPO Chittorgarh detail page. Validation bounds reference
  // FINANCIAL_FIELD_BOUNDS so the extraction gate and conflict-resolution never drift (one SSOT).
  ebitdaFy2022: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'EBITDA FY2022 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.ebitda } },
  ebitdaFy2023: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'EBITDA FY2023 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.ebitda } },
  ebitdaFy2024: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'EBITDA FY2024 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.ebitda } },
  totalIncomeFy2022: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Total Income FY2022 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.totalIncome } },
  totalIncomeFy2023: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Total Income FY2023 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.totalIncome } },
  totalIncomeFy2024: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Total Income FY2024 (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.totalIncome } },
  netWorth: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Net worth — most recent reported (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.netWorth } },
  reservesAndSurplus: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Reserves and surplus — most recent reported (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.reservesAndSurplus } },
  totalAssets: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Total assets — most recent reported (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.totalAssets } },
  totalBorrowing: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Total borrowing — most recent reported (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.totalBorrowing } },
  eps: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'number', confidenceThreshold: 85, description: 'Earnings per share (post-issue ₹)', validation: { ...FINANCIAL_FIELD_BOUNDS.eps } },
  preIpoEps: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'number', confidenceThreshold: 85, description: 'Pre-IPO EPS (₹)', validation: { ...FINANCIAL_FIELD_BOUNDS.eps } },
  postIpoEps: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'number', confidenceThreshold: 85, description: 'Post-IPO EPS (₹)', validation: { ...FINANCIAL_FIELD_BOUNDS.eps } },
  peRatio: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'number', confidenceThreshold: 85, description: 'Price-to-Earnings ratio (post-issue)', validation: { ...FINANCIAL_FIELD_BOUNDS.peRatio } },
  roe: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'percentage', confidenceThreshold: 85, description: 'Return on Equity (%)', validation: { ...FINANCIAL_FIELD_BOUNDS.roe } },
  ronw: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'percentage', confidenceThreshold: 85, description: 'Return on Net Worth (%)', validation: { ...FINANCIAL_FIELD_BOUNDS.ronw } },
  debtToEquity: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'number', confidenceThreshold: 85, description: 'Debt-to-Equity ratio', validation: { ...FINANCIAL_FIELD_BOUNDS.debtToEquity } },
  promoterHoldingPreIssue: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'percentage', confidenceThreshold: 85, description: 'Promoter holding pre-issue (%)', validation: { ...FINANCIAL_FIELD_BOUNDS.promoterHolding } },
  promoterHoldingPostIssue: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'percentage', confidenceThreshold: 85, description: 'Promoter holding post-issue (%)', validation: { ...FINANCIAL_FIELD_BOUNDS.promoterHolding } },
  marketCap: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'NSE', 'BSE', 'MONEYCONTROL'], normalization: 'currency', confidenceThreshold: 85, description: 'Market capitalization (₹ Cr)', validation: { ...FINANCIAL_FIELD_BOUNDS.marketCap } },
  peer_companies: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'MONEYCONTROL'], normalization: 'none', confidenceThreshold: 80, description: 'Peer-comparison payload (one-to-many) from the detail page peer table' },
  objectives: { sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'MONEYCONTROL'], normalization: 'none', confidenceThreshold: 80, description: 'Objects-of-issue payload (ipos.objectives jsonb) from the detail page' },

  pe_ratio: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Price-to-Earnings ratio',
    validation: { min: 0, max: 1000 },
  },

  roe_percentage: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    confidenceThreshold: 75,
    description: 'Return on Equity percentage',
    validation: { min: -100, max: 500 },
  },

  roce_percentage: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    confidenceThreshold: 75,
    description: 'Return on Capital Employed',
    validation: { min: -100, max: 500 },
  },

  pb_ratio: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Price-to-Book ratio',
    validation: { min: 0, max: 100 },
  },

  debt_to_equity: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Debt-to-Equity ratio',
    validation: { min: 0, max: 50 },
  },

  // ==================== IPO CORE DATA (NSE is primary) ====================

  issue_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Total issue size - NSE is most reliable',
    validation: { min: 1e6, max: 1e12 }, // 1 Cr to 10 Lakh Cr
  },

  fresh_issue_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Fresh issue size',
  },

  offer_for_sale_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Offer for sale size',
  },

  // T-287F2: had NO matrix entry before this fix (checker T-287C2
  // FINDING-hold-rebounded.md) -- an unlisted field falls back to
  // getFieldRules()'s DEFAULT rules (['ADMIN','NSE','BSE','DRHP',
  // 'MONEYCONTROL','CHITTORGARH','API_FALLBACK'], no sameSourceRefresh),
  // which is fine for a same-source-vs-same-source CONFLICT (both values
  // present) but does NOT protect a NULL stored segment: consolidateField()'s
  // Case 1 ("no existing value - accept incoming") fires whenever the
  // existing normalized value is null/undefined and accepts ANY incoming
  // value unconditionally, bypassing source priority entirely. For most
  // fields that is correct (null == genuinely missing data, fill it in). For
  // `segment` on a business-trust (InvIT/REIT) row, NULL is the CORRECT
  // terminal value (schema.ts: "segment ... nullable for RIGHTS/InvITs/
  // REITs") -- not missing data awaiting a fill. This matrix entry alone
  // does NOT close that gap (Case 1 still runs before any matrix rule is
  // consulted); the durable guard for the null-segment-on-a-trust case is
  // field-level protection (markFieldAsManuallyEdited -> filterProtectedFields()
  // filters the field OUT of the update before consolidation ever sees it --
  // see admin-field-protection.md). This entry exists to govern the
  // value-vs-value conflict case (e.g. NSE says MAINBOARD, a stale
  // Moneycontrol scrape says SME) with NSE/BSE (authoritative exchange data)
  // outranking Chittorgarh/Moneycontrol.
  segment: {
    sources: ['ADMIN', 'NSE', 'BSE', 'CHITTORGARH', 'MONEYCONTROL', 'API_FALLBACK'],
    normalization: 'none',
    confidenceThreshold: 70,
    description: 'MAINBOARD/SME exchange segment (null for InvIT/REIT business trusts). NSE/BSE are authoritative.',
  },

  // ==================== DESCRIPTIVE FIELDS (#69) ====================
  // Both were 0/285: no matrix entry meant consolidation silently dropped them.
  // sector: NSE reads it (nse-api-client.ts:502) but it never reached the DB
  //   without a matrix entry; carried through now (data-persister maps it).
  //   Fixing sector also feeds peer-companies-scraper (sector -> peers cascade).
  // company_description: DRHP "Our Business" or Chittorgarh "About" (id=ipoSummary).
  sector: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'],
    normalization: 'none',
    confidenceThreshold: 80,
    description: 'Industry sector - NSE/exchange classification; feeds peer discovery',
    validation: { regex: '^.{2,100}$' },
  },

  company_description: {
    sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Company business description - DRHP "Our Business" / Chittorgarh "About"',
    validation: { regex: '^.{20,5000}$' },
  },
  // camelCase variant - consolidation service keys on this (data-persister writes
  // `companyDescription`). Without it, getFieldRules('companyDescription') falls
  // through to DEFAULT rules (NSE outranks DRHP, validation skipped). Mirrors the
  // lotSize/allotmentDate dual-key pattern. DRHP-first priority is the intent.
  companyDescription: {
    sources: ['ADMIN', 'DRHP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Company business description (camelCase consolidation key)',
    validation: { regex: '^.{20,5000}$' },
  },

  // ONE naming scheme for the price band: `priceRangeMin`/`priceRangeMax`.
  //
  // T-276 (round-2 P3-4): the matrix used to carry a snake_case
  // `price_band_min`/`price_band_max` twin as well. Nothing ever consolidated
  // under those keys - `data-persister.ts` and
  // `data-consolidation-orchestrator.ts` both build camelCase payloads, and
  // prod `field_sources` contains only `priceRangeMin`/`priceRangeMax`. The
  // dead twin was live ambiguity: `cross-source-disagreement-monitor.ts`
  // filtered `data_conflicts.field_name` on the snake_case names, so the
  // price-band disagreement alert could never fire. Do not reintroduce it -
  // if a caller needs a snake_case key, fix the caller.
  priceRangeMin: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    // T-276: NSE/BSE republish a corrected band mid-issue (an early scrape can
    // see a single price before the band is announced). Without this the
    // correction is discarded as DEFAULT_KEEP_EXISTING - the P1-1 mechanism.
    sameSourceRefresh: true,
    // T-278 P3-7 (#165 F1): only the exchange sources actually "republish a
    // corrected band" the way the T-276 comment above describes — DRHP is a
    // static filing and MONEYCONTROL a lower-priority fallback, neither
    // should be able to self-refresh past a value NSE/BSE already set.
    sameSourceRefreshSources: ['NSE', 'BSE'],
    description: 'Minimum price in price band',
    validation: { min: 1, max: 100000 },
  },

  priceRangeMax: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    sameSourceRefresh: true,
    sameSourceRefreshSources: ['NSE', 'BSE'],
    description: 'Maximum price in price band',
    validation: { min: 1, max: 100000 },
  },

  issue_price: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 95,
    description: 'Final issue price - critical field',
    validation: { min: 1, max: 100000 },
  },

  open_date: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'IPO open date - critical field',
  },

  close_date: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'IPO close date - critical field',
  },

  listing_date: {
    // CHITTORGARH added (#70): report-25 is the only working post-close listing-date
    // source; without it the stuck-listing backfill's listing_date write is dropped
    // by consolidation on any row that already has a value / on re-run.
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'Expected listing date',
  },

  // camelCase variant - consolidation keys on `listingDate` (data-persister
  // writes it). Without this twin, getFieldRules('listingDate') falls through to
  // DEFAULT rules and the CHITTORGARH registration above is never applied to the
  // #70 stuck-listing backfill. Mirrors the lotSize/allotmentDate dual-key pattern.
  listingDate: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'Listing date (camelCase consolidation key) - CHITTORGARH for #70 backfill',
  },

  // B7: allotment_date was missing — consolidation silently dropped it (allotment_date ~1%).
  // Moneycontrol publishes it most reliably; NSE/BSE as fallbacks.
  allotment_date: {
    sources: ['ADMIN', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'date',
    confidenceThreshold: 90,
    description: 'Basis-of-allotment date - Moneycontrol most reliable',
  },
  // camelCase variant - consolidation service keys on this for some paths
  allotmentDate: {
    sources: ['ADMIN', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'date',
    confidenceThreshold: 90,
    description: 'Basis-of-allotment date (camelCase)',
  },

  // ==================== EXCHANGE IDENTIFIERS (NSE authoritative) ====================
  // B7: isin/symbol were missing from the matrix → consolidation never let any source
  // populate them. NSE is the canonical source for both; ISIN is also on DRHP/BSE.
  isin: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 90,
    description: 'ISIN - International Securities Identification Number (NSE authoritative)',
    validation: { regex: '^IN[A-Z0-9]{10}$', allowNull: true },
  },
  symbol: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 85,
    description: 'Stock ticker symbol - NSE symbol is canonical',
  },

  // ==================== LOT SIZE (BSE is more accurate) ====================

  lot_size: {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    description: 'Lot size - BSE data is more accurate historically',
    validation: { min: 10, max: 100000 },
  },

  // CamelCase (TypeScript field name) - consolidation service uses this
  lotSize: {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    description: 'Lot size (camelCase) - BSE data is more accurate historically',
    validation: { min: 10, max: 100000 },
  },

  min_investment: {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Minimum investment amount',
  },

  // ==================== REAL-TIME DATA (Latest wins) ====================

  status: {
    // CHITTORGARH added (#70): the stuck-listing backfill advances CLOSED->LISTED;
    // without CHITTORGARH registered, consolidation rejects the LISTED write (source
    // priority -1) and the IPO stays CLOSED. Lowest priority — only wins when newer.
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'],
    normalization: 'none',
    timeBased: true,
    ignoreDRHP: true,
    description: 'IPO status - real-time field, newest value wins',
  },

  total_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Total subscription times - real-time data',
    validation: { min: 0, max: 1000 },
  },

  retail_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Retail subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  qib_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'QIB subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  nii_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'NII subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  // ==================== GMP DATA (InvestorGain is the live-GMP specialist) ====================
  // G8: InvestorGain GMP is the real live source; Chittorgarh GMP was abandoned
  // as unscrapeable. timeBased:true means newest-wins regardless, but InvestorGain
  // is ranked first so source-priority tie-breaks favour it over Chittorgarh.

  gmp_price: {
    sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'Grey Market Premium - InvestorGain is specialist',
    validation: { min: -1000, max: 10000 },
  },

  gmp_percentage: {
    sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'percentage',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'GMP percentage - InvestorGain is specialist',
    validation: { min: -100, max: 500 },
  },

  // CamelCase (TypeScript field names) - consolidation service uses these
  gmpPrice: {
    sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'Grey Market Premium (camelCase) - InvestorGain is specialist',
    validation: { min: -1000, max: 10000 },
  },

  gmpPercentageHistorical: {
    sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'percentage',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'GMP Percentage Historical (camelCase) - InvestorGain is specialist',
    validation: { min: -100, max: 500 },
  },

  expected_listing_price: {
    sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Expected listing price (GMP-based)',
  },

  // ==================== COMPANY INFO ====================

  company_name: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'company_name',
    confidenceThreshold: 85,
    description: 'Company name - normalized',
  },

  industry: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Industry/Sector',
  },

  registrar: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 85,
    description: 'Registrar name',
  },

  lead_managers: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 80,
    description: 'Lead manager banks',
  },

  // ==================== LISTING PERFORMANCE ====================

  listing_price: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 95,
    description: 'Actual listing price - critical',
    validation: { min: 1, max: 100000 },
  },

  listing_gain_percentage: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 90,
    description: 'Listing gains percentage',
    validation: { min: -100, max: 1000 },
  },
};

/**
 * Get field rules for a specific field
 * Returns default rules if field not in matrix
 */
export function getFieldRules(fieldName: string): FieldRules {
  return FIELD_PRIORITY_MATRIX[fieldName] || {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Default rules - NSE priority',
  };
}

/**
 * Get source priority index (lower = higher priority)
 * Returns -1 if source not in priority list
 */
export function getSourcePriority(fieldName: string, source: ScraperSource): number {
  const rules = getFieldRules(fieldName);
  return rules.sources.indexOf(source);
}

/**
 * Check if field is time-based (newest wins)
 */
export function isTimeBased(fieldName: string): boolean {
  const rules = getFieldRules(fieldName);
  return rules.timeBased || false;
}

/**
 * T-276: may a NEWER value from `source` replace the stored value when BOTH
 * values came from `source`? True only when the field opts in via
 * `sameSourceRefresh` AND the matrix lists `source` as authoritative for it,
 * so an unlisted source (priority -1) can never self-refresh.
 */
export function allowsSameSourceRefresh(fieldName: string, source: ScraperSource): boolean {
  const rules = getFieldRules(fieldName);
  if (!rules.sameSourceRefresh) return false;
  const allowList = rules.sameSourceRefreshSources ?? rules.sources;
  return allowList.indexOf(source) !== -1;
}

/**
 * Check if field ignores DRHP data
 */
export function ignoresDRHP(fieldName: string): boolean {
  const rules = getFieldRules(fieldName);
  return rules.ignoreDRHP || false;
}

/**
 * Get all field names with rules
 */
export function getAllTrackedFields(): string[] {
  return Object.keys(FIELD_PRIORITY_MATRIX);
}

/**
 * Get fields by normalization type
 */
export function getFieldsByNormalization(type: NormalizationType): string[] {
  return Object.entries(FIELD_PRIORITY_MATRIX)
    .filter(([_, rules]) => rules.normalization === type)
    .map(([fieldName]) => fieldName);
}

/**
 * Export summary for documentation
 */
export function generatePriorityMatrixSummary(): string {
  const lines = ['# Field Priority Matrix Summary\n'];

  const grouped: Record<string, string[]> = {
    'Financial Data (DRHP Priority)': [],
    'IPO Core Data (NSE Priority)': [],
    'Real-Time Data (Latest Wins)': [],
    'GMP Data (Chittorgarh Priority)': [],
    'Other Fields': [],
  };

  for (const [field, rules] of Object.entries(FIELD_PRIORITY_MATRIX)) {
    const topSource = rules.sources[0];
    const line = `- **${field}**: ${rules.sources.join(' > ')} ${rules.timeBased ? '(time-based)' : ''}`;

    if (topSource === 'DRHP' || field.includes('revenue') || field.includes('profit')) {
      grouped['Financial Data (DRHP Priority)'].push(line);
    } else if (rules.timeBased) {
      grouped['Real-Time Data (Latest Wins)'].push(line);
    } else if (topSource === 'CHITTORGARH' || field.includes('gmp')) {
      grouped['GMP Data (Chittorgarh Priority)'].push(line);
    } else if (topSource === 'NSE') {
      grouped['IPO Core Data (NSE Priority)'].push(line);
    } else {
      grouped['Other Fields'].push(line);
    }
  }

  for (const [category, fields] of Object.entries(grouped)) {
    if (fields.length > 0) {
      lines.push(`\n## ${category}\n`);
      lines.push(fields.join('\n'));
    }
  }

  return lines.join('\n');
}
