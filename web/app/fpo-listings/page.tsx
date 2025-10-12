import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListingCategoryTabs } from '@/components/listings/ListingCategoryTabs';
import { YearFilter, CURRENT_YEAR } from '@/components/listings/YearFilter';
import { IPOListingsTable } from '@/components/listings/IPOListingsTable';
import { ListingsPagination } from '@/components/listings/ListingsPagination';
import { fetchIPOListings, fetchAvailableYears } from '@/lib/services/ipo-listings-service';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * FPO Listings Page
 *
 * Displays comprehensive post-listing performance data for FPOs
 * (Follow-on Public Offers) with 19 columns including subscription,
 * GMP, listing gains, current prices, and market cap.
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
  title: `FPO Listings ${new Date().getFullYear()} - Follow-on Public Offer Performance | IPODhan`,
  description:
    'Comprehensive FPO (Follow-on Public Offer) listings with post-listing performance data including subscription, GMP, listing gains, current prices, and market cap. Track all listed FPOs in India with detailed 19-column performance analysis.',
  keywords:
    'fpo listings, follow-on public offer, fpo performance, post listing performance, fpo subscription data, India',
  openGraph: {
    title: `FPO Listings ${new Date().getFullYear()} - Follow-on Public Offer Performance`,
    description: 'Track post-listing performance of all FPOs with detailed metrics',
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
  searchParams: SearchParams;
}

export default async function FPOListingsPage({ searchParams }: Props) {
  // Parse search params with dynamic current year
  const selectedYear = searchParams.year || CURRENT_YEAR;
  const currentPage = parseInt(searchParams.page || '1', 10);
  const sortBy = searchParams.sortBy || 'listingDate';
  const sortOrder = searchParams.sortOrder || 'desc';

  // Fetch data
  const [listingsResponse, availableYears] = await Promise.all([
    fetchIPOListings({
      category: 'FPO',
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
        <h1 className="text-3xl font-bold mb-2">FPO Listings</h1>
        <p className="text-gray-600">
          Track post-listing performance of all FPOs (Follow-on Public Offers) with comprehensive
          data including subscription, GMP, listing gains, current market prices at BSE and NSE,
          and market capitalization. Analyze how existing listed companies raised additional
          capital through follow-on offerings and their market performance.
        </p>
      </div>

      {/* Category Navigation Tabs */}
      <ListingCategoryTabs />

      {/* Filters and Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 my-6">
        <div className="flex items-center gap-4">
          <YearFilter
            availableYears={availableYears}
            selectedYear={selectedYear}
            onYearChange={(year) => {
              const url = new URL(window.location.href);
              url.searchParams.set('year', year);
              url.searchParams.delete('page'); // Reset to page 1
              window.location.href = url.toString();
            }}
          />
        </div>
        {stats.totalIPOs > 0 && (
          <div className="flex gap-6 text-sm text-gray-600">
            <div>
              <span className="font-medium">Total FPOs:</span> {stats.totalIPOs}
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
            <IPOListingsTable
              data={data}
              onSort={(field, order) => {
                const url = new URL(window.location.href);
                url.searchParams.set('sortBy', field);
                url.searchParams.set('sortOrder', order);
                window.location.href = url.toString();
              }}
              currentSort={{ field: sortBy, order: sortOrder }}
            />
          </Suspense>

          <ListingsPagination
            currentPage={pagination.page}
            totalPages={Math.ceil(pagination.total / pagination.limit)}
            totalRecords={pagination.total}
            recordsPerPage={pagination.limit}
            onPageChange={(page) => {
              const url = new URL(window.location.href);
              url.searchParams.set('page', String(page));
              window.location.href = url.toString();
            }}
          />
        </>
      ) : (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-500 text-lg">
            No FPO listings found for {selectedYear}
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
