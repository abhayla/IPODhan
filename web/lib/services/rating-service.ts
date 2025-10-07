/**
 * Rating Service
 *
 * Implements the IPO rating algorithm that calculates a 1-5 star rating
 * based on 5 factors: Subscription, Promoter Holding, Financials, GMP, and Peer P/E.
 *
 * @module rating-service
 */

import type {
  IPO,
  Subscription,
  GMPRecord,
  PeerCompany,
  FinancialData,
} from '../db/types';

// ==================== TYPES ====================

/**
 * Individual factor scores (1-5 stars)
 */
export interface RatingFactors {
  subscription: number | null;
  promoterHolding: number | null;
  financials: number | null;
  gmp: number | null;
  peerPE: number | null;
}

/**
 * Rating result with rationale
 */
export interface RatingResult {
  rating: number | null;
  rationale: string;
  availableFactors: string[];
}

// ==================== CONSTANTS ====================

/**
 * Factor weights (must sum to 100%)
 */
const FACTOR_WEIGHTS = {
  subscription: 0.30,
  promoterHolding: 0.20,
  financials: 0.20,
  gmp: 0.15,
  peerPE: 0.15,
} as const;

/**
 * Minimum number of factors required for a valid rating
 */
const MINIMUM_FACTORS = 3;

// ==================== FACTOR CALCULATION FUNCTIONS ====================

/**
 * Calculate subscription score (1-5 stars)
 * Based on total subscription multiple
 *
 * Scoring:
 * - <1x = 1 star
 * - 1-5x = 2 stars
 * - 5-10x = 3 stars
 * - 10-20x = 4 stars
 * - >20x = 5 stars
 */
function calculateSubscriptionScore(
  subscription: Subscription | null
): number | null {
  if (!subscription || subscription.totalSubscription === null) {
    return null;
  }

  const total = Number(subscription.totalSubscription);

  if (total < 1) return 1;
  if (total < 5) return 2;
  if (total < 10) return 3;
  if (total < 20) return 4;
  return 5;
}

/**
 * Calculate promoter holding score (1-5 stars)
 * Based on promoter holding percentage
 *
 * Scoring:
 * - <40% = 1 star
 * - 40-50% = 2 stars
 * - 50-60% = 3 stars
 * - 60-75% = 4 stars
 * - >75% = 5 stars
 *
 * Note: Promoter holding % is calculated from issue structure
 * For MVP, we'll use a placeholder calculation based on financial data
 */
function calculatePromoterHoldingScore(
  financialData: FinancialData | null
): number | null {
  if (!financialData) {
    return null;
  }

  // TODO: In production, extract promoter holding from issue structure
  // For MVP, estimate from reserves/net worth ratio
  // Higher reserves often indicate higher promoter holding
  const netWorth = financialData.netWorth
    ? Number(financialData.netWorth)
    : null;
  const reserves = financialData.reservesAndSurplus
    ? Number(financialData.reservesAndSurplus)
    : null;

  if (!netWorth || !reserves || netWorth === 0) {
    return null;
  }

  // Estimate promoter holding percentage (this is a rough approximation)
  const estimatedPromoterHolding = Math.min(
    100,
    (reserves / netWorth) * 100 + 40
  );

  if (estimatedPromoterHolding < 40) return 1;
  if (estimatedPromoterHolding < 50) return 2;
  if (estimatedPromoterHolding < 60) return 3;
  if (estimatedPromoterHolding < 75) return 4;
  return 5;
}

/**
 * Calculate financials score (1-5 stars)
 * Based on revenue and profit growth (FY2024 vs FY2023)
 *
 * Scoring:
 * - Negative growth = 1 star
 * - 0-10% growth = 2 stars
 * - 10-25% growth = 3 stars
 * - 25-50% growth = 4 stars
 * - >50% growth = 5 stars
 */
function calculateFinancialsScore(
  financialData: FinancialData | null
): number | null {
  if (!financialData) {
    return null;
  }

  const revenue2023 = financialData.revenueFy2023
    ? Number(financialData.revenueFy2023)
    : null;
  const revenue2024 = financialData.revenueFy2024
    ? Number(financialData.revenueFy2024)
    : null;
  const profit2023 = financialData.profitFy2023
    ? Number(financialData.profitFy2023)
    : null;
  const profit2024 = financialData.profitFy2024
    ? Number(financialData.profitFy2024)
    : null;

  // Need at least one growth metric
  if (
    !revenue2023 ||
    !revenue2024 ||
    revenue2023 === 0 ||
    !profit2023 ||
    !profit2024 ||
    profit2023 === 0
  ) {
    return null;
  }

  // Calculate growth percentages
  const revenueGrowth = ((revenue2024 - revenue2023) / revenue2023) * 100;
  const profitGrowth = ((profit2024 - profit2023) / profit2023) * 100;

  // Average growth
  const avgGrowth = (revenueGrowth + profitGrowth) / 2;

  if (avgGrowth < 0) return 1;
  if (avgGrowth < 10) return 2;
  if (avgGrowth < 25) return 3;
  if (avgGrowth < 50) return 4;
  return 5;
}

/**
 * Calculate GMP score (1-5 stars)
 * Based on average GMP percentage relative to issue price
 *
 * Scoring:
 * - <0% = 1 star
 * - 0-10% = 2 stars
 * - 10-25% = 3 stars
 * - 25-50% = 4 stars
 * - >50% = 5 stars
 */
function calculateGMPScore(
  gmpRecords: GMPRecord[],
  issuePrice: number | null
): number | null {
  if (!gmpRecords || gmpRecords.length === 0 || !issuePrice || issuePrice === 0) {
    return null;
  }

  // Use last 3 records for average
  const recentRecords = gmpRecords.slice(0, 3);
  const avgGMP =
    recentRecords.reduce((sum, record) => sum + record.gmp, 0) /
    recentRecords.length;

  // Calculate GMP percentage
  const gmpPercent = (avgGMP / issuePrice) * 100;

  if (gmpPercent < 0) return 1;
  if (gmpPercent < 10) return 2;
  if (gmpPercent < 25) return 3;
  if (gmpPercent < 50) return 4;
  return 5;
}

/**
 * Calculate peer P/E comparison score (1-5 stars)
 * Based on IPO P/E relative to peer average
 *
 * Scoring:
 * - IPO P/E > 150% of peer avg = 1 star (overvalued)
 * - 120-150% = 2 stars
 * - 90-120% = 3 stars (fair value)
 * - 70-90% = 4 stars
 * - <70% = 5 stars (undervalued)
 */
function calculatePeerPEScore(
  ipoFinancials: FinancialData | null,
  peerCompanies: PeerCompany[]
): number | null {
  if (!ipoFinancials || !ipoFinancials.peRatio) {
    return null;
  }

  const ipoPE = Number(ipoFinancials.peRatio);

  // Filter peers with valid P/E ratios
  const peersWithPE = peerCompanies.filter((peer) => peer.peRatio !== null);

  if (peersWithPE.length === 0) {
    return null;
  }

  // Calculate average peer P/E
  const avgPeerPE =
    peersWithPE.reduce((sum, peer) => sum + Number(peer.peRatio), 0) /
    peersWithPE.length;

  if (avgPeerPE === 0) {
    return null;
  }

  // Calculate ratio
  const peRatio = (ipoPE / avgPeerPE) * 100;

  if (peRatio > 150) return 1;
  if (peRatio > 120) return 2;
  if (peRatio > 90) return 3;
  if (peRatio > 70) return 4;
  return 5;
}

// ==================== RATIONALE GENERATION ====================

/**
 * Generate human-readable rationale for rating
 */
function generateRatingRationale(
  rating: number,
  factors: RatingFactors,
  subscription: Subscription | null,
  gmpRecords: GMPRecord[],
  issuePrice: number | null,
  financialData: FinancialData | null
): string {
  const parts: string[] = [];

  // Rating level description
  if (rating >= 4.0) {
    parts.push('Strong rating');
  } else if (rating >= 3.0) {
    parts.push('Good rating');
  } else if (rating >= 2.0) {
    parts.push('Fair rating');
  } else {
    parts.push('Below average rating');
  }

  parts.push(`(${rating.toFixed(1)}/5)`);

  // Subscription details
  if (factors.subscription !== null && subscription?.totalSubscription) {
    const subMultiple = Number(subscription.totalSubscription).toFixed(1);
    parts.push(
      `driven by ${
        factors.subscription >= 4 ? 'excellent' : 'moderate'
      } subscription (${subMultiple}x)`
    );
  }

  // GMP details
  if (factors.gmp !== null && gmpRecords.length > 0 && issuePrice) {
    const avgGMP =
      gmpRecords.slice(0, 3).reduce((sum, r) => sum + r.gmp, 0) /
      Math.min(3, gmpRecords.length);
    const gmpPercent = ((avgGMP / issuePrice) * 100).toFixed(0);
    const gmpStatus = factors.gmp >= 3 ? 'positive' : 'negative';
    parts.push(`${gmpStatus} GMP (₹${avgGMP.toFixed(0)}, +${gmpPercent}%)`);
  }

  // Financials details
  if (factors.financials !== null && financialData) {
    const rev2023 = financialData.revenueFy2023
      ? Number(financialData.revenueFy2023)
      : 0;
    const rev2024 = financialData.revenueFy2024
      ? Number(financialData.revenueFy2024)
      : 0;
    if (rev2023 > 0 && rev2024 > 0) {
      const revGrowth = (((rev2024 - rev2023) / rev2023) * 100).toFixed(0);
      const growthStatus =
        factors.financials >= 3
          ? 'Strong'
          : factors.financials >= 2
            ? 'Moderate'
            : 'Weak';
      parts.push(`${growthStatus} financials with ${revGrowth}% revenue growth`);
    }
  }

  // Promoter holding
  if (factors.promoterHolding !== null) {
    const holdingStatus =
      factors.promoterHolding >= 4 ? 'High' : factors.promoterHolding >= 3 ? 'Moderate' : 'Low';
    parts.push(`${holdingStatus} promoter confidence`);
  }

  // Peer comparison
  if (factors.peerPE !== null) {
    const valuation =
      factors.peerPE >= 4
        ? 'attractive'
        : factors.peerPE >= 3
          ? 'fair'
          : 'expensive';
    parts.push(`${valuation} valuation vs peers`);
  }

  // Missing factors note
  const availableCount = Object.values(factors).filter((f) => f !== null).length;
  if (availableCount < 5) {
    parts.push(`(${5 - availableCount} factor${5 - availableCount !== 1 ? 's' : ''} unavailable)`);
  }

  // Join parts with proper punctuation
  let rationale = parts[0] + ' ' + parts[1];
  if (parts.length > 2) {
    rationale += ' ' + parts.slice(2, -1).join(', ');
    if (parts.length > 3) {
      rationale += '. ' + parts[parts.length - 1];
    }
  }

  return rationale + '.';
}

// ==================== MAIN RATING CALCULATION ====================

/**
 * Calculate IPO rating based on multiple factors
 *
 * @param ipo - The IPO entity
 * @param subscription - Latest subscription data (or null if not available)
 * @param gmpRecords - Recent GMP records (or empty array)
 * @param peerCompanies - Peer companies for comparison (or empty array)
 * @param financialData - Financial data for the IPO (or null)
 * @returns Rating result with score and rationale, or null if insufficient data
 */
export function calculateIPORating(
  ipo: IPO,
  subscription: Subscription | null,
  gmpRecords: GMPRecord[],
  peerCompanies: PeerCompany[],
  financialData: FinancialData | null
): RatingResult {
  // Determine issue price (use max of range if available)
  const issuePrice = ipo.priceRangeMax || ipo.priceRangeMin || null;

  // Calculate individual factor scores
  const factors: RatingFactors = {
    subscription: calculateSubscriptionScore(subscription),
    promoterHolding: calculatePromoterHoldingScore(financialData),
    financials: calculateFinancialsScore(financialData),
    gmp: calculateGMPScore(gmpRecords, issuePrice),
    peerPE: calculatePeerPEScore(financialData, peerCompanies),
  };

  // Count available factors
  const availableFactors = Object.entries(factors)
    .filter(([, score]) => score !== null)
    .map(([name]) => name);

  // Check minimum data requirement
  if (availableFactors.length < MINIMUM_FACTORS) {
    return {
      rating: null,
      rationale: `Insufficient data for rating (${availableFactors.length}/${MINIMUM_FACTORS} minimum factors available). More data needed.`,
      availableFactors,
    };
  }

  // Calculate weighted average
  let totalWeightedScore = 0;
  let totalWeight = 0;

  Object.entries(factors).forEach(([factorName, score]) => {
    if (score !== null) {
      const weight = FACTOR_WEIGHTS[factorName as keyof typeof FACTOR_WEIGHTS];
      totalWeightedScore += score * weight;
      totalWeight += weight;
    }
  });

  // Normalize to 5-star scale
  const rawRating = totalWeightedScore / totalWeight;

  // Round to nearest 0.5
  const rating = Math.round(rawRating * 2) / 2;

  // Clamp between 1.0 and 5.0
  const finalRating = Math.max(1.0, Math.min(5.0, rating));

  // Generate rationale
  const rationale = generateRatingRationale(
    finalRating,
    factors,
    subscription,
    gmpRecords,
    issuePrice,
    financialData
  );

  return {
    rating: finalRating,
    rationale,
    availableFactors,
  };
}
