/**
 * Real-Time IPO Scoring Service (Phase 5)
 *
 * Implements dynamic, data-driven IPO quality scoring (0-10 scale) to replace static seed values.
 * Scoring methodology based on 5 key components:
 * 1. Financial Strength (3 points) - Revenue growth, Profitability, ROE
 * 2. Valuation (2 points) - P/E Ratio, Price-to-Book
 * 3. Subscription Demand (2 points) - Overall subscription, QIB subscription
 * 4. Market Performance (2 points) - GMP, Listing gains
 * 5. Company Fundamentals (1 point) - Issue size, Company age
 *
 * @module ipo-scoring-realtime
 */

import { getDb } from '@/lib/db';
import { ipos, financialData, subscriptions, gmpRecords, listingPerformance, ipoFinancials } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import type { IPO, FinancialData, Subscription, GMPRecord, ListingPerformance, IpoFinancials } from '@/lib/db/types';

// ==================== TYPES ====================

/**
 * Score breakdown by component
 */
export interface ScoreComponents {
  financialStrength: number;  // 0-3
  valuation: number;          // 0-2
  subscriptionDemand: number; // 0-2
  marketPerformance: number;  // 0-2
  fundamentals: number;       // 0-1
  total: number;              // 0-10
  rating: string;             // "Exceptional", "Strong", etc.
  confidence: number;         // 0-100 (data completeness)
  breakdown: {
    revenueGrowth?: number;
    profitability?: number;
    roe?: number;
    peValuation?: number;
    priceToBook?: number;
    overallSubscription?: number;
    qibSubscription?: number;
    gmpPremium?: number;
    listingGains?: number;
    issueSize?: number;
    companyAge?: number;
  };
}

/**
 * IPO data bundle for scoring
 */
interface IPODataBundle {
  ipo: IPO;
  financial: FinancialData | null;
  enhancedFinancial: IpoFinancials | null;
  latestSubscription: Subscription | null;
  latestGMP: GMPRecord | null;
  listing: ListingPerformance | null;
}

// ==================== CONSTANTS ====================

/**
 * Rating scale thresholds
 */
const RATING_THRESHOLDS = {
  EXCEPTIONAL: 9.0,    // 9.0 - 10.0
  STRONG: 7.5,         // 7.5 - 8.9
  GOOD: 6.0,           // 6.0 - 7.4
  AVERAGE: 4.5,        // 4.5 - 5.9
  BELOW_AVERAGE: 3.0,  // 3.0 - 4.4
  POOR: 0.0,           // 0.0 - 2.9
} as const;

/**
 * Industry average benchmarks (can be made dynamic later)
 */
const INDUSTRY_BENCHMARKS = {
  PE_RATIO: 20,          // Default industry P/E
  REVENUE_GROWTH: 15,    // Target revenue growth %
  PROFIT_MARGIN: 10,     // Target profit margin %
  ROE: 15,               // Target ROE %
} as const;

// ==================== SERVICE CLASS ====================

export class IPOScoringService {
  private db: Awaited<ReturnType<typeof getDb>>;

  constructor(db?: Awaited<ReturnType<typeof getDb>>) {
    this.db = db as Awaited<ReturnType<typeof getDb>>;
  }

  /**
   * Initialize database connection if not provided
   */
  private async ensureDb() {
    if (!this.db) {
      this.db = await getDb();
    }
  }

  /**
   * Calculate comprehensive score for an IPO
   */
  async calculateScore(ipoId: string): Promise<ScoreComponents> {
    await this.ensureDb();

    // Fetch all required data
    const data = await this.fetchIPOData(ipoId);

    if (!data.ipo) {
      throw new Error(`IPO not found: ${ipoId}`);
    }

    // Calculate individual components
    const financialStrength = this.calculateFinancialStrength(data);
    const valuation = this.calculateValuation(data);
    const subscriptionDemand = this.calculateSubscriptionDemand(data);
    const marketPerformance = this.calculateMarketPerformance(data);
    const fundamentals = this.calculateFundamentals(data);

    // Calculate total score
    const total = this.roundToDecimal(
      financialStrength.score +
      valuation.score +
      subscriptionDemand.score +
      marketPerformance.score +
      fundamentals.score,
      1
    );

    // Determine rating
    const rating = this.getRatingLabel(total);

    // Calculate confidence (data completeness)
    const confidence = this.calculateConfidence(data);

    return {
      financialStrength: financialStrength.score,
      valuation: valuation.score,
      subscriptionDemand: subscriptionDemand.score,
      marketPerformance: marketPerformance.score,
      fundamentals: fundamentals.score,
      total,
      rating,
      confidence,
      breakdown: {
        ...financialStrength.breakdown,
        ...valuation.breakdown,
        ...subscriptionDemand.breakdown,
        ...marketPerformance.breakdown,
        ...fundamentals.breakdown,
      },
    };
  }

  /**
   * Fetch all data needed for scoring
   */
  private async fetchIPOData(ipoId: string): Promise<IPODataBundle> {
    const [ipo] = await this.db
      .select()
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    if (!ipo) {
      throw new Error(`IPO not found: ${ipoId}`);
    }

    // Fetch related data in parallel
    const [financial, enhancedFinancial, subscriptionsData, gmpData, listing] = await Promise.all([
      this.db.select().from(financialData).where(eq(financialData.ipoId, ipoId)).limit(1),
      this.db.select().from(ipoFinancials).where(eq(ipoFinancials.ipoId, ipoId)).limit(1),
      this.db.select().from(subscriptions).where(eq(subscriptions.ipoId, ipoId)).orderBy(desc(subscriptions.timestamp)).limit(1),
      this.db.select().from(gmpRecords).where(eq(gmpRecords.ipoId, ipoId)).orderBy(desc(gmpRecords.timestamp)).limit(1),
      this.db.select().from(listingPerformance).where(eq(listingPerformance.ipoId, ipoId)).limit(1),
    ]);

    return {
      ipo,
      financial: financial[0] || null,
      enhancedFinancial: enhancedFinancial[0] || null,
      latestSubscription: subscriptionsData[0] || null,
      latestGMP: gmpData[0] || null,
      listing: listing[0] || null,
    };
  }

  /**
   * Component 1: Financial Strength (0-3 points)
   * - Revenue growth (1 point)
   * - Profitability (1 point)
   * - ROE (1 point)
   */
  private calculateFinancialStrength(data: IPODataBundle): { score: number; breakdown: any } {
    const { financial, enhancedFinancial } = data;
    let score = 0;
    const breakdown: any = {};

    // Use enhanced financial data first, fallback to basic financial data
    const revenue2023 = this.toNumber(enhancedFinancial?.revenueFy2 || financial?.revenueFy2023);
    const revenue2024 = this.toNumber(enhancedFinancial?.revenueFy3 || financial?.revenueFy2024);
    const profit2023 = this.toNumber(enhancedFinancial?.profitFy2 || financial?.profitFy2023);
    const profit2024 = this.toNumber(enhancedFinancial?.profitFy3 || financial?.profitFy2024);
    const roe = this.toNumber(enhancedFinancial?.roePercentage || financial?.roe);

    // 1. Revenue growth (1 point)
    if (revenue2023 && revenue2024 && revenue2023 > 0) {
      const revenueGrowth = ((revenue2024 - revenue2023) / revenue2023) * 100;
      breakdown.revenueGrowth = this.roundToDecimal(revenueGrowth, 2);

      if (revenueGrowth > 30) score += 1.0;
      else if (revenueGrowth > 15) score += 0.7;
      else if (revenueGrowth > 5) score += 0.4;
      // else 0
    }

    // 2. Profitability (1 point)
    if (revenue2024 && profit2024 && revenue2024 > 0) {
      const profitMargin = (profit2024 / revenue2024) * 100;
      breakdown.profitability = this.roundToDecimal(profitMargin, 2);

      if (profitMargin > 20) score += 1.0;
      else if (profitMargin > 10) score += 0.7;
      else if (profitMargin > 5) score += 0.4;
      // else 0
    }

    // 3. ROE (1 point)
    if (roe !== null) {
      breakdown.roe = this.roundToDecimal(roe, 2);

      if (roe > 20) score += 1.0;
      else if (roe > 15) score += 0.8;
      else if (roe > 10) score += 0.5;
      // else 0
    }

    return { score: this.roundToDecimal(score, 2), breakdown };
  }

  /**
   * Component 2: Valuation (0-2 points)
   * - P/E Ratio vs Industry (1 point)
   * - Price-to-Book (1 point)
   */
  private calculateValuation(data: IPODataBundle): { score: number; breakdown: any } {
    const { financial, enhancedFinancial } = data;
    let score = 0;
    const breakdown: any = {};

    const peRatio = this.toNumber(enhancedFinancial?.peRatio || financial?.peRatio);
    const industryPE = this.toNumber(enhancedFinancial?.industryPe) || INDUSTRY_BENCHMARKS.PE_RATIO;
    const pbRatio = this.toNumber(enhancedFinancial?.pbRatio);

    // 1. P/E Ratio comparison (1 point)
    if (peRatio !== null && industryPE > 0) {
      const peDiff = Math.abs(peRatio - industryPE) / industryPE;
      breakdown.peValuation = this.roundToDecimal(peDiff * 100, 2);

      if (peDiff < 0.1) score += 1.0;        // Within ±10%
      else if (peDiff < 0.2) score += 0.7;   // Within ±20%
      else if (peDiff < 0.3) score += 0.4;   // Within ±30%
      // else 0
    }

    // 2. Price-to-Book (1 point)
    if (pbRatio !== null) {
      breakdown.priceToBook = this.roundToDecimal(pbRatio, 2);

      if (pbRatio < 3) score += 1.0;
      else if (pbRatio < 5) score += 0.7;
      else if (pbRatio < 8) score += 0.4;
      // else 0
    }

    return { score: this.roundToDecimal(score, 2), breakdown };
  }

  /**
   * Component 3: Subscription Demand (0-2 points)
   * - Overall subscription (1 point)
   * - QIB subscription (1 point)
   */
  private calculateSubscriptionDemand(data: IPODataBundle): { score: number; breakdown: any } {
    const { latestSubscription } = data;
    let score = 0;
    const breakdown: any = {};

    if (!latestSubscription) {
      return { score: 0, breakdown };
    }

    const totalSub = this.toNumber(latestSubscription.totalSubscription);
    const qibSub = this.toNumber(latestSubscription.qibSubscription);

    // 1. Overall subscription (1 point)
    if (totalSub !== null) {
      breakdown.overallSubscription = this.roundToDecimal(totalSub, 2);

      if (totalSub > 100) score += 1.0;
      else if (totalSub > 50) score += 0.8;
      else if (totalSub > 20) score += 0.6;
      else if (totalSub > 10) score += 0.4;
      else if (totalSub > 5) score += 0.2;
      // else 0
    }

    // 2. QIB subscription (1 point)
    if (qibSub !== null) {
      breakdown.qibSubscription = this.roundToDecimal(qibSub, 2);

      if (qibSub > 50) score += 1.0;
      else if (qibSub > 30) score += 0.8;
      else if (qibSub > 10) score += 0.5;
      else score += 0.2;
    }

    return { score: this.roundToDecimal(score, 2), breakdown };
  }

  /**
   * Component 4: Market Performance (0-2 points)
   * - GMP (1 point)
   * - Listing gains (1 point)
   */
  private calculateMarketPerformance(data: IPODataBundle): { score: number; breakdown: any } {
    const { ipo, latestGMP, listing } = data;
    let score = 0;
    const breakdown: any = {};

    const issuePrice = ipo.priceRangeMax || ipo.priceRangeMin || null;

    // 1. GMP (1 point)
    if (latestGMP && issuePrice && issuePrice > 0) {
      const gmpPercent = (latestGMP.gmp / issuePrice) * 100;
      breakdown.gmpPremium = this.roundToDecimal(gmpPercent, 2);

      if (gmpPercent > 50) score += 1.0;
      else if (gmpPercent > 30) score += 0.8;
      else if (gmpPercent > 10) score += 0.5;
      else if (gmpPercent > 0) score += 0.2;
      // else 0 (negative GMP)
    }

    // 2. Listing gains (1 point)
    if (listing) {
      const gains = this.toNumber(listing.listingGainPercent);
      if (gains !== null) {
        breakdown.listingGains = this.roundToDecimal(gains, 2);

        if (gains > 50) score += 1.0;
        else if (gains > 30) score += 0.8;
        else if (gains > 10) score += 0.5;
        else if (gains > 0) score += 0.2;
        // else 0 (negative listing)
      }
    }

    return { score: this.roundToDecimal(score, 2), breakdown };
  }

  /**
   * Component 5: Company Fundamentals (0-1 point)
   * - Issue size (0.5 points)
   * - Company age (0.5 points)
   */
  private calculateFundamentals(data: IPODataBundle): { score: number; breakdown: any } {
    const { ipo } = data;
    let score = 0;
    const breakdown: any = {};

    // 1. Issue size (0.5 points)
    const issueSize = this.toNumber(ipo.issueSize);
    if (issueSize !== null) {
      breakdown.issueSize = this.roundToDecimal(issueSize, 2);

      if (issueSize > 1000) score += 0.5;
      else if (issueSize > 500) score += 0.4;
      else if (issueSize > 100) score += 0.3;
      else score += 0.2;
    }

    // 2. Company age (0.5 points)
    // Note: Company age field doesn't exist in schema, skip for now
    // In production, calculate from incorporation date or founded year
    // For now, award partial credit
    score += 0.25; // Placeholder

    return { score: this.roundToDecimal(score, 2), breakdown };
  }

  /**
   * Calculate confidence score based on data completeness
   */
  private calculateConfidence(data: IPODataBundle): number {
    const fields = [
      data.financial?.revenueFy2023,
      data.financial?.revenueFy2024,
      data.financial?.profitFy2023,
      data.financial?.profitFy2024,
      data.financial?.roe,
      data.financial?.peRatio,
      data.enhancedFinancial?.pbRatio,
      data.latestSubscription?.totalSubscription,
      data.latestSubscription?.qibSubscription,
      data.latestGMP?.gmp,
      data.listing?.listingGainPercent,
      data.ipo.issueSize,
    ];

    const completed = fields.filter((f) => f !== null && f !== undefined).length;
    return Math.round((completed / fields.length) * 100);
  }

  /**
   * Get rating label from total score
   */
  private getRatingLabel(score: number): string {
    if (score >= RATING_THRESHOLDS.EXCEPTIONAL) return 'Exceptional (Invest)';
    if (score >= RATING_THRESHOLDS.STRONG) return 'Strong (Consider)';
    if (score >= RATING_THRESHOLDS.GOOD) return 'Good (Moderate)';
    if (score >= RATING_THRESHOLDS.AVERAGE) return 'Average (Neutral)';
    if (score >= RATING_THRESHOLDS.BELOW_AVERAGE) return 'Below Average (Caution)';
    return 'Poor (Avoid)';
  }

  /**
   * Get score interpretation
   */
  getScoreInterpretation(score: number): string {
    if (score >= RATING_THRESHOLDS.EXCEPTIONAL) {
      return 'Exceptional IPO with strong fundamentals and market demand. Highly recommended for investment.';
    }
    if (score >= RATING_THRESHOLDS.STRONG) {
      return 'Strong IPO with good financials and healthy subscription. Worth considering for investment.';
    }
    if (score >= RATING_THRESHOLDS.GOOD) {
      return 'Good IPO with moderate fundamentals. Suitable for moderate risk appetite.';
    }
    if (score >= RATING_THRESHOLDS.AVERAGE) {
      return 'Average IPO with mixed indicators. Conduct thorough research before investing.';
    }
    if (score >= RATING_THRESHOLDS.BELOW_AVERAGE) {
      return 'Below average IPO with weak fundamentals. Exercise caution.';
    }
    return 'Poor IPO with significant concerns. Not recommended for investment.';
  }

  /**
   * Helper: Convert value to number or null
   */
  private toNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Helper: Round to specified decimal places
   */
  private roundToDecimal(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}
