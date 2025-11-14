/**
 * IPO Listings Service
 *
 * Service for fetching IPO listing performance data for
 * Mainboard, SME, and FPO categories with comprehensive metrics.
 *
 * ⚠️ ARCHITECTURE: Services use repositories directly, NOT HTTP calls.
 * This follows the 3-layer architecture: Server Component → Service → Repository
 */

import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export interface IPOListingData {
  id: string;
  companyName: string;
  slug: string;
  segment: string | null;
  offeringType: string | null;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
  issuePrice: number | null;
  issueSize: number | null;
  lotSize: number | null;
  allotmentDate: string | null;

  // Subscription data
  subscriptionOverall: number | null;
  subscriptionQIB: number | null;
  subscriptionNII: number | null;
  subscriptionRetail: number | null;

  // GMP data
  gmp: number | null;

  // Listing performance
  listingDayClosePrice: number | null;
  listingDayGainPercent: number | null;
  currentPriceBSE: number | null;
  currentPriceNSE: number | null;
  currentGainPercent: number | null;
  marketCap: number | null;
}

export interface IPOListingsResponse {
  data: IPOListingData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  stats: {
    totalIPOs: number;
    avgListingGain: number | null;
    totalGainers: number;
    totalLosers: number;
  };
}

export interface IPOListingsFilters {
  category?: 'MAINBOARD' | 'SME' | 'FPO' | 'ALL';
  year?: string;
  page?: number;
  limit?: number;
  sortBy?: 'listingDate' | 'listingDayGain' | 'currentGain' | 'issueSize' | 'companyName';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Fetch IPO listings with performance data
 * Uses repository directly for proper 3-layer architecture
 */
export async function fetchIPOListings(
  filters: IPOListingsFilters = {}
): Promise<IPOListingsResponse> {
  try {
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Call repository method directly
    const result = await ipoRepository.findListings({
      category: filters.category,
      year: filters.year,
      page: filters.page,
      limit: filters.limit,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });

    return result;
  } catch (error) {
    console.error('Error fetching IPO listings:', error);
    // Return empty data on error
    return {
      data: [],
      pagination: {
        page: filters.page || 1,
        limit: filters.limit || 20,
        total: 0,
        hasMore: false,
      },
      stats: {
        totalIPOs: 0,
        avgListingGain: null,
        totalGainers: 0,
        totalLosers: 0,
      },
    };
  }
}

/**
 * Get available years for filtering
 */
export async function fetchAvailableYears(): Promise<string[]> {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];

  // Generate years from 2020 to 2026
  for (let year = 2026; year >= 2020; year--) {
    years.push(String(year));
  }

  return years;
}
