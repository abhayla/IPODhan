/**
 * Real-Time IPO Score API Endpoint (Phase 5)
 *
 * GET /api/ipos/[slug]/score
 *
 * Returns comprehensive real-time scoring data for an IPO including:
 * - Total score (0-10)
 * - Component breakdown (Financial, Valuation, Subscription, Market, Fundamentals)
 * - Rating label and interpretation
 * - Confidence score based on data completeness
 *
 * @route GET /api/ipos/:slug/score
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPOScoreRealtimeRepository } from '@/lib/repositories/ipo-score-realtime-repository';
import { IPOScoringService } from '@/lib/services/ipo-scoring-realtime';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const startTime = Date.now();

  try {
    const { slug } = await context.params;

    if (!slug) {
      return NextResponse.json(
        { error: 'IPO slug is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const redis = getRedisClient();

    // Get IPO by slug
    const [ipo] = await db
      .select()
      .from(ipos)
      .where(eq(ipos.slug, slug))
      .limit(1);

    if (!ipo) {
      return NextResponse.json(
        {
          error: 'IPO not found',
          message: `No IPO found with slug: ${slug}`,
        },
        { status: 404 }
      );
    }

    // Get or calculate score
    const scoreRepo = new IPOScoreRealtimeRepository(db, redis);
    const score = await scoreRepo.getOrCalculateScore(ipo.id);

    // Get interpretation
    const scoringService = new IPOScoringService(db);
    const interpretation = scoringService.getScoreInterpretation(score.total);

    const executionTime = Date.now() - startTime;

    return NextResponse.json(
      {
        success: true,
        data: {
          ipoId: ipo.id,
          companyName: ipo.companyName,
          slug: ipo.slug,
          status: ipo.status,
          score: {
            total: score.total,
            rating: score.rating,
            confidence: score.confidence,
            components: {
              financialStrength: {
                score: score.financialStrength,
                maxScore: 3,
                percentage: Math.round((score.financialStrength / 3) * 100),
                breakdown: {
                  revenueGrowth: score.breakdown.revenueGrowth,
                  profitability: score.breakdown.profitability,
                  roe: score.breakdown.roe,
                },
              },
              valuation: {
                score: score.valuation,
                maxScore: 2,
                percentage: Math.round((score.valuation / 2) * 100),
                breakdown: {
                  peValuation: score.breakdown.peValuation,
                  priceToBook: score.breakdown.priceToBook,
                },
              },
              subscriptionDemand: {
                score: score.subscriptionDemand,
                maxScore: 2,
                percentage: Math.round((score.subscriptionDemand / 2) * 100),
                breakdown: {
                  overallSubscription: score.breakdown.overallSubscription,
                  qibSubscription: score.breakdown.qibSubscription,
                },
              },
              marketPerformance: {
                score: score.marketPerformance,
                maxScore: 2,
                percentage: Math.round((score.marketPerformance / 2) * 100),
                breakdown: {
                  gmpPremium: score.breakdown.gmpPremium,
                  listingGains: score.breakdown.listingGains,
                },
              },
              fundamentals: {
                score: score.fundamentals,
                maxScore: 1,
                percentage: Math.round((score.fundamentals / 1) * 100),
                breakdown: {
                  issueSize: score.breakdown.issueSize,
                  companyAge: score.breakdown.companyAge,
                },
              },
            },
          },
          interpretation,
          metadata: {
            executionTime: `${executionTime}ms`,
            timestamp: new Date().toISOString(),
            algorithmVersion: 'realtime-v1.0',
          },
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        },
      }
    );
  } catch (error) {
    console.error('[API] Score calculation error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to calculate IPO score',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
