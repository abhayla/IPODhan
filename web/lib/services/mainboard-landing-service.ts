/**
 * Mainboard IPOs Landing Page Service
 *
 * Service layer for fetching all data required for the Mainboard IPOs landing page.
 * Includes summary metrics, content sections, performance highlights, and detailed listings.
 */

import { db } from '@/lib/db';
import { ipos, ipoReviews, listingPerformance, subscriptions } from '@/lib/db/schema';
import { eq, and, desc, sql, gte, lte, isNotNull, like } from 'drizzle-orm';

// ===== TYPE DEFINITIONS =====

export interface MainboardSummaryMetrics {
  totalIPOs: number;
  listedInGain: number;
  listedInLoss: number;
  upcomingAndOngoing: number;
  gainAOT: number; // Average gain percentage (All Over Time)
  lossAOT: number; // Average loss percentage (All Over Time)
}

export interface IPO {
  id: string;
  companyName: string;
  slug: string;
  category: string;
  sector: string | null;
  issueSize: string | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  listingExchanges: ('NSE' | 'BSE')[] | null;
  leadManagers: string[] | null;
}

export interface ReviewWithIPO {
  id: string;
  reviewTitle: string;
  author: string;
  recommendation: string;
  ipoId: string;
  ipoName: string;
  ipoSlug: string;
  publishedDate: Date;
  year: number;
  reviewUrl?: string | null;
}

export interface PerformanceHighlight {
  ipoId: string;
  companyName: string;
  slug: string;
  issuePrice: number;
  listingPrice: number;
  currentPrice: number;
  gainPercent: number;
  listingDate: string | null;
}

export interface SubscriptionStatusData {
  ipoId: string;
  companyName: string;
  slug: string;
  totalSubscription: number | null;
  qibSubscription: number | null;
  niiSubscription: number | null;
  retailSubscription: number | null;
  timestamp: Date;
}

export interface DetailedTableFilters {
  year?: number;
  companySearch?: string;
  leadManagerSearch?: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

// ===== CONSTANTS =====

const CACHE_TTL = 300; // 5 minutes in seconds

// ===== SERVICE FUNCTIONS =====

/**
 * Get Mainboard Summary Metrics
 *
 * Calculates 6 key metrics for Mainboard IPOs:
 * - Total Mainboard IPOs
 * - IPOs Listed in Gain
 * - IPOs Listed in Loss
 * - Upcoming & Ongoing IPOs
 * - Average Gain % (All Over Time)
 * - Average Loss % (All Over Time)
 *
 * @returns Promise with summary metrics
 */
export async function getMainboardSummaryMetrics(): Promise<MainboardSummaryMetrics> {
  try {
    // Fetch all Mainboard IPOs with listing performance data
    const allMainboardIPOs = await db
      .select({
        id: ipos.id,
        status: ipos.status,
        issuePrice: listingPerformance.issuePrice,
        currentPrice: listingPerformance.currentPrice,
        currentGainPercent: listingPerformance.currentGainPercent,
      })
      .from(ipos)
      .leftJoin(listingPerformance, eq(ipos.id, listingPerformance.ipoId))
      .where(eq(ipos.category, 'MAINBOARD'));

    // Calculate metrics
    const totalIPOs = allMainboardIPOs.length;

    const listedIPOs = allMainboardIPOs.filter(
      (ipo) => ipo.status === 'LISTED' && ipo.currentPrice !== null
    );

    const listedInGain = listedIPOs.filter(
      (ipo) => ipo.currentPrice! > ipo.issuePrice!
    ).length;

    const listedInLoss = listedIPOs.filter(
      (ipo) => ipo.currentPrice! < ipo.issuePrice!
    ).length;

    const upcomingAndOngoing = allMainboardIPOs.filter(
      (ipo) => ipo.status === 'UPCOMING' || ipo.status === 'OPEN'
    ).length;

    // Calculate average gain % (only positive gains)
    const iposWithGain = listedIPOs.filter(
      (ipo) => ipo.currentGainPercent && parseFloat(ipo.currentGainPercent) > 0
    );
    const gainAOT =
      iposWithGain.length > 0
        ? iposWithGain.reduce(
            (sum, ipo) => sum + parseFloat(ipo.currentGainPercent!),
            0
          ) / iposWithGain.length
        : 0;

    // Calculate average loss % (only negative gains)
    const iposWithLoss = listedIPOs.filter(
      (ipo) => ipo.currentGainPercent && parseFloat(ipo.currentGainPercent) < 0
    );
    const lossAOT =
      iposWithLoss.length > 0
        ? Math.abs(
            iposWithLoss.reduce(
              (sum, ipo) => sum + parseFloat(ipo.currentGainPercent!),
              0
            ) / iposWithLoss.length
          )
        : 0;

    return {
      totalIPOs,
      listedInGain,
      listedInLoss,
      upcomingAndOngoing,
      gainAOT: Math.round(gainAOT * 100) / 100, // Round to 2 decimal places
      lossAOT: Math.round(lossAOT * 100) / 100,
    };
  } catch (error) {
    console.error('Error fetching Mainboard summary metrics:', error);
    return {
      totalIPOs: 0,
      listedInGain: 0,
      listedInLoss: 0,
      upcomingAndOngoing: 0,
      gainAOT: 0,
      lossAOT: 0,
    };
  }
}

/**
 * Get Current Mainboard IPOs (Status: OPEN)
 *
 * Returns up to 6 current (open) Mainboard IPOs sorted by close date (closing soonest first).
 *
 * @returns Promise with array of current IPOs
 */
export async function getMainboardCurrentIPOs(): Promise<IPO[]> {
  try {
    const results = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        category: ipos.category,
        sector: ipos.sector,
        issueSize: ipos.issueSize,
        priceRangeMin: ipos.priceRangeMin,
        priceRangeMax: ipos.priceRangeMax,
        lotSize: ipos.lotSize,
        status: ipos.status,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
        allotmentDate: ipos.allotmentDate,
        listingDate: ipos.listingDate,
        listingExchanges: ipos.listingExchanges,
        leadManagers: ipos.leadManagers,
      })
      .from(ipos)
      .where(and(eq(ipos.category, 'MAINBOARD'), eq(ipos.status, 'OPEN')))
      .orderBy(ipos.closeDate) // Closing soonest first
      .limit(6);

    return results as IPO[];
  } catch (error) {
    console.error('Error fetching current Mainboard IPOs:', error);
    return [];
  }
}

/**
 * Get Upcoming Mainboard IPOs (Status: UPCOMING)
 *
 * Returns up to 6 upcoming Mainboard IPOs sorted by open date (opening soonest first).
 *
 * @returns Promise with array of upcoming IPOs
 */
export async function getMainboardUpcomingIPOs(): Promise<IPO[]> {
  try {
    const results = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        category: ipos.category,
        sector: ipos.sector,
        issueSize: ipos.issueSize,
        priceRangeMin: ipos.priceRangeMin,
        priceRangeMax: ipos.priceRangeMax,
        lotSize: ipos.lotSize,
        status: ipos.status,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
        allotmentDate: ipos.allotmentDate,
        listingDate: ipos.listingDate,
        listingExchanges: ipos.listingExchanges,
        leadManagers: ipos.leadManagers,
      })
      .from(ipos)
      .where(and(eq(ipos.category, 'MAINBOARD'), eq(ipos.status, 'UPCOMING')))
      .orderBy(ipos.openDate) // Opening soonest first
      .limit(6);

    return results as IPO[];
  } catch (error) {
    console.error('Error fetching upcoming Mainboard IPOs:', error);
    return [];
  }
}

/**
 * Get Recently Listed Mainboard IPOs (Status: LISTED)
 *
 * Returns up to 6 recently listed Mainboard IPOs sorted by listing date (newest first).
 *
 * @returns Promise with array of recently listed IPOs
 */
export async function getMainboardRecentlyListedIPOs(): Promise<IPO[]> {
  try {
    const results = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        category: ipos.category,
        sector: ipos.sector,
        issueSize: ipos.issueSize,
        priceRangeMin: ipos.priceRangeMin,
        priceRangeMax: ipos.priceRangeMax,
        lotSize: ipos.lotSize,
        status: ipos.status,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
        allotmentDate: ipos.allotmentDate,
        listingDate: ipos.listingDate,
        listingExchanges: ipos.listingExchanges,
        leadManagers: ipos.leadManagers,
      })
      .from(ipos)
      .where(
        and(
          eq(ipos.category, 'MAINBOARD'),
          eq(ipos.status, 'LISTED'),
          isNotNull(ipos.listingDate)
        )
      )
      .orderBy(desc(ipos.listingDate)) // Newest first
      .limit(6);

    return results as IPO[];
  } catch (error) {
    console.error('Error fetching recently listed Mainboard IPOs:', error);
    return [];
  }
}

/**
 * Get Mainboard IPO Reviews
 *
 * Returns up to 6 recent reviews for Mainboard IPOs sorted by published date (newest first).
 *
 * @returns Promise with array of reviews with IPO data
 */
export async function getMainboardReviews(): Promise<ReviewWithIPO[]> {
  try {
    const results = await db
      .select({
        id: ipoReviews.id,
        reviewTitle: ipoReviews.reviewTitle,
        author: ipoReviews.author,
        recommendation: ipoReviews.recommendation,
        ipoId: ipoReviews.ipoId,
        ipoName: ipos.companyName,
        ipoSlug: ipos.slug,
        publishedDate: ipoReviews.publishedDate,
        year: ipoReviews.year,
        reviewUrl: ipoReviews.reviewUrl,
      })
      .from(ipoReviews)
      .innerJoin(ipos, eq(ipoReviews.ipoId, ipos.id))
      .where(eq(ipoReviews.category, 'MAINBOARD'))
      .orderBy(desc(ipoReviews.publishedDate)) // Newest first
      .limit(6);

    return results;
  } catch (error) {
    console.error('Error fetching Mainboard IPO reviews:', error);
    return [];
  }
}

/**
 * Get Mainboard Performance Highlights
 *
 * Returns top 3 gainers and top 3 losers from listed Mainboard IPOs.
 *
 * @returns Promise with object containing topGainers and topLosers arrays
 */
export async function getMainboardPerformanceHighlights(): Promise<{
  topGainers: PerformanceHighlight[];
  topLosers: PerformanceHighlight[];
}> {
  try {
    // Fetch all listed Mainboard IPOs with performance data
    const allPerformance = await db
      .select({
        ipoId: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        issuePrice: listingPerformance.issuePrice,
        listingPrice: listingPerformance.listingPrice,
        currentPrice: listingPerformance.currentPrice,
        currentGainPercent: listingPerformance.currentGainPercent,
        listingDate: ipos.listingDate,
      })
      .from(ipos)
      .innerJoin(listingPerformance, eq(ipos.id, listingPerformance.ipoId))
      .where(
        and(
          eq(ipos.category, 'MAINBOARD'),
          eq(ipos.status, 'LISTED'),
          isNotNull(listingPerformance.currentPrice),
          isNotNull(listingPerformance.currentGainPercent)
        )
      );

    // Convert to PerformanceHighlight format
    const highlights: PerformanceHighlight[] = allPerformance.map((item) => ({
      ipoId: item.ipoId,
      companyName: item.companyName,
      slug: item.slug,
      issuePrice: item.issuePrice,
      listingPrice: item.listingPrice,
      currentPrice: item.currentPrice!,
      gainPercent: parseFloat(item.currentGainPercent!),
      listingDate: item.listingDate,
    }));

    // Sort by gainPercent descending (highest to lowest)
    const sortedByGain = [...highlights].sort((a, b) => b.gainPercent - a.gainPercent);

    // Top 3 gainers (positive gains)
    const topGainers = sortedByGain.filter((h) => h.gainPercent > 0).slice(0, 3);

    // Sort by gainPercent ascending (lowest to highest) for losers
    const sortedByLoss = [...highlights].sort((a, b) => a.gainPercent - b.gainPercent);

    // Top 3 losers (negative gains)
    const topLosers = sortedByLoss.filter((h) => h.gainPercent < 0).slice(0, 3);

    return {
      topGainers,
      topLosers,
    };
  } catch (error) {
    console.error('Error fetching Mainboard performance highlights:', error);
    return {
      topGainers: [],
      topLosers: [],
    };
  }
}

/**
 * Get Mainboard Subscription Status
 *
 * Returns up to 6 Mainboard IPOs with latest subscription data (current/recent IPOs).
 *
 * @returns Promise with array of subscription status data
 */
export async function getMainboardSubscriptionStatus(): Promise<SubscriptionStatusData[]> {
  try {
    // Get latest subscription for each current/recent Mainboard IPO
    const results = await db
      .select({
        ipoId: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        totalSubscription: subscriptions.totalSubscription,
        qibSubscription: subscriptions.qibSubscription,
        niiSubscription: subscriptions.niiSubscription,
        retailSubscription: subscriptions.retailSubscription,
        timestamp: subscriptions.timestamp,
      })
      .from(ipos)
      .innerJoin(subscriptions, eq(ipos.id, subscriptions.ipoId))
      .where(
        and(
          eq(ipos.category, 'MAINBOARD'),
          // Only current or recently closed IPOs
          sql`${ipos.status} IN ('OPEN', 'CLOSED')`
        )
      )
      .orderBy(desc(subscriptions.timestamp)) // Latest subscriptions first
      .limit(6);

    return results.map((r) => ({
      ipoId: r.ipoId,
      companyName: r.companyName,
      slug: r.slug,
      totalSubscription: r.totalSubscription ? parseFloat(r.totalSubscription) : null,
      qibSubscription: r.qibSubscription ? parseFloat(r.qibSubscription) : null,
      niiSubscription: r.niiSubscription ? parseFloat(r.niiSubscription) : null,
      retailSubscription: r.retailSubscription ? parseFloat(r.retailSubscription) : null,
      timestamp: r.timestamp,
    }));
  } catch (error) {
    console.error('Error fetching Mainboard subscription status:', error);
    return [];
  }
}

/**
 * Get Mainboard Detailed List (with filters)
 *
 * Returns detailed list of Mainboard IPOs with filtering, search, and sorting.
 *
 * @param filters - Optional filters object
 * @returns Promise with object containing data array and totalCount
 */
export async function getMainboardDetailedList(
  filters?: DetailedTableFilters
): Promise<{ data: IPO[]; totalCount: number }> {
  try {
    // Build WHERE conditions
    const conditions = [eq(ipos.category, 'MAINBOARD')];

    // Year filter (filter by openDate year)
    if (filters?.year) {
      conditions.push(
        sql`EXTRACT(YEAR FROM ${ipos.openDate}) = ${filters.year}`
      );
    }

    // Query with filters
    let query = db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        category: ipos.category,
        sector: ipos.sector,
        issueSize: ipos.issueSize,
        priceRangeMin: ipos.priceRangeMin,
        priceRangeMax: ipos.priceRangeMax,
        lotSize: ipos.lotSize,
        status: ipos.status,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
        allotmentDate: ipos.allotmentDate,
        listingDate: ipos.listingDate,
        listingExchanges: ipos.listingExchanges,
        leadManagers: ipos.leadManagers,
      })
      .from(ipos)
      .where(and(...conditions));

    // Execute query
    let results = await query;

    // Apply company search filter (fuzzy match, client-side for now)
    if (filters?.companySearch) {
      const searchLower = filters.companySearch.toLowerCase();
      results = results.filter((r) =>
        r.companyName.toLowerCase().includes(searchLower)
      );
    }

    // Apply lead manager search filter (fuzzy match, client-side)
    if (filters?.leadManagerSearch) {
      const searchLower = filters.leadManagerSearch.toLowerCase();
      results = results.filter((r) =>
        r.leadManagers?.some((lm: string) => lm.toLowerCase().includes(searchLower))
      );
    }

    // Apply sorting
    const sortColumn = filters?.sortColumn || 'openDate';
    const sortDirection = filters?.sortDirection || 'desc';

    results.sort((a: any, b: any) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime();
      } else {
        comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return {
      data: results as IPO[],
      totalCount: results.length,
    };
  } catch (error) {
    console.error('Error fetching Mainboard detailed list:', error);
    return {
      data: [],
      totalCount: 0,
    };
  }
}
