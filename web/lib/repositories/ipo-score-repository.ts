/**
 * IPO Score Repository (Story 4.7)
 * Data access layer for IPO scoring system with caching
 */

import { eq, and, gte, lte, desc, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';
import type { IPOScore, NewIPOScore, IPOVerdict } from '@/lib/db/types';
import {
  getIPOScoreKey,
  getIPOScoreInvalidationKeys,
  CacheTTL,
} from '@/lib/cache/cache-keys';

export class IPOScoreRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Get IPO score by IPO ID
   */
  async findByIPOId(ipoId: string): Promise<IPOScore | null> {
    const cacheKey = getIPOScoreKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery('findScoreByIPOId', async () => {
          const result = await this.db
            .select()
            .from(schema.ipoScores)
            .where(eq(schema.ipoScores.ipoId, ipoId))
            .limit(1);

          return result[0] || null;
        });
      },
      CacheTTL.IPO_SCORE
    );
  }

  /**
   * Get all IPO scores with filters
   */
  async findAll(filters?: {
    minScore?: number;
    maxScore?: number;
    verdict?: IPOVerdict;
    limit?: number;
    offset?: number;
  }): Promise<IPOScore[]> {
    return this.executeQuery(
      'findAllScores',
      async () => {
        let query = this.db.select().from(schema.ipoScores);

        // Apply filters
        const conditions = [];

        if (filters?.minScore !== undefined) {
          conditions.push(gte(schema.ipoScores.totalScore, filters.minScore));
        }

        if (filters?.maxScore !== undefined) {
          conditions.push(lte(schema.ipoScores.totalScore, filters.maxScore));
        }

        if (filters?.verdict) {
          conditions.push(eq(schema.ipoScores.verdict, filters.verdict));
        }

        if (conditions.length > 0) {
          query = query.where(and(...conditions)) as typeof query;
        }

        // Sort by calculated date (most recent first)
        query = query.orderBy(desc(schema.ipoScores.calculatedAt)) as typeof query;

        // Pagination
        if (filters?.limit) {
          query = query.limit(filters.limit) as typeof query;
        }

        if (filters?.offset) {
          query = query.offset(filters.offset) as typeof query;
        }

        return query;
      },
      filters
    );
  }

  /**
   * Create a new IPO score
   */
  async create(data: NewIPOScore): Promise<IPOScore> {
    return this.executeQuery(
      'createScore',
      async () => {
        const result = await this.db
          .insert(schema.ipoScores)
          .values(data)
          .returning();

        const newScore = result[0];

        // Invalidate related caches
        await this.invalidateCache(getIPOScoreInvalidationKeys(data.ipoId));

        return newScore;
      },
      { ipoId: data.ipoId }
    );
  }

  /**
   * Update an existing IPO score
   */
  async update(ipoId: string, data: Partial<NewIPOScore>): Promise<IPOScore> {
    return this.executeQuery(
      'updateScore',
      async () => {
        const result = await this.db
          .update(schema.ipoScores)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(schema.ipoScores.ipoId, ipoId))
          .returning();

        const updatedScore = result[0];

        // Invalidate related caches
        await this.invalidateCache(getIPOScoreInvalidationKeys(ipoId));

        return updatedScore;
      },
      { ipoId }
    );
  }

  /**
   * Upsert IPO score (insert or update)
   */
  async upsert(data: NewIPOScore): Promise<IPOScore> {
    return this.executeQuery(
      'upsertScore',
      async () => {
        const result = await this.db
          .insert(schema.ipoScores)
          .values(data)
          .onConflictDoUpdate({
            target: schema.ipoScores.ipoId,
            set: {
              totalScore: data.totalScore,
              fundamentalScore: data.fundamentalScore,
              sentimentScore: data.sentimentScore,
              subscriptionScore: data.subscriptionScore,
              sectorScore: data.sectorScore,
              verdict: data.verdict,
              confidence: data.confidence,
              reasoning: data.reasoning,
              calculatedAt: new Date(),
              algorithmVersion: data.algorithmVersion,
              updatedAt: new Date(),
            },
          })
          .returning();

        const upsertedScore = result[0];

        // Invalidate related caches
        await this.invalidateCache(getIPOScoreInvalidationKeys(data.ipoId));

        return upsertedScore;
      },
      { ipoId: data.ipoId }
    );
  }

  /**
   * Delete IPO score
   */
  async delete(ipoId: string): Promise<void> {
    return this.executeQuery('deleteScore', async () => {
      await this.db
        .delete(schema.ipoScores)
        .where(eq(schema.ipoScores.ipoId, ipoId));

      // Invalidate related caches
      await this.invalidateCache(getIPOScoreInvalidationKeys(ipoId));
    });
  }

  /**
   * Get scores for multiple IPOs
   */
  async findByIPOIds(ipoIds: string[]): Promise<Map<string, IPOScore>> {
    return this.executeQuery(
      'findScoresByIPOIds',
      async () => {
        if (ipoIds.length === 0) {
          return new Map();
        }

        const scores = await this.db
          .select()
          .from(schema.ipoScores)
          .where(
            inArray(schema.ipoScores.ipoId, ipoIds)
          );

        // Convert to map for easy lookup
        const scoreMap = new Map<string, IPOScore>();
        for (const score of scores) {
          scoreMap.set(score.ipoId, score);
        }

        return scoreMap;
      },
      { ipoCount: ipoIds.length }
    );
  }

  /**
   * Count scores by verdict
   */
  async countByVerdict(): Promise<Record<string, number>> {
    return this.executeQuery('countScoresByVerdict', async () => {
      const results = await this.db
        .select({
          verdict: schema.ipoScores.verdict,
          count: schema.ipoScores.id,
        })
        .from(schema.ipoScores);

      const counts: Record<string, number> = {
        APPLY: 0,
        CONSIDER: 0,
        SKIP: 0,
      };

      // Group results by verdict
      for (const result of results) {
        if (result.verdict in counts) {
          counts[result.verdict]++;
        }
      }

      return counts;
    });
  }

  /**
   * Get score statistics (min, max, average)
   */
  async getStatistics(): Promise<{
    minScore: number;
    maxScore: number;
    avgScore: number;
    count: number;
  }> {
    return this.executeQuery('getScoreStatistics', async () => {
      const scores = await this.db
        .select({ totalScore: schema.ipoScores.totalScore })
        .from(schema.ipoScores);

      if (scores.length === 0) {
        return {
          minScore: 0,
          maxScore: 0,
          avgScore: 0,
          count: 0,
        };
      }

      const totalScores = scores.map((s) => s.totalScore);
      const minScore = Math.min(...totalScores);
      const maxScore = Math.max(...totalScores);
      const avgScore = Math.round(
        totalScores.reduce((a, b) => a + b, 0) / totalScores.length
      );

      return {
        minScore,
        maxScore,
        avgScore,
        count: scores.length,
      };
    });
  }
}
