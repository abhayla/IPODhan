import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListingCategoryTabs } from '@/components/listings/ListingCategoryTabs';
import { YearFilterClient } from '@/components/listings/YearFilterClient';
import { IPOListingsTableClient } from '@/components/listings/IPOListingsTableClient';
import { ListingsPaginationClient } from '@/components/listings/ListingsPaginationClient';
import { fetchIPOListings, fetchAvailableYears } from '@/lib/services/ipo-listings-service';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mainboard IPO Listings Page
 *
 * Displays comprehensive post-listing performance data for Mainboard IPOs
 * with 19 columns including subscription, GMP, listing gains, current prices,
 * and market cap.
 *
 * Features:
 * - Cross-navigation tabs (Mainboard / SME / FPO)
 * - Year dropdown filter (2020-2026, default: current year)
 * - Sortable columns (client-side)
 * - Pagination (50 records per page)
 * - ISR with 5-minute revalidation
 * - Responsive with horizontal scroll on mobile
 */

export const revalidate = 300; // 5 minutes ISR

export const metadata: Metadata = {
  title: `Mainboard IPO Listings ${new Date().getFullYear()} - Post-Listing Performance & Analysis | IPODhan`,
  description:
    'Comprehensive Mainboard IPO listings with post-listing performance data including subscription, GMP, listing gains, current prices, and market cap. Track all listed Mainboard IPOs with detailed 19-column performance analysis.',
  keywords:
    'mainboard ipo listings, ipo performance, post listing performance, ipo subscription data, ipo gmp, listing gains, current prices, market cap, India',
  openGraph: {
    title: `Mainboard IPO Listings ${new Date().getFullYear()} - Post-Listing Performance`,
    description: 'Track post-listing performance of all Mainboard IPOs with detailed metrics',
    type: 'website',
  },
};

interface SearchParams {
  year?: string;
  page?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function MainboardIPOListingsPage({ searchParams }: Props) {
  // Parse search params with dynamic current year
  const params = await searchParams;
  const CURRENT_YEAR = new Date().getFullYear().toString();
  const selectedYear = params.year || CURRENT_YEAR;
  const currentPage = parseInt(params.page || '1', 10);
  const sortBy = (params.sortBy || 'listingDate') as 'listingDate' | 'listingDayGain' | 'currentGain' | 'issueSize' | 'companyName';
  const sortOrder = (params.sortOrder || 'desc') as 'asc' | 'desc';

  // Fetch data
  const [listingsResponse, availableYears] = await Promise.all([
    fetchIPOListings({
      category: 'MAINBOARD',
      year: selectedYear,
      page: currentPage,
      limit: 50,
      sortBy,
      sortOrder,
    }),
    fetchAvailableYears(),
  ]);

  const { data, pagination, stats } = listingsResponse;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Mainboard IPO Listings</h1>
        <p className="text-gray-600">
          Track post-listing performance of all Mainboard IPOs with comprehensive data including
          subscription, GMP, listing gains, current market prices at BSE and NSE, and market
          capitalization. Compare IPO outcomes across different years and analyze historical
          performance patterns.
        </p>
      </div>

      {/* Category Navigation Tabs */}
      <ListingCategoryTabs />

      {/* Filters and Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 my-6">
        <div className="flex items-center gap-4">
          <YearFilterClient
            availableYears={availableYears}
            selectedYear={selectedYear}
          />
        </div>
        {stats.totalIPOs > 0 && (
          <div className="flex gap-6 text-sm text-gray-600">
            <div>
              <span className="font-medium">Total IPOs:</span> {stats.totalIPOs}
            </div>
            <div>
              <span className="font-medium">Avg Listing Gain:</span>{' '}
              <span
                className={
                  stats.avgListingGain && stats.avgListingGain >= 0
                    ? 'text-green-600 font-semibold'
                    : 'text-red-600 font-semibold'
                }
              >
                {stats.avgListingGain ? `${stats.avgListingGain.toFixed(2)}%` : 'N/A'}
              </span>
            </div>
            <div>
              <span className="font-medium">Gainers:</span>{' '}
              <span className="text-green-600 font-semibold">{stats.totalGainers}</span>
            </div>
            <div>
              <span className="font-medium">Losers:</span>{' '}
              <span className="text-red-600 font-semibold">{stats.totalLosers}</span>
            </div>
          </div>
        )}
      </div>

      {/* Listings Table */}
      {data.length > 0 ? (
        <>
          <Suspense fallback={<TableSkeleton />}>
            <IPOListingsTableClient
              data={data}
              sortBy={sortBy}
              sortOrder={sortOrder}
            />
          </Suspense>

          <ListingsPaginationClient
            currentPage={pagination.page}
            totalPages={Math.ceil(pagination.total / pagination.limit)}
            totalRecords={pagination.total}
            recordsPerPage={pagination.limit}
          />
        </>
      ) : (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-500 text-lg">
            No Mainboard IPO listings found for {selectedYear}
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Try selecting a different year or check back later for new listings
          </p>
        </div>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
