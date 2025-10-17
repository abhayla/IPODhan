'use client';

/**
 * Historical IPO Filters Context
 *
 * Manages filter state for the Historical IPOs page (Story 6.2)
 * Syncs filter state with URL query parameters for shareable links
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  HistoricalFiltersState,
  defaultFiltersState,
} from '@/lib/types/historical-filters';

interface HistoricalFiltersContextValue {
  filters: HistoricalFiltersState;
  setYear: (year: string) => void;
  setSector: (sector: string) => void;
  setPerformance: (performance: 'All' | 'Positive' | 'Negative') => void;
  setSort: (sort: string, sortOrder: 'ASC' | 'DESC') => void;
  setSortOrder: (sortOrder: 'ASC' | 'DESC') => void;
  setSearchQuery: (query: string) => void;
  setSearch: (query: string) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
  updateURL: () => void;
  hasActiveFilters: boolean;
}

const HistoricalFiltersContext = createContext<HistoricalFiltersContextValue | undefined>(
  undefined
);

interface HistoricalFiltersProviderProps {
  children: React.ReactNode;
  initialFilters?: Partial<HistoricalFiltersState>;
}

export function HistoricalFiltersProvider({
  children,
  initialFilters,
}: HistoricalFiltersProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize state from URL params or defaults
  const [filters, setFilters] = useState<HistoricalFiltersState>(() => {
    const urlYear = searchParams.get('year');
    const urlSector = searchParams.get('sector');
    const urlPerformance = searchParams.get('performance');
    const urlSort = searchParams.get('sort');
    const urlSortOrder = searchParams.get('sortOrder');
    const urlSearch = searchParams.get('search');
    const urlPage = searchParams.get('page');
    const urlLimit = searchParams.get('limit');

    const searchQuery = urlSearch || initialFilters?.searchQuery || defaultFiltersState.searchQuery;

    return {
      year: urlYear || initialFilters?.year || defaultFiltersState.year,
      sector: urlSector || initialFilters?.sector || defaultFiltersState.sector,
      performance:
        (urlPerformance as 'All' | 'Positive' | 'Negative') ||
        initialFilters?.performance ||
        defaultFiltersState.performance,
      sort:
        (urlSort as 'listing_date' | 'listing_gain' | 'subscription') ||
        initialFilters?.sort ||
        defaultFiltersState.sort,
      sortOrder:
        (urlSortOrder as 'ASC' | 'DESC') ||
        initialFilters?.sortOrder ||
        defaultFiltersState.sortOrder,
      searchQuery,
      search: searchQuery, // Alias for compatibility
      page: urlPage ? parseInt(urlPage, 10) : initialFilters?.page || defaultFiltersState.page,
      limit: urlLimit ? parseInt(urlLimit, 10) : initialFilters?.limit || defaultFiltersState.limit,
    };
  });

  // Sync filters to URL
  const updateURL = useCallback(
    (newFilters: HistoricalFiltersState) => {
      const params = new URLSearchParams();

      // Only add non-default values to URL
      if (newFilters.year !== defaultFiltersState.year) {
        params.set('year', newFilters.year);
      }
      if (newFilters.sector !== defaultFiltersState.sector) {
        params.set('sector', newFilters.sector);
      }
      if (newFilters.performance !== defaultFiltersState.performance) {
        params.set('performance', newFilters.performance);
      }
      if (newFilters.sort !== defaultFiltersState.sort) {
        params.set('sort', newFilters.sort);
      }
      if (newFilters.sortOrder !== defaultFiltersState.sortOrder) {
        params.set('sortOrder', newFilters.sortOrder);
      }
      if (newFilters.searchQuery) {
        params.set('search', newFilters.searchQuery);
      }
      if (newFilters.page > 1) {
        params.set('page', newFilters.page.toString());
      }

      const queryString = params.toString();
      const newURL = queryString ? `${pathname}?${queryString}` : pathname;
      router.push(newURL, { scroll: false });
    },
    [pathname, router]
  );

  // Update filter methods
  const setYear = useCallback(
    (year: string) => {
      const newFilters = { ...filters, year, page: 1 };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setSector = useCallback(
    (sector: string) => {
      const newFilters = { ...filters, sector, page: 1 };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setPerformance = useCallback(
    (performance: 'All' | 'Positive' | 'Negative') => {
      const newFilters = { ...filters, performance, page: 1 };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setSort = useCallback(
    (sort: string, sortOrder: 'ASC' | 'DESC') => {
      const newFilters = {
        ...filters,
        sort: sort as 'listing_date' | 'listing_gain' | 'subscription',
        sortOrder,
        page: 1,
      };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setSearchQuery = useCallback(
    (query: string) => {
      const newFilters = { ...filters, searchQuery: query, page: 1 };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setPage = useCallback(
    (page: number) => {
      const newFilters = { ...filters, page };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const setSortOrder = useCallback(
    (sortOrder: 'ASC' | 'DESC') => {
      const newFilters = { ...filters, sortOrder, page: 1 };
      setFilters(newFilters);
      updateURL(newFilters);
    },
    [filters, updateURL]
  );

  const clearFilters = useCallback(() => {
    setFilters(defaultFiltersState);
    updateURL(defaultFiltersState);
  }, [updateURL]);

  // Wrapper method to call updateURL with current filters
  const updateURLWithCurrentFilters = useCallback(() => {
    updateURL(filters);
  }, [filters, updateURL]);

  // Check if there are active filters
  const hasActiveFilters =
    filters.year !== defaultFiltersState.year ||
    filters.sector !== defaultFiltersState.sector ||
    filters.performance !== defaultFiltersState.performance ||
    filters.searchQuery !== defaultFiltersState.searchQuery;

  const value: HistoricalFiltersContextValue = {
    filters,
    setYear,
    setSector,
    setPerformance,
    setSort,
    setSortOrder,
    setSearchQuery,
    setSearch: setSearchQuery, // Alias for compatibility
    setPage,
    clearFilters,
    updateURL: updateURLWithCurrentFilters,
    hasActiveFilters,
  };

  return (
    <HistoricalFiltersContext.Provider value={value}>
      {children}
    </HistoricalFiltersContext.Provider>
  );
}

export function useHistoricalFilters() {
  const context = useContext(HistoricalFiltersContext);
  if (context === undefined) {
    throw new Error('useHistoricalFilters must be used within a HistoricalFiltersProvider');
  }
  return context;
}
