/**
 * Real-Time IPO Score Repository (Phase 5)
 *
 * Data access layer for real-time IPO scoring system with intelligent caching.
 * Integrates with IPOScoringService to provide cached score retrieval with automatic recalculation.
 *
 * @module ipo-score-realtime-repository
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';
import { IPOScoringService, type ScoreComponents } from '@/lib/services/ipo-scoring-realtime';
import { CacheTTL } from '@/lib/cache/cache-keys';

/**
 * TTL strategy based on IPO status
 */
const SCORE_TTL = {
  UPCOMING: 86400,  // 24 hours (scores rarely change)
  OPEN: 3600,       // 1 hour (frequent updates during IPO)
  CLOSED: 14400,    // 4 hours (less frequent updates)
  LISTED: 86400,    // 24 hours (stable after listing)
} as const;

export class IPOScoreRealtimeRepository extends BaseRepository {
  private scoringService: IPOScoringService;

  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
    this.scoringService = new IPOScoringService(db);
  }

  /**
   * Get or calculate score for an IPO with intelligent caching
   *
   * Strategy:
   * 1. Check cache first
   * 2. If cache miss or expired, check database
   * 3. If database score is recent (< 1 hour for OPEN, < 24 hours for others), use it
   * 4. Otherwise, calculate fresh score and update both cache and database
   */
  async getOrCalculateScore(ipoId: string): Promise<ScoreComponents> {
    const cacheKey = `ipo:score:realtime:${ipoId}`;

    // Try cache first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.log(`[Score] Cache HIT: ${ipoId}`);
        return JSON.parse(cached);
      }
      console.log(`[Score] Cache MISS: ${ipoId}`);
    } catch (error) {
      console.error(`[Score] Cache error for ${ipoId}:`, error);
    }

    // Get IPO status for TTL determination
    const [ipo] = await this.db
      .select({ status: schema.ipos.status })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, ipoId))
      .limit(1);

    if (!ipo) {
      throw new Error(`IPO not found: ${ipoId}`);
    }

    // Check database for recent score
    const dbScore = await this.findStoredScore(ipoId);

    if (dbScore && this.isScoreRecent(dbScore.calculatedAt, ipo.status)) {
      console.log(`[Score] Using recent DB score for ${ipoId}`);
      const scoreData = this.parseStoredScore(dbScore);

      // Cache it
      await this.cacheScore(ipoId, scoreData, ipo.status);

      return scoreData;
    }

    // Calculate fresh score
    console.log(`[Score] Calculating fresh score for ${ipoId}`);
    const score = await this.scoringService.calculateScore(ipoId);

    // Save to database
    await this.saveScore(ipoId, score);

    // Cache it
    await this.cacheScore(ipoId, score, ipo.status);

    return score;
  }

  /**
   * Find stored score in database
   */
  private async findStoredScore(ipoId: string) {
    const [stored] = await this.db
      .select()
      .from(schema.ipoScores)
      .where(eq(schema.ipoScores.ipoId, ipoId))
      .limit(1);

    return stored || null;
  }

  /**
   * Check if stored score is recent enough to use
   */
  private isScoreRecent(calculatedAt: Date, status: string): boolean {
    const hoursSince = (Date.now() - calculatedAt.getTime()) / (1000 * 60 * 60);

    switch (status) {
      case 'OPEN':
        return hoursSince < 1; // Recalculate every hour for open IPOs
      case 'UPCOMING':
      case 'CLOSED':
        return hoursSince < 4; // Recalculate every 4 hours
      case 'LISTED':
        return hoursSince < 24; // Recalculate daily for listed IPOs
      default:
        return hoursSince < 4;
    }
  }

  /**
   * Parse stored score from database format to ScoreComponents
   */
  private parseStoredScore(dbScore: any): ScoreComponents {
    // Map database fields (0-100 scale with 4 components of 25 each)
    // to our new format (0-10 scale with custom components)
    // This is a temporary mapping until we migrate the database schema

    const total = (dbScore.totalScore / 100) * 10; // Scale from 100 to 10

    return {
      financialStrength: (dbScore.fundamentalScore / 25) * 3, // Scale 0-25 to 0-3
      valuation: (dbScore.sentimentScore / 25) * 2,           // Scale 0-25 to 0-2
      subscriptionDemand: (dbScore.subscriptionScore / 25) * 2, // Scale 0-25 to 0-2
      marketPerformance: (dbScore.sectorScore / 25) * 2,      // Scale 0-25 to 0-2
      fundamentals: 0.5, // Placeholder
      total: this.roundToDecimal(total, 1),
      rating: this.getRatingFromVerdict(dbScore.verdict),
      confidence: this.getConfidencePercentage(dbScore.confidence),
      breakdown: {},
    };
  }

  /**
   * Save score to database
   */
  private async saveScore(ipoId: string, score: ScoreComponents): Promise<void> {
    // Map our 0-10 scale to database 0-100 scale
    const totalScore = Math.round((score.total / 10) * 100);
    const fundamentalScore = Math.round((score.financialStrength / 3) * 25);
    const sentimentScore = Math.round((score.valuation / 2) * 25);
    const subscriptionScore = Math.round((score.subscriptionDemand / 2) * 25);
    const sectorScore = Math.round((score.marketPerformance / 2) * 25);

    const verdict = this.getVerdictFromRating(score.rating);
    const confidence = this.getConfidenceLevelFromPercentage(score.confidence);

    try {
      await this.db
        .insert(schema.ipoScores)
        .values({
          ipoId,
          totalScore,
          fundamentalScore,
          sentimentScore,
          subscriptionScore,
          sectorScore,
          verdict,
          confidence,
          reasoning: score.rating,
          algorithmVersion: 'realtime-v1.0',
          calculatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.ipoScores.ipoId,
          set: {
            totalScore,
            fundamentalScore,
            sentimentScore,
            subscriptionScore,
            sectorScore,
            verdict,
            confidence,
            reasoning: score.rating,
            calculatedAt: new Date(),
            algorithmVersion: 'realtime-v1.0',
            updatedAt: new Date(),
          },
        });

      console.log(`[Score] Saved to database: ${ipoId} (total: ${totalScore}/100)`);
    } catch (error) {
      console.error(`[Score] Failed to save score for ${ipoId}:`, error);
      throw error;
    }
  }

  /**
   * Cache score with TTL based on IPO status
   */
  private async cacheScore(
    ipoId: string,
    score: ScoreComponents,
    status: string
  ): Promise<void> {
    const ttl = this.getTTL(status);
    const cacheKey = `ipo:score:realtime:${ipoId}`;

    try {
      await this.setCache(cacheKey, score, ttl);
      console.log(`[Score] Cached: ${ipoId} (TTL: ${ttl}s, status: ${status})`);
    } catch (error) {
      console.error(`[Score] Failed to cache score for ${ipoId}:`, error);
      // Don't throw - caching is non-critical
    }
  }

  /**
   * Get TTL based on IPO status
   */
  private getTTL(status: string): number {
    switch (status) {
      case 'UPCOMING':
        return SCORE_TTL.UPCOMING;
      case 'OPEN':
        return SCORE_TTL.OPEN;
      case 'CLOSED':
        return SCORE_TTL.CLOSED;
      case 'LISTED':
        return SCORE_TTL.LISTED;
      default:
        return SCORE_TTL.CLOSED;
    }
  }

  /**
   * Invalidate score cache for an IPO
   */
  async invalidateScore(ipoId: string): Promise<void> {
    const cacheKey = `ipo:score:realtime:${ipoId}`;
    await this.deleteCache(cacheKey);
    console.log(`[Score] Invalidated cache: ${ipoId}`);
  }

  /**
   * Get scores for multiple IPOs (batch)
   */
  async getBatchScores(ipoIds: string[]): Promise<Map<string, ScoreComponents>> {
    const scoreMap = new Map<string, ScoreComponents>();

    // Process in parallel (but limit concurrency to avoid overwhelming DB)
    const BATCH_SIZE = 5;
    for (let i = 0; i < ipoIds.length; i += BATCH_SIZE) {
      const batch = ipoIds.slice(i, i + BATCH_SIZE);
      const scores = await Promise.all(
        batch.map((id) => this.getOrCalculateScore(id).catch((err) => {
          console.error(`[Score] Failed to get score for ${id}:`, err);
          return null;
        }))
      );

      batch.forEach((id, index) => {
        if (scores[index]) {
          scoreMap.set(id, scores[index]!);
        }
      });
    }

    return scoreMap;
  }

  /**
   * Helper: Map verdict to rating label
   */
  private getRatingFromVerdict(verdict: string): string {
    switch (verdict) {
      case 'APPLY':
        return 'Exceptional (Invest)';
      case 'CONSIDER':
        return 'Strong (Consider)';
      case 'SKIP':
        return 'Poor (Avoid)';
      default:
        return 'Average (Neutral)';
    }
  }

  /**
   * Helper: Map rating label to verdict
   */
  private getVerdictFromRating(rating: string): 'APPLY' | 'CONSIDER' | 'SKIP' {
    if (rating.includes('Exceptional') || rating.includes('Strong')) {
      return 'APPLY';
    }
    if (rating.includes('Good') || rating.includes('Average') || rating.includes('Consider')) {
      return 'CONSIDER';
    }
    return 'SKIP';
  }

  /**
   * Helper: Map confidence level to percentage
   */
  private getConfidencePercentage(level: string): number {
    switch (level) {
      case 'HIGH':
        return 85;
      case 'MEDIUM':
        return 65;
      case 'LOW':
        return 40;
      default:
        return 50;
    }
  }

  /**
   * Helper: Map confidence percentage to level
   */
  private getConfidenceLevelFromPercentage(percentage: number): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (percentage >= 75) return 'HIGH';
    if (percentage >= 50) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Helper: Round to decimal places
   */
  private roundToDecimal(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}
