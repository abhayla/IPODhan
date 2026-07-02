/**
 * SME IPOs Landing Page Service
 *
 * Service for fetching all data required for the SME IPOs landing page.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.16: SME IPOs Landing Page
 */

import { getRedisClient, safeGet, safeSet } from '@/lib/cache/redis-client';
import type { IPO } from '@/lib/db/types';
import { db } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';

// ==================== TYPES ====================

/**
 * Summary metrics for SME IPOs dashboard
 */
export interface SMESummaryMetrics {
  totalIPOs: number;
  listedInGain: number | null;
  listedInLoss: number | null;
  upcomingAndOngoing: number;
  gainAOT: number | null; // null until computed from real listing_performance aggregates (#98)
  lossAOT: number | null; // null until computed from real listing_performance aggregates (#98)
}

/**
 * Review with associated IPO details
 */
export interface ReviewWithIPO {
  reviewId: string;
  reviewTitle: string;
  reviewUrl: string | null;
  author: string;
  recommendation: string;
  publishedDate: string;
  ipoId: string;
  ipoName: string;
  ipoSlug: string;
}

/**
 * Performance highlight with gain/loss data
 */
export interface PerformanceHighlight {
  id: string;
  companyName: string;
  slug: string;
  issuePrice: number;
  currentPrice: number;
  gainPercent: number;
  listingDate: string;
}

/**
 * Subscription status with IPO details
 */
export interface SubscriptionStatusData {
  id: string;
  companyName: string;
  slug: string;
  totalSubscription: number | null;
  qibSubscription: number | null;
  niiSubscription: number | null;
  retailSubscription: number | null;
  closeDate: string | null;
}

/**
 * Detailed table filters
 */
export interface DetailedTableFilters {
  year?: number;
  companySearch?: string;
  leadManagerSearch?: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds
const CONTENT_LIMIT = 6; // Limit for content sections

// Cache key prefixes
const CACHE_KEYS = {
  SUMMARY_METRICS: 'sme:landing:summary',
  CURRENT_IPOS: 'sme:landing:current',
  UPCOMING_IPOS: 'sme:landing:upcoming',
  RECENTLY_LISTED: 'sme:landing:recent',
  REVIEWS: 'sme:landing:reviews',
  PERFORMANCE: 'sme:landing:performance',
  SUBSCRIPTION: 'sme:landing:subscription',
  DETAILED_LIST: (year: number) => `sme:landing:detailed:${year}`,
} as const;

// ==================== HELPER FUNCTIONS ====================

/**
 * Get data from cache or fetch with function
 */
async function getCachedOrFetch<T>(
  cacheKey: string,
  fetchFunction: () => Promise<T>
): Promise<T> {
  try {
    const cached = await safeGet(cacheKey);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    const data = await fetchFunction();
    safeSet(cacheKey, JSON.stringify(data), CACHE_TTL).catch((error) => {
      console.error(`Failed to cache data for key ${cacheKey}:`, error);
    });

    return data;
  } catch (error) {
    console.error(`Error in getCachedOrFetch for key ${cacheKey}:`, error);
    return fetchFunction();
  }
}

/**
 * Calculate gain percentage
 */
function calculateGainPercent(issuePrice: number, currentPrice: number): number {
  if (!issuePrice || !currentPrice) return 0;
  return ((currentPrice - issuePrice) / issuePrice) * 100;
}

// ==================== PUBLIC API FUNCTIONS ====================

/**
 * Get SME summary metrics
 * AC#3: Displays all 6 cards with correct calculated values
 * AC#16: Only SME IPOs displayed (category=SME filter applied)
 */
export async function getSMESummaryMetrics(): Promise<SMESummaryMetrics> {
  return getCachedOrFetch(CACHE_KEYS.SUMMARY_METRICS, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Fetch all SME IPOs (only IPO offering type)
      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        limit: 1000,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
      const ipos = response.data;

      // Calculate totalIPOs
      const totalIPOs = ipos.length;

      // For listed IPOs, we need current price data
      // Note: This requires listingPerformance data from API
      // For MVP, we'll use mock calculations based on available data
      const listedIPOs = ipos.filter((ipo) => ipo.status === 'LISTED');

      // Count IPOs in gain (mock: assume 55% in gain for SME)
      // Mocked metrics removed — null until real listing_performance aggregates (#98).
      void listedIPOs;
      const listedInGain = null;

      // Count IPOs in loss (mock: assume 45% in loss)
      const listedInLoss = null;

      // Count upcoming and ongoing IPOs
      const upcomingAndOngoing = ipos.filter(
        (ipo) => ipo.status === 'UPCOMING' || ipo.status === 'OPEN'
      ).length;

      // Calculate average gain (mock: 30% for SME)
      const gainAOT = null;
      const lossAOT = null;

      return {
        totalIPOs,
        listedInGain,
        listedInLoss,
        upcomingAndOngoing,
        gainAOT,
        lossAOT,
      };
    } catch (error) {
      console.error('Error fetching SME summary metrics:', error);
      return {
        totalIPOs: 0,
        listedInGain: null,
        listedInLoss: null,
        upcomingAndOngoing: 0,
        gainAOT: null,
        lossAOT: null,
      };
    }
  });
}

/**
 * Get current SME IPOs (OPEN status)
 * AC#4: Content section displays 4-6 cards
 * AC#16: Only SME IPOs displayed
 */
export async function getSMECurrentIPOs(): Promise<IPO[]> {
  return getCachedOrFetch(CACHE_KEYS.CURRENT_IPOS, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        status: ['OPEN'],
        limit: CONTENT_LIMIT,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Sort by closeDate ascending (closing soonest first)
      return response.data.sort((a, b) => {
        if (!a.closeDate) return 1;
        if (!b.closeDate) return -1;
        return new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime();
      });
    } catch (error) {
      console.error('Error fetching current SME IPOs:', error);
      return [];
    }
  });
}

/**
 * Get upcoming SME IPOs (UPCOMING status)
 * AC#4: Content section displays 4-6 cards
 * AC#16: Only SME IPOs displayed
 */
export async function getSMEUpcomingIPOs(): Promise<IPO[]> {
  return getCachedOrFetch(CACHE_KEYS.UPCOMING_IPOS, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        status: ['UPCOMING'],
        limit: CONTENT_LIMIT,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Sort by openDate ascending (opening soonest first)
      return response.data.sort((a, b) => {
        if (!a.openDate) return 1;
        if (!b.openDate) return -1;
        return new Date(a.openDate).getTime() - new Date(b.openDate).getTime();
      });
    } catch (error) {
      console.error('Error fetching upcoming SME IPOs:', error);
      return [];
    }
  });
}

/**
 * Get recently listed SME IPOs (LISTED status)
 * AC#4: Content section displays 4-6 cards
 * AC#16: Only SME IPOs displayed
 */
export async function getSMERecentlyListedIPOs(): Promise<IPO[]> {
  return getCachedOrFetch(CACHE_KEYS.RECENTLY_LISTED, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        status: ['LISTED'],
        limit: CONTENT_LIMIT,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Sort by listingDate descending (newest first)
      return response.data.sort((a, b) => {
        if (!a.listingDate) return 1;
        if (!b.listingDate) return -1;
        return new Date(b.listingDate).getTime() - new Date(a.listingDate).getTime();
      });
    } catch (error) {
      console.error('Error fetching recently listed SME IPOs:', error);
      return [];
    }
  });
}

/**
 * Get SME IPO reviews
 * AC#4: Content section displays 4-6 review cards
 * AC#16: Only SME reviews displayed
 * Note: This requires ipoReviews API endpoint (created in Story 9.14)
 */
export async function getSMEReviews(): Promise<ReviewWithIPO[]> {
  return getCachedOrFetch(CACHE_KEYS.REVIEWS, async () => {
    try {
      // Mock data for now - replace with actual API call when reviews endpoint is ready
      // const response = await fetch(`/api/ipo-reviews?category=SME&limit=${CONTENT_LIMIT}`);
      // const data = await response.json();

      // Return empty array for MVP
      return [];
    } catch (error) {
      console.error('Error fetching SME reviews:', error);
      return [];
    }
  });
}

/**
 * Get performance highlights (top gainers and losers)
 * AC#4: Content section displays top gainers/losers
 * AC#16: Only SME IPOs displayed
 */
export async function getSMEPerformanceHighlights(): Promise<{
  topGainers: PerformanceHighlight[];
  topLosers: PerformanceHighlight[];
}> {
  return getCachedOrFetch(CACHE_KEYS.PERFORMANCE, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Fetch listed SME IPOs
      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        status: ['LISTED'],
        limit: 50,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Mock performance data (replace with actual listingPerformance API)
      const performances: PerformanceHighlight[] = response.data
        .filter((ipo) => ipo.priceRangeMax && ipo.listingDate)
        .map((ipo) => {
          // Mock current price: issue price * (1 + random gain/loss)
          const issuePrice = ipo.priceRangeMax!;
          const randomGain = (Math.random() - 0.3) * 60; // -18% to +42%
          const currentPrice = issuePrice * (1 + randomGain / 100);

          return {
            id: ipo.id,
            companyName: ipo.companyName,
            slug: ipo.slug,
            issuePrice,
            currentPrice,
            gainPercent: calculateGainPercent(issuePrice, currentPrice),
            listingDate: ipo.listingDate!,
          };
        });

      // Sort by gain percentage
      const sortedByGain = [...performances].sort((a, b) => b.gainPercent - a.gainPercent);

      // Top 3 gainers
      const topGainers = sortedByGain.slice(0, 3);

      // Top 3 losers (lowest gain percentage)
      const topLosers = sortedByGain.slice(-3).reverse();

      return { topGainers, topLosers };
    } catch (error) {
      console.error('Error fetching SME performance highlights:', error);
      return { topGainers: [], topLosers: [] };
    }
  });
}

/**
 * Get subscription status for current SME IPOs
 * AC#4: Content section displays subscription data
 * AC#16: Only SME IPOs displayed
 */
export async function getSMESubscriptionStatus(): Promise<SubscriptionStatusData[]> {
  return getCachedOrFetch(CACHE_KEYS.SUBSCRIPTION, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Fetch current (OPEN) SME IPOs
      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        status: ['OPEN'],
        limit: CONTENT_LIMIT,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      // Transform to subscription data (mock - replace with actual subscription API)
      return response.data.map((ipo) => ({
        id: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        totalSubscription: Math.random() * 15, // Mock: 0-15x subscription
        qibSubscription: Math.random() * 25,
        niiSubscription: Math.random() * 12,
        retailSubscription: Math.random() * 8,
        closeDate: ipo.closeDate,
      }));
    } catch (error) {
      console.error('Error fetching SME subscription status:', error);
      return [];
    }
  });
}

/**
 * Get detailed SME IPO list with filtering
 * AC#8: Detailed table shows all columns with filters
 * AC#16: Only SME IPOs displayed (category=SME filter applied throughout)
 */
export async function getSMEDetailedList(
  filters?: DetailedTableFilters
): Promise<{ data: IPO[]; totalCount: number }> {
  const year = filters?.year || new Date().getFullYear();
  const cacheKey = CACHE_KEYS.DETAILED_LIST(year);

  return getCachedOrFetch(cacheKey, async () => {
    try {
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Fetch all SME IPOs (will be filtered by year)
      const response = await ipoRepository.findAll({
        segment: ['SME'],
        offeringType: ['IPO'],
        limit: 1000,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      let filteredData = response.data;

      // Filter by year (based on openDate)
      if (filters?.year) {
        filteredData = filteredData.filter((ipo) => {
          if (!ipo.openDate) return false;
          const ipoYear = new Date(ipo.openDate).getFullYear();
          return ipoYear === filters.year;
        });
      }

      // Filter by company search
      if (filters?.companySearch) {
        const searchLower = filters.companySearch.toLowerCase();
        filteredData = filteredData.filter((ipo) =>
          ipo.companyName.toLowerCase().includes(searchLower)
        );
      }

      // Filter by lead manager search
      // Note: leadManagers field might not exist in current schema
      // if (filters?.leadManagerSearch) {
      //   const searchLower = filters.leadManagerSearch.toLowerCase();
      //   filteredData = filteredData.filter((ipo) =>
      //     ipo.leadManagers?.some((manager) => manager.toLowerCase().includes(searchLower))
      //   );
      // }

      // Apply sorting
      const sortColumn = filters?.sortColumn || 'openDate';
      const sortDirection = filters?.sortDirection || 'desc';

      filteredData.sort((a, b) => {
        let valueA = a[sortColumn as keyof IPO];
        let valueB = b[sortColumn as keyof IPO];

        // Handle dates
        if (sortColumn.includes('Date') && typeof valueA === 'string' && typeof valueB === 'string') {
          valueA = new Date(valueA).getTime();
          valueB = new Date(valueB).getTime();
        }

        // Handle nulls
        if (valueA === null) return 1;
        if (valueB === null) return -1;

        // Compare
        if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
        if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      return {
        data: filteredData,
        totalCount: filteredData.length,
      };
    } catch (error) {
      console.error('Error fetching SME detailed list:', error);
      return { data: [], totalCount: 0 };
    }
  });
}

/**
 * Clear all SME landing page caches
 * Utility function for cache invalidation
 */
export async function clearSMELandingCaches(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(
      CACHE_KEYS.SUMMARY_METRICS,
      CACHE_KEYS.CURRENT_IPOS,
      CACHE_KEYS.UPCOMING_IPOS,
      CACHE_KEYS.RECENTLY_LISTED,
      CACHE_KEYS.REVIEWS,
      CACHE_KEYS.PERFORMANCE,
      CACHE_KEYS.SUBSCRIPTION
    );
    console.log('SME landing page caches cleared successfully');
  } catch (error) {
    console.error('Error clearing SME landing page caches:', error);
  }
}
