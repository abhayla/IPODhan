/**
 * KPI Calculations Utility
 * Story 11.11: Financial KPI calculation functions
 *
 * All calculations are null-safe and return null if inputs are invalid
 */

/**
 * Calculate market capitalization
 * Formula: Post-IPO shares × Issue price
 *
 * @param postShares - Total shares after IPO
 * @param issuePrice - Issue price per share
 * @returns Market cap in ₹ crores or null
 */
export function calculateMarketCap(
  postShares: number | null,
  issuePrice: number | null
): number | null {
  if (postShares === null || issuePrice === null || postShares <= 0 || issuePrice <= 0) {
    return null;
  }
  // Convert to crores (shares in lakhs, divide by 10)
  return (postShares * issuePrice) / 10000000; // Convert to crores
}

/**
 * Calculate Pre-IPO P/E Ratio
 * Formula: Issue price / Pre-IPO EPS
 *
 * @param issuePrice - Issue price per share
 * @param preEPS - Pre-IPO Earnings Per Share
 * @returns Pre-IPO P/E ratio or null
 */
export function calculatePreIPO_PE(
  issuePrice: number | null,
  preEPS: number | null
): number | null {
  if (issuePrice === null || preEPS === null || preEPS === 0) {
    return null;
  }
  return issuePrice / preEPS;
}

/**
 * Calculate Post-IPO P/E Ratio
 * Formula: Issue price / Post-IPO EPS
 *
 * @param issuePrice - Issue price per share
 * @param postEPS - Post-IPO Earnings Per Share
 * @returns Post-IPO P/E ratio or null
 */
export function calculatePostIPO_PE(
  issuePrice: number | null,
  postEPS: number | null
): number | null {
  if (issuePrice === null || postEPS === null || postEPS === 0) {
    return null;
  }
  return issuePrice / postEPS;
}

/**
 * Calculate EPS change percentage
 * Formula: ((Post - Pre) / Pre) × 100
 *
 * @param preEPS - Pre-IPO EPS
 * @param postEPS - Post-IPO EPS
 * @returns Percentage change or null
 */
export function calculateEPSChange(
  preEPS: number | null,
  postEPS: number | null
): number | null {
  if (preEPS === null || postEPS === null || preEPS === 0) {
    return null;
  }
  return ((postEPS - preEPS) / Math.abs(preEPS)) * 100;
}

/**
 * Calculate P/E change percentage
 * Formula: ((Post - Pre) / Pre) × 100
 * Note: Lower P/E after IPO is generally better (dilution effect)
 *
 * @param prePE - Pre-IPO P/E ratio
 * @param postPE - Post-IPO P/E ratio
 * @returns Percentage change or null
 */
export function calculatePEChange(
  prePE: number | null,
  postPE: number | null
): number | null {
  if (prePE === null || postPE === null || prePE === 0) {
    return null;
  }
  return ((postPE - prePE) / Math.abs(prePE)) * 100;
}

/**
 * Calculate Return on Net Worth (RoNW)
 * Formula: (Net Profit / Net Worth) × 100
 *
 * @param netProfit - Net profit in ₹ crores
 * @param netWorth - Net worth in ₹ crores
 * @returns RoNW percentage or null
 */
export function calculateRoNW(
  netProfit: number | null,
  netWorth: number | null
): number | null {
  if (netProfit === null || netWorth === null || netWorth === 0) {
    return null;
  }
  return (netProfit / netWorth) * 100;
}

/**
 * Calculate Price-to-Book Value (P/BV) ratio
 * Formula: Issue Price / (Net Worth / Total Shares)
 *
 * @param issuePrice - Issue price per share
 * @param netWorth - Net worth in ₹ crores
 * @param totalShares - Total number of shares
 * @returns P/BV ratio or null
 */
export function calculatePriceToBook(
  issuePrice: number | null,
  netWorth: number | null,
  totalShares: number | null
): number | null {
  if (
    issuePrice === null ||
    netWorth === null ||
    totalShares === null ||
    totalShares === 0
  ) {
    return null;
  }
  const bookValuePerShare = (netWorth * 10000000) / totalShares; // Convert crores to rupees
  return issuePrice / bookValuePerShare;
}

/**
 * Determine color class based on change percentage
 * Positive changes are green, negative are red
 *
 * @param change - Percentage change value
 * @returns Tailwind color class
 */
export function getChangeColorClass(change: number | null): string {
  if (change === null) return 'text-muted-foreground';
  if (change > 0) return 'text-green-600';
  if (change < 0) return 'text-red-600';
  return 'text-muted-foreground';
}

/**
 * Determine if change is positive or negative (for arrow icons)
 *
 * @param change - Percentage change value
 * @returns 'up' | 'down' | 'neutral'
 */
export function getChangeTrend(change: number | null): 'up' | 'down' | 'neutral' {
  if (change === null) return 'neutral';
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'neutral';
}

/**
 * Compute equity dilution (drop in promoter holding %) with a plausibility guard.
 *
 * Dilution = pre-issue % − post-issue %, valid ONLY when both inputs are genuine
 * percentages in [0,100] and the result is a plausible [0,100]. Some IPO rows store
 * promoter holding in the wrong unit (absolute counts, not %), which made the raw
 * subtraction render a domain-absurd value (blind-QA found "2152%" on one page).
 * Returns null in every implausible case so the UI shows "N/A" rather than an absurd
 * number (output-plausibility rule). #89.
 */
export function computeEquityDilution(
  preIssue: number | null,
  postIssue: number | null
): number | null {
  if (preIssue === null || postIssue === null) return null;
  if (!Number.isFinite(preIssue) || !Number.isFinite(postIssue)) return null;
  if (preIssue < 0 || preIssue > 100 || postIssue < 0 || postIssue > 100) return null;
  const dilution = Number((preIssue - postIssue).toFixed(2));
  if (dilution < 0 || dilution > 100) return null; // post>pre or absurd
  return dilution;
}
