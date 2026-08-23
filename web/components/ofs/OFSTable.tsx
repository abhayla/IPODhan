/**
 * OFS Table Component
 *
 * Client-side table component for displaying OFS issues.
 * Uses enhanced DataTable with Column Search, Year Filter, and Pagination.
 *
 * Story 9.5: Offer for Sale (OFS) Page
 */

'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { DataTable, type ColumnDef, renderFunctions, getAvailableYears, getLatestYearWithData } from '@/components/shared/DataTable';
import type { OFSData } from '@/lib/services/ofs-service';

// ==================== TYPES ====================

export interface OFSTableProps {
  ofsIssues: OFSData[];
}

// ==================== COLUMN DEFINITIONS ====================

/**
 * Column definitions for OFS DataTable
 * Displays: Issuer Company, Non Retail Date, Retail Date
 *
 * AC#2: Table displays correct columns
 */
const ofsColumns: ColumnDef<OFSData>[] = [
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
    key: 'nonRetailDate',
    header: 'Non Retail Date',
    sortable: true,
    searchable: false,
    align: 'center',
    render: (value) => renderFunctions.date(value, 'MMM dd, yyyy'),
  },
  {
    key: 'retailDate',
    header: 'Retail Date',
    sortable: true,
    searchable: false,
    align: 'center',
    render: (value) => renderFunctions.date(value, 'MMM dd, yyyy'),
  },
];

// ==================== COMPONENT ====================

/**
 * OFS Table Component
 *
 * Features:
 * - Uses DataTable with Sorting, Column Search, Year Filter, and Pagination
 * - Client-side filtering for year and search
 * - Responsive design (cards on mobile via DataTable)
 *
 * AC#2: Table displays correct columns
 * AC#4: Educational banner (in parent page component)
 * AC#6: Responsive design via DataTable
 * AC#7: Empty state handled by DataTable
 */
export function OFSTable({ ofsIssues }: OFSTableProps) {
  // State management for DataTable features
  const [searches, setSearches] = useState<Record<string, string>>({});
  // T-286 (P2-1): derived from the data (latest year with rows), not a
  // hardcoded '2025' that hid every 2026 OFS entry on first paint.
  const [year, setYear] = useState<string>(() =>
    getLatestYearWithData(ofsIssues, (item) => item.nonRetailDate || item.retailDate)
  );
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<{ field: string; order: 'asc' | 'desc' }>({
    field: 'nonRetailDate',
    order: 'asc',
  });

  // Filter data by year
  const filterByYear = useCallback((data: OFSData[], yearFilter: string) => {
    if (!yearFilter) return data;
    return data.filter((item) => {
      const date = item.nonRetailDate || item.retailDate;
      if (!date) return false;
      return new Date(date).getFullYear().toString() === yearFilter;
    });
  }, []);

  // Filter data by search
  const filterBySearch = useCallback((data: OFSData[], searchFilters: Record<string, string>) => {
    if (Object.keys(searchFilters).length === 0) return data;

    return data.filter((item) => {
      return Object.entries(searchFilters).every(([key, value]) => {
        if (!value) return true;
        const itemValue = item[key as keyof OFSData];
        if (itemValue === null || itemValue === undefined) return false;
        return itemValue.toString().toLowerCase().includes(value.toLowerCase());
      });
    });
  }, []);

  // Apply filters to data
  const filteredData = filterBySearch(filterByYear(ofsIssues, year), searches);

  // Handle search
  const handleSearch = useCallback((newSearches: Record<string, string>) => {
    setSearches(newSearches);
    setPage(1); // Reset to page 1 on search
  }, []);

  // Handle year change
  const handleYearChange = useCallback((newYear: string) => {
    setYear(newYear);
    setPage(1); // Reset to page 1 on filter
  }, []);

  // Handle sort
  const handleSort = useCallback((field: string, order: 'asc' | 'desc') => {
    setSortState({ field, order });
  }, []);

  return (
    <div className="space-y-8">
      {/* Educational Banner (AC#4) */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-3 text-blue-900">What is an OFS?</h2>
        <p className="text-sm text-blue-800 leading-relaxed">
          An <strong>Offer for Sale (OFS)</strong> is a mechanism for promoters or large shareholders
          to sell shares to the public through the stock exchange. Unlike an IPO, the shares are sold
          by existing shareholders, not issued by the company. OFS has two bidding days:
        </p>
        <ul className="list-disc list-inside text-sm text-blue-800 mt-3 space-y-1 ml-4">
          <li><strong>Day 1 (Non-Retail Date):</strong> Institutional and non-retail investors place bids</li>
          <li><strong>Day 2 (Retail Date):</strong> Retail individual investors place bids</li>
        </ul>
        <p className="text-sm text-blue-800 mt-3">
          OFS helps companies meet minimum public shareholding norms and provides liquidity to existing shareholders.
        </p>
      </div>

      {/* OFS DataTable (AC#2, AC#6, AC#7) */}
      <DataTable
        data={filteredData}
        columns={ofsColumns}
        emptyMessage="No OFS available" // AC#7
        keyExtractor={(row) => row.id}

        // Enable advanced features for OFS page
        enableColumnSearch={true}
        enableYearFilter={true}
        enablePagination={true}

        // Sort configuration
        currentSort={sortState}
        onSort={handleSort}

        // Column search configuration
        columnSearchConfig={{
          currentSearches: searches,
          onSearch: handleSearch,
        }}

        // Year filter configuration
        yearFilterConfig={{
          availableYears: getAvailableYears(year),
          selectedYear: year,
          onYearChange: handleYearChange,
        }}

        // Pagination configuration
        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          totalRecords: filteredData.length,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
