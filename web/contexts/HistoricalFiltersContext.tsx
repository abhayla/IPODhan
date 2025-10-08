'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export interface HistoricalFilters {
  year?: string;
  sector?: string;
  performance?: 'Positive' | 'Negative' | 'All';
  search?: string;
  sort?: 'listing_date' | 'listing_gain' | 'subscription';
  sortOrder?: 'asc' | 'desc';
  page: number;
  limit: number;
}

interface HistoricalFiltersContextType {
  filters: HistoricalFilters;
  setYear: (year: string | undefined) => void;
  setSector: (sector: string | undefined) => void;
  setPerformance: (performance: 'Positive' | 'Negative' | 'All' | undefined) => void;
  setSearch: (search: string | undefined) => void;
  setSort: (sort: 'listing_date' | 'listing_gain' | 'subscription' | undefined) => void;
  setSortOrder: (sortOrder: 'asc' | 'desc' | undefined) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  clearFilters: () => void;
  updateURL: () => void;
}

const HistoricalFiltersContext = createContext<HistoricalFiltersContextType | undefined>(
  undefined
);

const DEFAULT_FILTERS: HistoricalFilters = {
  page: 1,
  limit: 20,
  sort: 'listing_date',
  sortOrder: 'desc',
};

interface HistoricalFiltersProviderProps {
  children: ReactNode;
  initialFilters?: Partial<HistoricalFilters>;
}

export function HistoricalFiltersProvider({
  children,
  initialFilters = {},
}: HistoricalFiltersProviderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize filters from URL params or defaults
  const [filters, setFilters] = useState<HistoricalFilters>(() => {
    return {
      year: searchParams.get('year') || initialFilters.year,
      sector: searchParams.get('sector') || initialFilters.sector,
      performance: (searchParams.get('performance') as 'Positive' | 'Negative' | 'All') || initialFilters.performance,
      search: searchParams.get('search') || initialFilters.search,
      sort: (searchParams.get('sort') as 'listing_date' | 'listing_gain' | 'subscription') || initialFilters.sort || DEFAULT_FILTERS.sort,
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || initialFilters.sortOrder || DEFAULT_FILTERS.sortOrder,
      page: Number(searchParams.get('page')) || initialFilters.page || DEFAULT_FILTERS.page,
      limit: Number(searchParams.get('limit')) || initialFilters.limit || DEFAULT_FILTERS.limit,
    };
  });

  const updateURL = useCallback(() => {
    const params = new URLSearchParams();

    if (filters.year) params.set('year', filters.year);
    if (filters.sector) params.set('sector', filters.sector);
    if (filters.performance) params.set('performance', filters.performance);
    if (filters.search) params.set('search', filters.search);
    if (filters.sort && filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
    if (filters.sortOrder && filters.sortOrder !== DEFAULT_FILTERS.sortOrder) params.set('sortOrder', filters.sortOrder);
    if (filters.page !== DEFAULT_FILTERS.page) params.set('page', filters.page.toString());
    if (filters.limit !== DEFAULT_FILTERS.limit) params.set('limit', filters.limit.toString());

    const queryString = params.toString();
    router.push(`/history${queryString ? `?${queryString}` : ''}`, { scroll: false });
  }, [filters, router]);

  const setYear = useCallback((year: string | undefined) => {
    setFilters((prev) => ({ ...prev, year, page: 1 }));
  }, []);

  const setSector = useCallback((sector: string | undefined) => {
    setFilters((prev) => ({ ...prev, sector, page: 1 }));
  }, []);

  const setPerformance = useCallback((performance: 'Positive' | 'Negative' | 'All' | undefined) => {
    setFilters((prev) => ({ ...prev, performance, page: 1 }));
  }, []);

  const setSearch = useCallback((search: string | undefined) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }));
  }, []);

  const setSort = useCallback((sort: 'listing_date' | 'listing_gain' | 'subscription' | undefined) => {
    setFilters((prev) => ({ ...prev, sort, page: 1 }));
  }, []);

  const setSortOrder = useCallback((sortOrder: 'asc' | 'desc' | undefined) => {
    setFilters((prev) => ({ ...prev, sortOrder, page: 1 }));
  }, []);

  const setPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  }, []);

  const setLimit = useCallback((limit: number) => {
    setFilters((prev) => ({ ...prev, limit, page: 1 }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const value: HistoricalFiltersContextType = {
    filters,
    setYear,
    setSector,
    setPerformance,
    setSearch,
    setSort,
    setSortOrder,
    setPage,
    setLimit,
    clearFilters,
    updateURL,
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
