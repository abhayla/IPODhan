/**
 * NCD Table Component
 *
 * Client-side table component for displaying NCD issues.
 * Uses enhanced DataTable with Column Search, Year Filter, and Pagination.
 *
 * Story 9.6: NCD Issue Page
 */

'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { DataTable, type ColumnDef, renderFunctions, DEFAULT_IPO_YEARS_EXPORT } from '@/components/shared/DataTable';
import type { NCDData } from '@/lib/services/ncd-service';

// ==================== TYPES ====================

export interface NCDTableProps {
  ncdIssues: NCDData[];
}

// ==================== COLUMN DEFINITIONS ====================

/**
 * Column definitions for NCD DataTable
 * Displays: Issuer Company, Open Date, Close Date
 *
 * AC#2: Table displays correct columns
 */
const ncdColumns: ColumnDef<NCDData>[] = [
  {
    key: 'companyName',
    header: 'Issuer Company',
    sortable: true,
    searchable: true,
    className: 'font-semibold',
    minWidth: '250px',
    render: (value, row) => (
      <Link
        href={`/ipo/${row.slug}`}
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
 * NCD Table Component
 *
 * Features:
 * - Uses DataTable with Sorting, Column Search, Year Filter, and Pagination
 * - Client-side filtering for year and search
 * - Responsive design (cards on mobile via DataTable)
 *
 * AC#2: Table displays correct columns
 * AC#4: Educational banner explaining NCD concept
 * AC#7: Responsive design via DataTable
 * AC#8: NCDs sorted by Open Date (descending - newest first)
 * AC#9: Empty state handled by DataTable
 */
export function NCDTable({ ncdIssues }: NCDTableProps) {
  // State management for DataTable features
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [year, setYear] = useState<string>('2025');
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<{ field: string; order: 'asc' | 'desc' }>({
    field: 'openDate',
    order: 'desc', // AC#8: Newest first (descending)
  });

  // Filter data by year
  const filterByYear = useCallback((data: NCDData[], yearFilter: string) => {
    if (!yearFilter) return data;
    return data.filter((item) => {
      const date = item.openDate || item.closeDate;
      if (!date) return false;
      return new Date(date).getFullYear().toString() === yearFilter;
    });
  }, []);

  // Filter data by search
  const filterBySearch = useCallback((data: NCDData[], searchFilters: Record<string, string>) => {
    if (Object.keys(searchFilters).length === 0) return data;

    return data.filter((item) => {
      return Object.entries(searchFilters).every(([key, value]) => {
        if (!value) return true;
        const itemValue = item[key as keyof NCDData];
        if (itemValue === null || itemValue === undefined) return false;
        return itemValue.toString().toLowerCase().includes(value.toLowerCase());
      });
    });
  }, []);

  // Apply filters to data
  const filteredData = filterBySearch(filterByYear(ncdIssues, year), searches);

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
        <h2 className="text-xl font-bold mb-3 text-blue-900">What are NCDs?</h2>
        <p className="text-sm text-blue-800 leading-relaxed">
          <strong>Non-Convertible Debentures (NCDs)</strong> are fixed-income debt instruments that
          offer regular interest payments. Unlike convertible debentures, NCDs cannot be converted
          into equity shares. They are issued by companies to raise capital and are listed on stock
          exchanges for trading.
        </p>
        <ul className="list-disc list-inside text-sm text-blue-800 mt-3 space-y-1 ml-4">
          <li><strong>Fixed Returns:</strong> NCDs offer predetermined interest rates (coupon rates)</li>
          <li><strong>No Equity Conversion:</strong> Cannot be converted to company shares</li>
          <li><strong>Trading:</strong> Can be bought and sold on stock exchanges</li>
          <li><strong>Risk Profile:</strong> Lower risk than equity, suitable for conservative investors</li>
        </ul>
        <p className="text-sm text-blue-800 mt-3">
          NCDs are ideal for investors seeking fixed returns with relatively lower risk compared to equity investments.
        </p>
      </div>

      {/* NCD DataTable (AC#2, AC#7, AC#8, AC#9) */}
      <DataTable
        data={filteredData}
        columns={ncdColumns}
        emptyMessage="No NCDs available" // AC#9
        keyExtractor={(row) => row.id}

        // Enable advanced features for NCD page
        enableColumnSearch={true}
        enableYearFilter={true}
        enablePagination={true}

        // Sort configuration (AC#8: Default newest first)
        currentSort={sortState}
        onSort={handleSort}

        // Column search configuration
        columnSearchConfig={{
          currentSearches: searches,
          onSearch: handleSearch,
        }}

        // Year filter configuration
        yearFilterConfig={{
          availableYears: DEFAULT_IPO_YEARS_EXPORT,
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
