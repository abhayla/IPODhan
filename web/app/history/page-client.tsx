'use client';

import { useEffect, useState } from 'react';
import { HistoricalFiltersProvider, useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';
import { HistoricalFilters } from '@/components/history/HistoricalFilters';
import { HistoricalSearchBar } from '@/components/history/HistoricalSearchBar';
import { HistoricalIPOTable } from '@/components/history/HistoricalIPOTable';
import { HistoricalIPOCardList } from '@/components/history/HistoricalIPOCardList';
import { HistoricalPagination } from '@/components/history/HistoricalPagination';
import { ResultsCount } from '@/components/history/ResultsCount';
import { EmptyState } from '@/components/history/EmptyState';
import { LoadingSkeleton } from '@/components/history/LoadingSkeleton';
import type { HistoricalIPO } from '@/lib/repositories/types';

interface HistoricalIPOResponse {
  data: HistoricalIPO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

interface HistoricalIPOsPageClientProps {
  initialData: HistoricalIPOResponse;
  availableSectors: string[];
  availableYears: string[];
  searchParams: { [key: string]: string | string[] | undefined };
}

function HistoricalIPOsContent({
  initialData,
  availableSectors,
  availableYears,
}: HistoricalIPOsPageClientProps) {
  const {
    filters,
    setSearch,
    setSort,
    setSortOrder,
    setPage,
    clearFilters,
    updateURL,
  } = useHistoricalFilters();

  const [data, setData] = useState<HistoricalIPOResponse>(initialData);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch data when filters change
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);

      try {
        const params = new URLSearchParams();

        if (filters.year) params.set('year', filters.year);
        if (filters.sector) params.set('sector', filters.sector);
        if (filters.performance) params.set('performance', filters.performance);
        if (filters.search) params.set('search', filters.search);
        if (filters.sort) params.set('sort', filters.sort);
        if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
        params.set('page', filters.page.toString());
        params.set('limit', filters.limit.toString());

        const queryString = params.toString();
        const response = await fetch(`/api/ipos/history${queryString ? `?${queryString}` : ''}`);

        if (!response.ok) {
          throw new Error('Failed to fetch historical IPOs');
        }

        const newData: HistoricalIPOResponse = await response.json();
        setData(newData);
      } catch (error) {
        console.error('Error fetching historical IPOs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters]);

  const handleSort = (column: 'listing_date' | 'listing_gain' | 'subscription') => {
    if (filters.sort === column) {
      // Toggle sort order
      setSortOrder(filters.sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new sort column with default desc order
      setSort(column);
      setSortOrder('desc');
    }
  };

  const handlePageChange = (page: number) => {
    setPage(page);
    updateURL();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClearFilters = () => {
    clearFilters();
    updateURL();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Historical IPOs</h1>
        <p className="text-muted-foreground text-lg">
          Browse past IPO performance with comprehensive metrics and analysis
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar Filters (Desktop) / Filter Button (Mobile) */}
        <HistoricalFilters availableSectors={availableSectors} availableYears={availableYears} />

        {/* Main Content */}
        <div className="flex-1 space-y-6">
          {/* Search Bar and Results Count */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <HistoricalSearchBar
              value={filters.search}
              onSearch={(query) => {
                setSearch(query);
                updateURL();
              }}
            />
            <ResultsCount
              total={data.pagination.total}
              showing={data.data.length}
              page={data.pagination.page}
              limit={data.pagination.limit}
            />
          </div>

          {/* Loading State */}
          {isLoading ? (
            <LoadingSkeleton />
          ) : data.data.length === 0 ? (
            <EmptyState onClearFilters={handleClearFilters} />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block">
                <HistoricalIPOTable
                  ipos={data.data}
                  sortColumn={filters.sort}
                  sortOrder={filters.sortOrder}
                  onSort={handleSort}
                />
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden">
                <HistoricalIPOCardList ipos={data.data} />
              </div>

              {/* Pagination */}
              {data.pagination.total > data.pagination.limit && (
                <div className="flex justify-center mt-8">
                  <HistoricalPagination
                    currentPage={data.pagination.page}
                    totalPages={Math.ceil(data.pagination.total / data.pagination.limit)}
                    hasNext={data.pagination.hasMore}
                    hasPrev={data.pagination.page > 1}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Structured Data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Historical IPOs Database',
            description:
              'Comprehensive database of historical IPO performance in India with listing gains, subscription data, and sector analysis.',
            url: 'https://ipodhan.com/history',
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: data.pagination.total,
              itemListElement: data.data.slice(0, 10).map((ipo, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                item: {
                  '@type': 'Corporation',
                  name: ipo.companyName,
                  url: `https://ipodhan.com/ipos/${ipo.slug}`,
                  foundingDate: ipo.listingDate,
                },
              })),
            },
          }),
        }}
      />
    </div>
  );
}

export function HistoricalIPOsPageClient(props: HistoricalIPOsPageClientProps) {
  return (
    <HistoricalFiltersProvider
      initialFilters={{
        year: props.searchParams.year as string | undefined,
        sector: props.searchParams.sector as string | undefined,
        performance: props.searchParams.performance as 'Positive' | 'Negative' | 'All' | undefined,
        search: props.searchParams.search as string | undefined,
        sort: props.searchParams.sort as 'listing_date' | 'listing_gain' | 'subscription' | undefined,
        sortOrder: props.searchParams.sortOrder as 'asc' | 'desc' | undefined,
        page: props.searchParams.page ? Number(props.searchParams.page) : 1,
        limit: props.searchParams.limit ? Number(props.searchParams.limit) : 20,
      }}
    >
      <HistoricalIPOsContent {...props} />
    </HistoricalFiltersProvider>
  );
}
