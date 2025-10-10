/**
 * IPO Rating Calculator
 *
 * Calculates IPO ratings based on multiple weighted factors:
 * - Financial metrics (30%)
 * - Market conditions (20%)
 * - Subscription levels (20%)
 * - GMP trends (15%)
 * - Company fundamentals (15%)
 */

import type { IPO, FinancialData, Subscription, GMPRecord } from '@/lib/db/types';

export interface RatingFactors {
  financialScore: number;      // 0-100
  marketScore: number;          // 0-100
  subscriptionScore: number;    // 0-100
  gmpScore: number;             // 0-100
  fundamentalScore: number;     // 0-100
}

export interface RatingResult {
  rating: number;               // 1-5 stars (with 0.5 increments)
  score: number;                // 0-100 overall score
  factors: RatingFactors;
  rationale: string;
  confidence: number;           // 0-100 (based on data completeness)
}

/**
 * Calculate IPO rating based on available data
 */
export function calculateIPORating(
  ipo: IPO,
  financialData?: FinancialData | null,
  subscriptions?: Subscription[] | null,
  gmpRecords?: GMPRecord[] | null
): RatingResult {
  const factors: RatingFactors = {
    financialScore: 0,
    marketScore: 0,
    subscriptionScore: 0,
    gmpScore: 0,
    fundamentalScore: 0,
  };

  let dataPoints = 0;
  let maxDataPoints = 5;

  // 1. Financial Score (30% weight)
  if (financialData) {
    factors.financialScore = calculateFinancialScore(financialData, ipo);
    dataPoints++;
  }

  // 2. Market Score (20% weight) - Based on sector and timing
  factors.marketScore = calculateMarketScore(ipo);
  dataPoints++;

  // 3. Subscription Score (20% weight)
  if (subscriptions && subscriptions.length > 0) {
    factors.subscriptionScore = calculateSubscriptionScore(subscriptions);
    dataPoints++;
  }

  // 4. GMP Score (15% weight)
  if (gmpRecords && gmpRecords.length > 0) {
    factors.gmpScore = calculateGMPScore(gmpRecords, ipo);
    dataPoints++;
  }

  // 5. Fundamental Score (15% weight)
  factors.fundamentalScore = calculateFundamentalScore(ipo);
  dataPoints++;

  // Calculate weighted overall score
  const weights = {
    financial: dataPoints > 0 ? 0.30 : 0,
    market: 0.20,
    subscription: subscriptions ? 0.20 : 0,
    gmp: gmpRecords ? 0.15 : 0,
    fundamental: 0.15,
  };

  // Normalize weights if some data is missing
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const normalizedWeights = Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / totalWeight])
  );

  const overallScore =
    factors.financialScore * normalizedWeights.financial +
    factors.marketScore * normalizedWeights.market +
    factors.subscriptionScore * normalizedWeights.subscription +
    factors.gmpScore * normalizedWeights.gmp +
    factors.fundamentalScore * normalizedWeights.fundamental;

  // Convert score to star rating (1-5 with 0.5 increments)
  const rating = Math.round((overallScore / 20) * 2) / 2; // Maps 0-100 to 0-5, rounds to 0.5

  // Calculate confidence based on data completeness
  const confidence = (dataPoints / maxDataPoints) * 100;

  // Generate rationale
  const rationale = generateRationale(factors, rating, ipo);

  return {
    rating: Math.max(1, Math.min(5, rating)), // Ensure rating is between 1-5
    score: Math.round(overallScore),
    factors,
    rationale,
    confidence: Math.round(confidence),
  };
}

/**
 * Calculate financial score based on PE ratio, debt, profitability
 */
function calculateFinancialScore(financialData: FinancialData, ipo: IPO): number {
  let score = 50; // Base score

  // PE Ratio analysis (lower is generally better for value)
  if (financialData.peRatio !== null) {
    const pe = Number(financialData.peRatio);
    if (pe > 0 && pe <= 15) score += 20;
    else if (pe > 15 && pe <= 25) score += 10;
    else if (pe > 25 && pe <= 35) score += 0;
    else if (pe > 35) score -= 10;
  }

  // EPS analysis (positive and growing is good)
  if (financialData.eps !== null) {
    const eps = Number(financialData.eps);
    if (eps > 0) score += 15;
    else score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate market score based on sector performance and market conditions
 */
function calculateMarketScore(ipo: IPO): number {
  let score = 60; // Base score

  // High-growth sectors get better scores
  const highGrowthSectors = ['Technology', 'Healthcare', 'Renewable Energy', 'E-commerce', 'Fintech'];
  const stableSectors = ['Banking', 'FMCG', 'Utilities', 'Insurance'];
  const cyclicalSectors = ['Real Estate', 'Construction', 'Automobile', 'Steel', 'Cement'];

  if (ipo.sector && highGrowthSectors.includes(ipo.sector)) {
    score += 20;
  } else if (ipo.sector && stableSectors.includes(ipo.sector)) {
    score += 10;
  } else if (ipo.sector && cyclicalSectors.includes(ipo.sector)) {
    score += 0;
  }

  // IPO category bonus
  if (ipo.category === 'MAINBOARD') score += 10;
  else if (ipo.category === 'SME') score -= 5;

  // Issue size consideration (larger is generally safer)
  const issueSize = Number(ipo.issueSize);
  if (issueSize >= 1000) score += 10;
  else if (issueSize >= 500) score += 5;
  else if (issueSize < 100) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate subscription score based on QIB, NII, and retail subscription
 */
function calculateSubscriptionScore(subscriptions: Subscription[]): number {
  // Get the latest subscription data
  const latestSub = subscriptions[0];
  if (!latestSub) return 50;

  let score = 0;

  // QIB subscription (most important indicator)
  const qib = Number(latestSub.qibSubscription || 0);
  if (qib >= 10) score += 40;
  else if (qib >= 5) score += 30;
  else if (qib >= 2) score += 20;
  else if (qib >= 1) score += 10;
  else score += 5;

  // NII subscription
  const nii = Number(latestSub.niiSubscription || 0);
  if (nii >= 10) score += 25;
  else if (nii >= 5) score += 20;
  else if (nii >= 2) score += 15;
  else if (nii >= 1) score += 10;
  else score += 5;

  // Retail subscription
  const retail = Number(latestSub.retailSubscription || 0);
  if (retail >= 5) score += 25;
  else if (retail >= 3) score += 20;
  else if (retail >= 2) score += 15;
  else if (retail >= 1) score += 10;
  else score += 5;

  // Overall subscription bonus
  const total = Number(latestSub.totalSubscription || 0);
  if (total >= 50) score += 10;
  else if (total >= 20) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate GMP score based on premium trends
 */
function calculateGMPScore(gmpRecords: GMPRecord[], ipo: IPO): number {
  // Get the latest GMP
  const latestGMP = gmpRecords[0];
  if (!latestGMP) return 50;

  let score = 50; // Base score

  const gmp = Number(latestGMP.gmp || 0);
  const priceMax = Number(ipo.priceRangeMax);

  if (priceMax > 0) {
    const gmpPercent = (gmp / priceMax) * 100;

    if (gmpPercent >= 50) score = 90;
    else if (gmpPercent >= 30) score = 80;
    else if (gmpPercent >= 20) score = 70;
    else if (gmpPercent >= 10) score = 60;
    else if (gmpPercent >= 5) score = 55;
    else if (gmpPercent >= 0) score = 50;
    else score = 40; // Negative GMP

    // Check GMP trend (if we have multiple records)
    if (gmpRecords.length >= 3) {
      const trend = calculateGMPTrend(gmpRecords.slice(0, 3));
      if (trend > 0) score += 10; // Increasing trend
      else if (trend < 0) score -= 10; // Decreasing trend
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate GMP trend (positive = increasing, negative = decreasing)
 */
function calculateGMPTrend(recentGMPs: GMPRecord[]): number {
  if (recentGMPs.length < 2) return 0;

  const latest = Number(recentGMPs[0].gmp || 0);
  const previous = Number(recentGMPs[1].gmp || 0);

  return latest - previous;
}

/**
 * Calculate fundamental score based on company basics
 */
function calculateFundamentalScore(ipo: IPO): number {
  let score = 50; // Base score

  // Promoter holding (if available in description or other fields)
  // This would need to be extracted from company description or additional data

  // Fresh issue vs OFS consideration
  // Higher fresh issue component is generally better for growth

  // Objects of the issue (from company description)
  // Expansion plans, debt reduction, working capital are positive

  // For now, use basic heuristics
  if (ipo.companyDescription) {
    const description = ipo.companyDescription.toLowerCase();

    // Positive keywords
    if (description.includes('market leader')) score += 10;
    if (description.includes('debt free') || description.includes('zero debt')) score += 15;
    if (description.includes('profitable')) score += 10;
    if (description.includes('expansion')) score += 5;
    if (description.includes('award') || description.includes('certified')) score += 5;

    // Negative keywords
    if (description.includes('loss making')) score -= 15;
    if (description.includes('high debt')) score -= 10;
    if (description.includes('declining')) score -= 10;
  }

  // Company age and track record (established companies score higher)
  // This would need additional data

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate human-readable rationale for the rating
 */
function generateRationale(
  factors: RatingFactors,
  rating: number,
  ipo: IPO
): string {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const considerations: string[] = [];

  // Analyze financial score
  if (factors.financialScore >= 70) {
    strengths.push('Strong financial metrics');
  } else if (factors.financialScore <= 40) {
    weaknesses.push('Weak financial performance');
  }

  // Analyze market score
  if (factors.marketScore >= 70) {
    strengths.push(`${ipo.sector || 'Sector'} has good growth potential`);
  } else if (factors.marketScore <= 40) {
    weaknesses.push('Challenging market conditions');
  }

  // Analyze subscription
  if (factors.subscriptionScore >= 80) {
    strengths.push('Excellent subscription response from all categories');
  } else if (factors.subscriptionScore >= 60) {
    strengths.push('Good subscription levels');
  } else if (factors.subscriptionScore <= 40) {
    weaknesses.push('Poor subscription response');
  }

  // Analyze GMP
  if (factors.gmpScore >= 70) {
    strengths.push('Strong grey market premium');
  } else if (factors.gmpScore <= 40) {
    weaknesses.push('Weak or negative grey market premium');
  }

  // Analyze fundamentals
  if (factors.fundamentalScore >= 70) {
    strengths.push('Solid business fundamentals');
  } else if (factors.fundamentalScore <= 40) {
    weaknesses.push('Concerns about business fundamentals');
  }

  // Build rationale
  let rationale = '';

  if (rating >= 4) {
    rationale = 'Highly recommended IPO. ';
  } else if (rating >= 3) {
    rationale = 'Moderately attractive IPO. ';
  } else if (rating >= 2) {
    rationale = 'Below average IPO. ';
  } else {
    rationale = 'High-risk IPO. ';
  }

  if (strengths.length > 0) {
    rationale += `Strengths: ${strengths.join(', ')}. `;
  }

  if (weaknesses.length > 0) {
    rationale += `Concerns: ${weaknesses.join(', ')}. `;
  }

  // Add category-specific advice
  if (ipo.category === 'SME') {
    considerations.push('SME IPOs carry higher risk');
  }

  if (ipo.category === 'NCD') {
    considerations.push('NCDs are debt instruments with fixed returns');
  }

  if (considerations.length > 0) {
    rationale += `Note: ${considerations.join(', ')}.`;
  }

  return rationale.trim();
}

/**
 * Get star rating display (e.g., "★★★★☆")
 */
export function getStarDisplay(rating: number): string {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 !== 0;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return '★'.repeat(fullStars) +
         (hasHalfStar ? '⯪' : '') +
         '☆'.repeat(emptyStars);
}

/**
 * Get rating color class for Tailwind
 */
export function getRatingColorClass(rating: number): string {
  if (rating >= 4.5) return 'text-green-600 dark:text-green-400';
  if (rating >= 3.5) return 'text-blue-600 dark:text-blue-400';
  if (rating >= 2.5) return 'text-yellow-600 dark:text-yellow-400';
  if (rating >= 1.5) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Get rating badge text
 */
export function getRatingBadgeText(rating: number): string {
  if (rating >= 4.5) return 'Highly Recommended';
  if (rating >= 4) return 'Recommended';
  if (rating >= 3.5) return 'Good';
  if (rating >= 3) return 'Average';
  if (rating >= 2.5) return 'Below Average';
  if (rating >= 2) return 'Risky';
  return 'High Risk';
}