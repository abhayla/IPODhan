/**
 * POST /api/tools/compare API Route
 *
 * Compares 2-3 IPOs side-by-side with detailed metrics.
 * Aggregates data from IPO, Subscription, GMP, and Financial repositories.
 *
 * @route POST /api/tools/compare
 *
 * @requestbody {ComparisonRequest} Request body with IPO slugs array
 * @requestbody.ipoSlugs {string[]} Array of 2-3 IPO slugs to compare
 *
 * @returns {ComparisonResponse} JSON response with comparison data
 *
 * @example
 * POST /api/tools/compare
 * {
 *   "ipoSlugs": ["company-a-ipo", "company-b-ipo"]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
// TEMPORARILY DISABLED: Sentry causing module loading errors
// import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
import { IpoFinancialsRepository } from '@/lib/repositories/ipo-financials-repository'; // Story 4.10
import { DatabaseError, EntityNotFoundError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import {
  ComparisonRequestSchema,
  VALID_COMPARISON_STATUSES,
  type ComparisonResponse,
  type IPOComparison,
} from '@/lib/types/comparison';
import type { FinancialData } from '@/lib/repositories/types';

// ==================== ERROR RESPONSE TYPE ====================

interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate revenue growth percentage from yearly financial data
 */
function calculateRevenueGrowth(financialData: FinancialData | null): number | null {
  if (!financialData) return null;

  // Parse revenue values from string to number
  const fy2022 = financialData.revenueFy2022 ? parseFloat(financialData.revenueFy2022) : null;
  const fy2023 = financialData.revenueFy2023 ? parseFloat(financialData.revenueFy2023) : null;
  const fy2024 = financialData.revenueFy2024 ? parseFloat(financialData.revenueFy2024) : null;

  // Calculate CAGR if we have 3 years of data
  if (fy2022 && fy2024) {
    const years = 2; // From FY2022 to FY2024
    const growth = ((fy2024 / fy2022) ** (1 / years) - 1) * 100;
    return Math.round(growth * 100) / 100; // Round to 2 decimal places
  }

  // Calculate single-year growth if we only have 2 years
  if (fy2022 && fy2023) {
    const growth = ((fy2023 - fy2022) / fy2022) * 100;
    return Math.round(growth * 100) / 100;
  }

  return null;
}

/**
 * Fetch comparison data for a single IPO
 * Story 4.10: Added ipoFinancialsRepo parameter and ipoFinancials field
 */
async function fetchIPOComparisonData(
  slug: string,
  ipoRepo: IPORepository,
  subscriptionRepo: SubscriptionRepository,
  gmpRepo: GMPRepository,
  financialRepo: FinancialDataRepository,
  ipoFinancialsRepo: IpoFinancialsRepository
): Promise<IPOComparison> {
  // Fetch IPO data
  const ipo = await ipoRepo.findBySlug(slug);
  if (!ipo) {
    throw new EntityNotFoundError('IPO', slug);
  }

  // Validate IPO status
  if (!VALID_COMPARISON_STATUSES.includes(ipo.status as 'OPEN' | 'UPCOMING' | 'CLOSED')) {
    throw new Error(`IPO "${ipo.companyName}" has invalid status "${ipo.status}" for comparison. Only OPEN, UPCOMING, and CLOSED IPOs can be compared.`);
  }

  // Fetch related data in parallel (Story 4.10: Added ipoFinancials)
  const [latestSubscription, gmpRecords, financialData, ipoFinancialsData] = await Promise.all([
    subscriptionRepo.findLatest(ipo.id).catch(() => null),
    gmpRepo.findByIPO({ ipoId: ipo.id, limit: 1 }).catch(() => []),
    financialRepo.findByIPO(ipo.id).catch(() => null),
    ipoFinancialsRepo.findByIPO(ipo.id).catch(() => null),
  ]);

  // Extract GMP value
  const latestGMP = gmpRecords.length > 0 ? gmpRecords[0].gmp : null;

  // Build comparison object
  const comparison: IPOComparison = {
    slug: ipo.slug,
    companyName: ipo.companyName,
    priceRange: {
      min: ipo.priceRangeMin ?? 0,
      max: ipo.priceRangeMax ?? 0,
    },
    lotSize: ipo.lotSize ?? 0,
    status: ipo.status,
    subscription: {
      qib: latestSubscription?.qibSubscription ? parseFloat(String(latestSubscription.qibSubscription)) : null,
      nii: latestSubscription?.niiSubscription ? parseFloat(String(latestSubscription.niiSubscription)) : null,
      retail: latestSubscription?.retailSubscription ? parseFloat(String(latestSubscription.retailSubscription)) : null,
      total: latestSubscription?.totalSubscription ? parseFloat(String(latestSubscription.totalSubscription)) : null,
    },
    gmp: latestGMP,
    financials: {
      peRatio: financialData?.peRatio ? parseFloat(financialData.peRatio) : null,
      roe: financialData?.roe ? parseFloat(financialData.roe) : null,
      revenueGrowth: calculateRevenueGrowth(financialData),
      eps: financialData?.eps ? parseFloat(financialData.eps) : null,
    },
    // Story 4.10: Enhanced financial metrics
    ipoFinancials: ipoFinancialsData
      ? {
          pbRatio: ipoFinancialsData.pbRatio ? parseFloat(String(ipoFinancialsData.pbRatio)) : null,
          rocePercentage: ipoFinancialsData.rocePercentage ? parseFloat(String(ipoFinancialsData.rocePercentage)) : null,
          industryPe: ipoFinancialsData.industryPe ? parseFloat(String(ipoFinancialsData.industryPe)) : null,
        }
      : null,
    rating: ipo.rating ?? null,
    ratingRationale: ipo.ratingRationale ?? null,
  };

  return comparison;
}

// ==================== API ROUTE HANDLER ====================

/**
 * POST handler for IPO comparison
 */
export async function POST(request: NextRequest): Promise<NextResponse<ComparisonResponse | ErrorResponse>> {
  const requestId = crypto.randomUUID();

  try {
    // Parse request body
    const body = await request.json();

    // Validate request
    const validationResult = ComparisonRequestSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn({
        msg: 'Invalid comparison request',
        requestId,
        errors: validationResult.error.issues,
      });

      return NextResponse.json(
        {
          error: 'Validation Error',
          message: validationResult.error.issues[0].message,
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { ipoSlugs } = validationResult.data;

    logger.info({
      msg: 'Processing comparison request',
      requestId,
      slugs: ipoSlugs,
    });

    // Initialize repositories (Story 4.10: Added ipoFinancialsRepo)
    const redis = getRedisClient();
    const ipoRepo = new IPORepository(db, redis);
    const subscriptionRepo = new SubscriptionRepository(db, redis);
    const gmpRepo = new GMPRepository(db, redis);
    const financialRepo = new FinancialDataRepository(db, redis);
    const ipoFinancialsRepo = new IpoFinancialsRepository(db, redis);

    // Fetch comparison data for all IPOs in parallel
    const comparisons = await Promise.all(
      ipoSlugs.map((slug) =>
        fetchIPOComparisonData(slug, ipoRepo, subscriptionRepo, gmpRepo, financialRepo, ipoFinancialsRepo)
      )
    );

    // Build response
    const response: ComparisonResponse = {
      comparisons,
      comparedAt: new Date().toISOString(),
    };

    logger.info({
      msg: 'Comparison request successful',
      requestId,
      count: comparisons.length,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // Handle EntityNotFoundError
    if (error instanceof EntityNotFoundError) {
      logger.warn({
        msg: 'IPO not found for comparison',
        requestId,
        error: error.message,
      });

      return NextResponse.json(
        {
          error: 'Not Found',
          message: error.message,
        },
        { status: 404 }
      );
    }

    // Handle validation errors
    if (error instanceof Error && error.message.includes('invalid status')) {
      logger.warn({
        msg: 'Invalid IPO status for comparison',
        requestId,
        error: error.message,
      });

      return NextResponse.json(
        {
          error: 'Validation Error',
          message: error.message,
        },
        { status: 400 }
      );
    }

    // Handle database errors
    if (error instanceof DatabaseError) {
      logger.error({
        msg: 'Database error during comparison',
        requestId,
        error: error.message,
      });

      // TEMPORARILY DISABLED: Sentry causing module loading errors
      // Sentry.captureException(error, {
      //   tags: {
      //     route: '/api/tools/compare',
      //     requestId,
      //   },
      // });

      return NextResponse.json(
        {
          error: 'Database Error',
          message: 'Failed to fetch comparison data',
        },
        { status: 500 }
      );
    }

    // Handle unexpected errors
    logger.error({
      msg: 'Unexpected error during comparison',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    // TEMPORARILY DISABLED: Sentry causing module loading errors
    // Sentry.captureException(error, {
    //   tags: {
    //     route: '/api/tools/compare',
    //     requestId,
    //   },
    // });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while processing comparison',
      },
      { status: 500 }
    );
  }
}
