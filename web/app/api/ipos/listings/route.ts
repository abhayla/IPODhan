/**
 * GET /api/ipos/listings API Route
 *
 * Provides IPO listings with comprehensive performance data including
 * subscription, GMP, and listing performance metrics.
 *
 * @route GET /api/ipos/listings
 *
 * @queryparam {string} [category] - Filter by category (MAINBOARD, SME, RIGHTS, NCD)
 * @queryparam {string} [year] - Filter by listing year
 * @queryparam {number} [page=1] - Page number
 * @queryparam {number} [limit=50] - Results per page
 * @queryparam {string} [sortBy=listingDate] - Sort field
 * @queryparam {string} [sortOrder=desc] - Sort direction
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/index';
import { ipos, listingPerformance, subscriptions, gmpRecords } from '@/lib/db/schema';
import { eq, and, gte, lte, desc, asc, sql, inArray } from 'drizzle-orm';

// Validation schemas - match database schema enum
const CategorySchema = z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO']);
const SortFieldSchema = z.enum(['listingDate', 'listingDayGain', 'currentGain', 'issueSize', 'companyName']);
const SortOrderSchema = z.enum(['asc', 'desc']);

const QueryParamsSchema = z.object({
  category: CategorySchema.optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: SortFieldSchema.default('listingDate'),
  sortOrder: SortOrderSchema.default('desc'),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

function parseQueryParams(searchParams: URLSearchParams): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  const category = searchParams.get('category');
  if (category) params.category = category;

  const year = searchParams.get('year');
  if (year) params.year = year;

  const page = searchParams.get('page');
  if (page) params.page = page;

  const limit = searchParams.get('limit');
  if (limit) params.limit = limit;

  const sortBy = searchParams.get('sortBy');
  if (sortBy) params.sortBy = sortBy;

  const sortOrder = searchParams.get('sortOrder');
  if (sortOrder) params.sortOrder = sortOrder;

  return params;
}

export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const rawParams = parseQueryParams(searchParams);

    let validatedParams: QueryParams;
    try {
      validatedParams = QueryParamsSchema.parse(rawParams);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid query parameters', details: error.issues },
          { status: 400 }
        );
      }
      throw error;
    }

    // Build where conditions
    const whereConditions = [];

    // Filter by category
    if (validatedParams.category) {
      whereConditions.push(eq(ipos.category, validatedParams.category));
    }

    // Filter by year
    if (validatedParams.year) {
      const yearNum = parseInt(validatedParams.year);
      whereConditions.push(
        sql`EXTRACT(YEAR FROM ${ipos.listingDate}) = ${yearNum}`
      );
    }

    // Only include listed IPOs
    whereConditions.push(eq(ipos.status, 'LISTED'));

    // Combine conditions
    const whereClause = whereConditions.length > 0
      ? and(...whereConditions)
      : undefined;

    // Determine sort order
    const sortOrder = validatedParams.sortOrder === 'asc' ? asc : desc;
    let orderByClause;

    switch (validatedParams.sortBy) {
      case 'listingDate':
        orderByClause = sortOrder(ipos.listingDate);
        break;
      case 'listingDayGain':
        orderByClause = sortOrder(listingPerformance.listingGainPercent);
        break;
      case 'currentGain':
        orderByClause = sortOrder(listingPerformance.currentGainPercent);
        break;
      case 'issueSize':
        orderByClause = sortOrder(ipos.issueSize);
        break;
      case 'companyName':
        orderByClause = sortOrder(ipos.companyName);
        break;
      default:
        orderByClause = desc(ipos.listingDate);
    }

    // Calculate pagination
    const offset = (validatedParams.page - 1) * validatedParams.limit;

    // Fetch total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(whereClause);

    const total = Number(countResult[0]?.count || 0);

    // Fetch IPO listings with related data
    const ipoListings = await db
      .select({
        // IPO fields
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        category: ipos.category,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
        listingDate: ipos.listingDate,
        issuePrice: ipos.priceRangeMax,
        issueSize: ipos.issueSize,
        lotSize: ipos.lotSize,
        allotmentDate: ipos.allotmentDate,

        // Listing performance fields
        listingPrice: listingPerformance.listingPrice,
        listingGainPercent: listingPerformance.listingGainPercent,
        currentPrice: listingPerformance.currentPrice,
        currentPriceBSE: listingPerformance.currentPriceBSE,
        currentPriceNSE: listingPerformance.currentPriceNSE,
        currentGainPercent: listingPerformance.currentGainPercent,
      })
      .from(ipos)
      .leftJoin(listingPerformance, eq(ipos.id, listingPerformance.ipoId))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(validatedParams.limit)
      .offset(offset);

    // Fetch subscription and GMP data for these IPOs
    const ipoIds = ipoListings.map((ipo) => ipo.id);

    let subscriptionData: any[] = [];
    let gmpData: any[] = [];

    if (ipoIds.length > 0) {
      // Fetch latest subscription data for each IPO
      subscriptionData = await db
        .select({
          ipoId: subscriptions.ipoId,
          totalSubscription: subscriptions.totalSubscription,
          qibSubscription: subscriptions.qibSubscription,
          niiSubscription: subscriptions.niiSubscription,
          retailSubscription: subscriptions.retailSubscription,
        })
        .from(subscriptions)
        .where(inArray(subscriptions.ipoId, ipoIds))
        .orderBy(desc(subscriptions.timestamp));

      // Fetch latest GMP data for each IPO
      gmpData = await db
        .select({
          ipoId: gmpRecords.ipoId,
          gmp: gmpRecords.gmp,
        })
        .from(gmpRecords)
        .where(inArray(gmpRecords.ipoId, ipoIds))
        .orderBy(desc(gmpRecords.timestamp));
    }

    // Create maps for quick lookup
    const subscriptionMap = new Map();
    subscriptionData.forEach((sub) => {
      if (!subscriptionMap.has(sub.ipoId)) {
        subscriptionMap.set(sub.ipoId, sub);
      }
    });

    const gmpMap = new Map();
    gmpData.forEach((gmp) => {
      if (!gmpMap.has(gmp.ipoId)) {
        gmpMap.set(gmp.ipoId, gmp);
      }
    });

    // Combine data
    const data = ipoListings.map((ipo) => {
      const subscription = subscriptionMap.get(ipo.id);
      const gmpRecord = gmpMap.get(ipo.id);

      return {
        id: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        category: ipo.category,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
        listingDate: ipo.listingDate,
        issuePrice: ipo.issuePrice ? Number(ipo.issuePrice) : null,
        issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
        lotSize: ipo.lotSize,
        allotmentDate: ipo.allotmentDate,

        // Subscription data
        subscriptionOverall: subscription?.totalSubscription ? Number(subscription.totalSubscription) : null,
        subscriptionQIB: subscription?.qibSubscription ? Number(subscription.qibSubscription) : null,
        subscriptionNII: subscription?.niiSubscription ? Number(subscription.niiSubscription) : null,
        subscriptionRetail: subscription?.retailSubscription ? Number(subscription.retailSubscription) : null,

        // GMP data
        gmp: gmpRecord?.gmp || null,

        // Listing performance
        listingDayClosePrice: ipo.listingPrice || null,
        listingDayGainPercent: ipo.listingGainPercent ? Number(ipo.listingGainPercent) : null,
        currentPriceBSE: ipo.currentPriceBSE || null,
        currentPriceNSE: ipo.currentPriceNSE || null,
        currentGainPercent: ipo.currentGainPercent ? Number(ipo.currentGainPercent) : null,
        // Calculate market cap estimate: issueSize * (currentPrice / issuePrice)
        marketCap: ipo.issueSize && ipo.issuePrice && (ipo.currentPriceBSE || ipo.currentPriceNSE)
          ? Number(ipo.issueSize) * ((ipo.currentPriceBSE || ipo.currentPriceNSE!) / Number(ipo.issuePrice))
          : null,
      };
    });

    // Calculate stats
    const avgListingGain = data.length > 0
      ? data.reduce((sum, ipo) => sum + (ipo.listingDayGainPercent || 0), 0) / data.length
      : null;

    const totalGainers = data.filter((ipo) => (ipo.listingDayGainPercent || 0) > 0).length;
    const totalLosers = data.filter((ipo) => (ipo.listingDayGainPercent || 0) < 0).length;

    const response = {
      data,
      pagination: {
        page: validatedParams.page,
        limit: validatedParams.limit,
        total,
        hasMore: offset + data.length < total,
      },
      stats: {
        totalIPOs: total,
        avgListingGain,
        totalGainers,
        totalLosers,
      },
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching IPO listings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch IPO listings' },
      { status: 500 }
    );
  }
}
