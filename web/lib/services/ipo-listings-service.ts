/**
 * IPO Listings Service
 *
 * Service for fetching IPO listing performance data for
 * Mainboard, SME, and FPO categories with comprehensive metrics.
 */

import type { IPO, ListingPerformance, Subscription, GMPRecord } from '@/lib/repositories/types';

export interface IPOListingData {
  id: string;
  companyName: string;
  slug: string;
  category: string;
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
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Fetch IPO listings with performance data
 */
export async function fetchIPOListings(
  filters: IPOListingsFilters = {}
): Promise<IPOListingsResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  // Build query params
  const params = new URLSearchParams();

  if (filters.category && filters.category !== 'ALL') {
    params.set('category', filters.category);
  }
  if (filters.year) params.set('year', filters.year);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

  const queryString = params.toString();
  const url = `${baseUrl}/api/ipos/listings${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      next: { revalidate: 300 }, // 5 minutes
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch IPO listings: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching IPO listings:', error);
    // Return empty data on error
    return {
      data: [],
      pagination: {
        page: 1,
        limit: 20,
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
