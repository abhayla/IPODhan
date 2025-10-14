/**
 * IPO Score Service (Story 4.7)
 * Business logic layer for IPO scoring system
 */

import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPOScoreRepository } from '@/lib/repositories/ipo-score-repository';
import type { IPOScore, NewIPOScore, IPOVerdict } from '@/lib/db/types';
import type { ScoreRange } from '@/lib/utils/score-utils';
import { isScoreInRange } from '@/lib/utils/score-utils';

/**
 * Get IPO score by IPO ID
 */
export async function getIPOScore(ipoId: string): Promise<IPOScore | null> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  return repository.findByIPOId(ipoId);
}

/**
 * Get scores for multiple IPOs
 */
export async function getBatchIPOScores(
  ipoIds: string[]
): Promise<Map<string, IPOScore>> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  return repository.findByIPOIds(ipoIds);
}

/**
 * Get filtered IPO scores
 */
export async function getFilteredScores(filters?: {
  scoreRange?: ScoreRange;
  verdict?: IPOVerdict;
  limit?: number;
  offset?: number;
}): Promise<IPOScore[]> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  // Convert score range to min/max
  let minScore: number | undefined;
  let maxScore: number | undefined;

  if (filters?.scoreRange && filters.scoreRange !== 'all') {
    const [min, max] = filters.scoreRange.split('-').map(Number);
    minScore = min;
    maxScore = max;
  }

  return repository.findAll({
    minScore,
    maxScore,
    verdict: filters?.verdict,
    limit: filters?.limit,
    offset: filters?.offset,
  });
}

/**
 * Create or update IPO score
 */
export async function upsertIPOScore(
  data: NewIPOScore
): Promise<IPOScore> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  return repository.upsert(data);
}

/**
 * Get score statistics
 */
export async function getScoreStatistics(): Promise<{
  minScore: number;
  maxScore: number;
  avgScore: number;
  count: number;
  verdictCounts: Record<string, number>;
}> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  const [stats, verdictCounts] = await Promise.all([
    repository.getStatistics(),
    repository.countByVerdict(),
  ]);

  return {
    ...stats,
    verdictCounts,
  };
}

/**
 * Delete IPO score
 */
export async function deleteIPOScore(ipoId: string): Promise<void> {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new IPOScoreRepository(db, redis);

  return repository.delete(ipoId);
}
