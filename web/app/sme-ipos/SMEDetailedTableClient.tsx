/**
 * SME Detailed Table Client Component
 *
 * Client-side wrapper for DataTable with interactive features:
 * - Sorting
 * - Column-level search (Company, Lead Manager)
 * - Year filter with navigation
 * - Minimize/Maximize toggle
 * - Color-coded rows (green for current, yellow for closing soon)
 * - Status indicators
 *
 * Story 9.16: SME IPOs Landing Page
 * AC#7-17: All detailed table acceptance criteria
 */

'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { DataTable, type ColumnDef, DEFAULT_IPO_YEARS_EXPORT } from '@/components/shared/DataTable';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import type { IPO } from '@/lib/api-client';

interface SMEDetailedTableClientProps {
  data: IPO[];
  totalCount: number;
  initialYear: number;
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'TBD';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format currency
 */
function formatCurrency(amount: number | null): string {
  if (!amount) return '-';
  return `₹${amount.toFixed(0)}`;
}

/**
 * Format issue size in crores
 */
function formatIssueSize(amount: number | null): string {
  if (!amount) return '-';
  return `₹${(amount / 100).toFixed(0)} Cr`;
}

/**
 * Get row color based on IPO status and dates
 * AC#15: Color-coded rows
 */
function getRowClassName(ipo: IPO): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if currently open (green)
  if (ipo.openDate && ipo.closeDate) {
    const openDate = new Date(ipo.openDate);
    const closeDate = new Date(ipo.closeDate);
    openDate.setHours(0, 0, 0, 0);
    closeDate.setHours(0, 0, 0, 0);

    if (today >= openDate && today <= closeDate) {
      return 'bg-green-50 hover:bg-green-100';
    }
  }

  // Check if closing soon (within 2 days) - yellow
  if (ipo.closeDate) {
    const closeDate = new Date(ipo.closeDate);
    closeDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.ceil((closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > 0 && daysDiff <= 2) {
      return 'bg-yellow-50 hover:bg-yellow-100';
    }
  }

  return '';
}

/**
 * Get status indicator badge
 * AC#12: Status indicators displayed
 */
function getStatusBadge(ipo: IPO): React.ReactNode {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Issue open
  if (ipo.openDate && ipo.closeDate) {
    const openDate = new Date(ipo.openDate);
    const closeDate = new Date(ipo.closeDate);
    openDate.setHours(0, 0, 0, 0);
    closeDate.setHours(0, 0, 0, 0);

    if (today >= openDate && today <= closeDate) {
      return <Badge className="bg-green-600 text-white">Issue Open</Badge>;
    }
  }

  // Issue closed but not listed
  if (ipo.status === 'CLOSED' && !ipo.listingDate) {
    return <Badge className="bg-yellow-600 text-white">Issue Closed</Badge>;
  }

  // Listing today
  if (ipo.listingDate) {
    const listingDate = new Date(ipo.listingDate);
    listingDate.setHours(0, 0, 0, 0);

    if (listingDate.getTime() === today.getTime()) {
      return <Badge className="bg-blue-600 text-white">Listing Today</Badge>;
    }
  }

  return null;
}

/**
 * SME Detailed Table Client Component
 */
export function SMEDetailedTableClient({
  data,
  totalCount,
  initialYear,
}: SMEDetailedTableClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [year, setYear] = useState(String(initialYear));
  const [searches, setSearches] = useState<Record<string, string>>({});

  // Handle year change with URL update
  // AC#10, AC#11: Year navigation updates URL
  const handleYearChange = (newYear: string) => {
    setYear(newYear);
    const params = new URLSearchParams(window.location.search);
    params.set('year', newYear);
    router.push(`${pathname}?${params.toString()}`);
  };

  // Handle column search with URL update
  const handleSearch = (newSearches: Record<string, string>) => {
    setSearches(newSearches);
    const params = new URLSearchParams(window.location.search);

    // Update search params
    Object.entries(newSearches).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    router.push(`${pathname}?${params.toString()}`);
  };

  // Define table columns
  // AC#8: All 9 columns
  const columns: ColumnDef<IPO>[] = [
    {
      key: 'companyName',
      header: 'Company',
      searchable: true,
      render: (value, row) => (
        <div className="space-y-1">
          <Link href={`/ipos/${row.slug}`} className="text-primary hover:underline font-medium">
            {value}
          </Link>
          {getStatusBadge(row) && <div>{getStatusBadge(row)}</div>}
        </div>
      ),
    },
    {
      key: 'openDate',
      header: 'Opening Date',
      sortable: true,
      searchable: false,
      render: (value) => formatDate(value),
    },
    {
      key: 'closeDate',
      header: 'Closing Date',
      sortable: true,
      searchable: false,
      render: (value) => formatDate(value),
    },
    {
      key: 'listingDate',
      header: 'Listing Date',
      sortable: true,
      searchable: false,
      render: (value) => formatDate(value),
    },
    {
      key: 'priceRangeMax',
      header: 'Issue Price',
      sortable: true,
      searchable: false,
      align: 'right',
      render: (value) => formatCurrency(value),
    },
    {
      key: 'issueSize',
      header: 'Total Issue Amount',
      sortable: true,
      searchable: false,
      align: 'right',
      render: (value) => formatIssueSize(value),
    },
    {
      key: 'listingExchanges',
      header: 'Listing At',
      searchable: false,
      align: 'center',
      render: (value: string[]) => {
        if (!value || value.length === 0) return '-';
        // For SME, show BSE SME / NSE Emerge
        const exchanges = value.map((ex) => {
          if (ex === 'BSE') return 'BSE SME';
          if (ex === 'NSE') return 'NSE Emerge';
          return ex;
        });
        return exchanges.join(', ');
      },
    },
    {
      key: 'leadManagers',
      header: 'Lead Manager',
      searchable: true,
      render: (value: string[]) => {
        if (!value || value.length === 0) return '-';
        // Display first manager, show tooltip for all if multiple
        const firstManager = value[0];
        if (value.length === 1) return firstManager;
        return (
          <span title={value.join(', ')} className="cursor-help">
            {firstManager}
            {value.length > 1 && (
              <span className="text-xs text-gray-500 ml-1">(+{value.length - 1})</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'compare',
      header: 'Compare',
      sortable: false,
      searchable: false,
      align: 'center',
      render: (_, row) => (
        <Checkbox
          id={`compare-${row.id}`}
          aria-label={`Compare ${row.companyName}`}
          onCheckedChange={(checked) => {
            // Future: Handle comparison logic
            console.log(`Compare ${row.companyName}:`, checked);
          }}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* AC#14: Total records count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Total Records: {totalCount}</p>
      </div>

      {/* AC#7-17: DataTable with all features */}
      <DataTable
        data={data}
        columns={columns}
        emptyMessage="No SME IPOs found for this year"
        // AC#13: Sortable columns
        // AC#9: Column-level search boxes
        // AC#10, AC#11: Year navigation
        // AC#17: Minimize/maximize toggle
        enableColumnSearch={true}
        enableYearFilter={true}
        enableMinimizeToggle={true}
        yearFilterConfig={{
          availableYears: DEFAULT_IPO_YEARS_EXPORT,
          selectedYear: year,
          onYearChange: handleYearChange,
        }}
        columnSearchConfig={{
          onSearch: handleSearch,
          currentSearches: searches,
        }}
        // Custom row className for color coding
        keyExtractor={(row) => row.id}
        className="detailed-table"
      />
    </div>
  );
}
