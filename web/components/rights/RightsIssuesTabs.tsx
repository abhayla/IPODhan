/**
 * Rights Issues Tabs Component
 *
 * Client-side tabs component for switching between Upcoming and Live Rights Issues.
 * Updates URL query params to persist tab state.
 *
 * Story 9.4: Rights Issue Page
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type ColumnDef, getAvailableYears, getLatestYearWithData } from '@/components/shared/DataTable';
import type { RightsIssueData } from '@/lib/services/rights-service';
import { renderFunctions } from '@/components/shared/DataTable';
import Link from 'next/link';

// ==================== TYPES ====================

export interface RightsIssuesTabsProps {
  upcomingRights: RightsIssueData[];
  liveRights: RightsIssueData[];
  initialTab?: 'upcoming' | 'live';
}

// ==================== COLUMN DEFINITIONS ====================

/**
 * Column definitions for Rights Issues DataTable
 * Displays: Issuer Company, Open Date, Close Date
 *
 * T-310: no "Record Date" / "Renunciation Date" columns — the schema doesn't
 * hold those fields, and rendering openDate/closeDate under those labels
 * would misrepresent the actual record date, which decides eligibility.
 */
const rightsIssueColumns: ColumnDef<RightsIssueData>[] = [
  {
    key: 'companyName',
    header: 'Issuer Company',
    sortable: true,
    searchable: true,
    className: 'font-semibold',
    minWidth: '250px',
    render: (value, row) => (
      <Link
        href={`/ipos/${row.slug}`}
        className="text-primary hover:underline font-semibold"
      >
        {value}
      </Link>
    ),
  },
  {
    key: 'openDate',
    header: 'Open Date',
    sortable: true,
    searchable: false,
    align: 'center',
    render: (value) => renderFunctions.date(value, 'MMM dd, yyyy'),
  },
  {
    key: 'closeDate',
    header: 'Close Date',
    sortable: true,
    searchable: false,
    align: 'center',
    render: (value) => renderFunctions.date(value, 'MMM dd, yyyy'),
  },
];

// ==================== COMPONENT ====================

/**
 * Rights Issues Tabs Component
 *
 * Features:
 * - Two tabs: Upcoming and Live
 * - Tab state persists in URL query params
 * - Uses DataTable with Sorting, Column Search, Year Filter, and Pagination
 * - Responsive design (cards on mobile via DataTable)
 *
 * AC#2: Two tabs with proper filtering
 * AC#3: Table displays correct columns
 * AC#4: Tab state persists in URL query params
 * AC#6: Uses existing DataTable component with all required features
 * AC#7: Responsive design
 * AC#9: Loading skeleton via parent
 */
export function RightsIssuesTabs({
  upcomingRights,
  liveRights,
  initialTab = 'upcoming',
}: RightsIssuesTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'live'>(initialTab);
  const [isInitialized, setIsInitialized] = useState(false);

  // Column search state
  const [upcomingSearches, setUpcomingSearches] = useState<Record<string, string>>({});
  const [liveSearches, setLiveSearches] = useState<Record<string, string>>({});

  // Year filter state. T-286 (P1-1): derived from each tab's own data (the
  // latest year with rows), not a hardcoded '2025' that hid every currently
  // open/upcoming 2026 rights issue on first paint.
  const [upcomingYear, setUpcomingYear] = useState<string>(() =>
    getLatestYearWithData(upcomingRights, (item) => item.openDate)
  );
  const [liveYear, setLiveYear] = useState<string>(() =>
    getLatestYearWithData(liveRights, (item) => item.openDate)
  );

  // Pagination state
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [livePage, setLivePage] = useState(1);

  // Sorting state
  const [upcomingSort, setUpcomingSort] = useState<{ field: string; order: 'asc' | 'desc' }>({
    field: 'openDate',
    order: 'asc',
  });
  const [liveSort, setLiveSort] = useState<{ field: string; order: 'asc' | 'desc' }>({
    field: 'openDate',
    order: 'desc',
  });

  // Set initial tab param in URL on mount if not present (AC#4)
  useEffect(() => {
    if (!isInitialized) {
      const currentTab = searchParams.get('tab');
      if (!currentTab) {
        // Set initial tab in URL
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', initialTab);
        router.replace(`?${params.toString()}`, { scroll: false });
      }
      setIsInitialized(true);
    }
  }, [isInitialized, searchParams, initialTab, router]);

  // Handle tab change with URL update (AC#4)
  const handleTabChange = useCallback(
    (value: string) => {
      const newTab = value as 'upcoming' | 'live';
      setActiveTab(newTab);

      // Update URL query params
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', newTab);
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Filter data by year
  const filterByYear = (data: RightsIssueData[], year: string) => {
    if (!year) return data;
    return data.filter((item) => {
      const date = item.openDate;
      if (!date) return false;
      return new Date(date).getFullYear().toString() === year;
    });
  };

  // Filter data by search
  const filterBySearch = (data: RightsIssueData[], searches: Record<string, string>) => {
    if (Object.keys(searches).length === 0) return data;

    return data.filter((item) => {
      return Object.entries(searches).every(([key, value]) => {
        if (!value) return true;
        const itemValue = item[key as keyof RightsIssueData];
        if (itemValue === null || itemValue === undefined) return false;
        return itemValue.toString().toLowerCase().includes(value.toLowerCase());
      });
    });
  };

  // Apply filters to data
  const filteredUpcomingRights = filterBySearch(
    filterByYear(upcomingRights, upcomingYear),
    upcomingSearches
  );
  const filteredLiveRights = filterBySearch(
    filterByYear(liveRights, liveYear),
    liveSearches
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8">
        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        <TabsTrigger value="live">Live</TabsTrigger>
      </TabsList>

      {/* Upcoming Rights Issues Tab */}
      <TabsContent value="upcoming" className="mt-0">
        <DataTable
          data={filteredUpcomingRights}
          columns={rightsIssueColumns}
          emptyMessage="No upcoming rights issues available"
          keyExtractor={(row) => row.id}
          enableColumnSearch={true}
          enableYearFilter={true}
          enablePagination={true}
          currentSort={upcomingSort}
          onSort={(field, order) => setUpcomingSort({ field, order })}
          columnSearchConfig={{
            currentSearches: upcomingSearches,
            onSearch: (searches) => {
              setUpcomingSearches(searches);
              setUpcomingPage(1); // Reset to page 1 on search
            },
          }}
          yearFilterConfig={{
            availableYears: getAvailableYears(upcomingYear),
            selectedYear: upcomingYear,
            onYearChange: (year) => {
              setUpcomingYear(year);
              setUpcomingPage(1); // Reset to page 1 on filter
            },
          }}
          paginationConfig={{
            pageSize: 20,
            currentPage: upcomingPage,
            totalRecords: filteredUpcomingRights.length,
            onPageChange: setUpcomingPage,
          }}
        />
      </TabsContent>

      {/* Live Rights Issues Tab */}
      <TabsContent value="live" className="mt-0">
        <DataTable
          data={filteredLiveRights}
          columns={rightsIssueColumns}
          emptyMessage="No live rights issues available"
          keyExtractor={(row) => row.id}
          enableColumnSearch={true}
          enableYearFilter={true}
          enablePagination={true}
          currentSort={liveSort}
          onSort={(field, order) => setLiveSort({ field, order })}
          columnSearchConfig={{
            currentSearches: liveSearches,
            onSearch: (searches) => {
              setLiveSearches(searches);
              setLivePage(1); // Reset to page 1 on search
            },
          }}
          yearFilterConfig={{
            availableYears: getAvailableYears(liveYear),
            selectedYear: liveYear,
            onYearChange: (year) => {
              setLiveYear(year);
              setLivePage(1); // Reset to page 1 on filter
            },
          }}
          paginationConfig={{
            pageSize: 20,
            currentPage: livePage,
            totalRecords: filteredLiveRights.length,
            onPageChange: setLivePage,
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
