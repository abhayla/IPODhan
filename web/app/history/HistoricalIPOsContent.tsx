'use client';

/**
 * Historical IPOs Content Component
 *
 * Client component that handles data fetching and rendering for historical IPOs
 * Includes filtering, sorting, search, and pagination functionality
 */

import React, { useEffect, useState } from 'react';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';
import type { HistoricalIPO } from '@/lib/repositories/types';
import { HistoricalFilters } from '@/components/history/HistoricalFilters';
import { HistoricalSearchBar } from '@/components/history/HistoricalSearchBar';
import { ResultsCount } from '@/components/history/ResultsCount';
import { HistoricalIPOTable } from '@/components/history/HistoricalIPOTable';
import { HistoricalIPOCardList } from '@/components/history/HistoricalIPOCardList';
import { HistoricalPagination } from '@/components/history/HistoricalPagination';
import { EmptyState } from '@/components/history/EmptyState';
import { LoadingSkeleton } from '@/components/history/LoadingSkeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

interface HistoricalIPOResponse {
  data: {
    ipos: HistoricalIPO[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

interface HistoricalIPOsContentProps {
  availableSectors: string[];
  availableYears: string[];
}

export function HistoricalIPOsContent({ availableSectors, availableYears }: HistoricalIPOsContentProps) {
  const { filters } = useHistoricalFilters();
  const [ipos, setIpos] = useState<HistoricalIPO[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch historical IPOs data
  useEffect(() => {
    const fetchHistoricalIPOs = async () => {
      setLoading(true);
      setError(null);

      try {
        // Build query parameters
        const params = new URLSearchParams();
        if (filters.year !== 'All') params.set('year', filters.year);
        if (filters.sector !== 'All') params.set('sector', filters.sector);
        if (filters.performance !== 'All') params.set('performance', filters.performance);
        params.set('sort', filters.sort);
        params.set('sortOrder', filters.sortOrder);
        if (filters.searchQuery) params.set('search', filters.searchQuery);
        params.set('page', filters.page.toString());
        params.set('limit', '20');

        const response = await fetch(`/api/ipos/history?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch historical IPOs');
        }

        const data: HistoricalIPOResponse = await response.json();
        setIpos(data.data.ipos);
        setPagination(data.data.pagination);
      } catch (err) {
        console.error('Error fetching historical IPOs:', err);
        setError('Failed to load historical IPOs. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchHistoricalIPOs();
  }, [filters]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl lg:text-4xl font-bold mb-2">IPO History</h1>
          <p className="text-muted-foreground">
            Research past IPO performance, listing gains, and historical trends
          </p>
        </div>

        {/* Main Content Layout */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Filters Sidebar (Desktop) / Drawer (Mobile) */}
          <HistoricalFilters availableSectors={availableSectors} availableYears={availableYears} />

          {/* Main Content Area */}
          <div className="flex-1 space-y-6">
            {/* Search Bar and Results Count */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <HistoricalSearchBar />
              <ResultsCount total={pagination.total} loading={loading} />
            </div>

            {/* Error State */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Loading State */}
            {loading && <LoadingSkeleton />}

            {/* Empty State */}
            {!loading && !error && ipos.length === 0 && <EmptyState />}

            {/* IPO List - Desktop Table View */}
            {!loading && !error && ipos.length > 0 && (
              <>
                <div className="hidden lg:block">
                  <HistoricalIPOTable ipos={ipos} />
                </div>

                {/* IPO List - Mobile Card View */}
                <div className="lg:hidden">
                  <HistoricalIPOCardList ipos={ipos} />
                </div>

                {/* Pagination */}
                <div className="flex justify-center mt-8">
                  <HistoricalPagination
                    currentPage={pagination.page}
                    totalPages={pagination.totalPages}
                    hasNext={pagination.page < pagination.totalPages}
                    hasPrev={pagination.page > 1}
                    onPageChange={(page) => {
                      // The context will handle page changes
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
