/**
 * MainboardProspectusClient Component
 *
 * Client-side component for handling interactivity:
 * - Filter state management
 * - URL synchronization
 * - Client-side sorting
 * - Data fetching
 *
 * Story 9.8a: Mainboard IPO Prospectus PDF Download Page
 * AC#4, AC#5, AC#8: Search, sorting, and real-time updates
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ColumnSearch } from './ColumnSearch';
import { MainboardProspectusTable } from './MainboardProspectusTable';
import { formatExchanges } from '@/lib/utils/prospectus-utils';

export interface MainboardProspectusData {
  ipo: {
    id: string;
    companyName: string;
    slug: string;
    segment: 'MAINBOARD' | 'SME';
    offeringType: string;
    listingExchanges: ('NSE' | 'BSE')[] | null;
  };
  drhpDocument: {
    id: string;
    title: string;
    url: string;
    fileSize: number | null;
    uploadedAt: Date;
  } | null;
  rhpDocument: {
    id: string;
    title: string;
    url: string;
    fileSize: number | null;
    uploadedAt: Date;
  } | null;
}

export interface ProspectusResponse {
  data: MainboardProspectusData[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ==================== COMPONENT ====================

export function MainboardProspectusClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // State
  const [data, setData] = useState<ProspectusResponse>({
    data: [],
    total: 0,
    page: 1,
    limit: 50,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<'companyName' | 'exchange' | ''>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Get filter values from URL
  const companyName = searchParams.get('companyName') || '';
  const exchange = (searchParams.get('exchange') as 'All' | 'BSE' | 'NSE' | 'Both') || 'All';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Fetch data when filters change
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '50',
        });

        if (companyName) params.append('companyName', companyName);
        if (exchange && exchange !== 'All') params.append('exchange', exchange);

        const response = await fetch(`/api/prospectus/mainboard?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch prospectus documents');
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        console.error('Error fetching prospectus data:', err);
        setError('Failed to load prospectus documents. Please try again later.');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [companyName, exchange, page]);

  // Update URL when filters change
  const updateURL = (newParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);

    Object.entries(newParams).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    // Reset to page 1 when filters change (except when changing page)
    if (!newParams.page) {
      params.delete('page');
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  // Handle company name search (AC#4, AC#8 - debounced)
  const handleCompanyNameChange = (value: string) => {
    updateURL({ companyName: value });
  };

  // Handle exchange filter change (AC#4)
  const handleExchangeChange = (value: string) => {
    updateURL({ exchange: value === 'All' ? '' : value });
  };

  // Handle page change (AC#13)
  const handlePageChange = (newPage: number) => {
    updateURL({ page: newPage.toString() });
  };

  // Handle sorting (AC#5 - client-side)
  const handleSort = (column: 'companyName' | 'exchange') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Apply client-side sorting
  const sortedData = [...data.data].sort((a, b) => {
    if (!sortColumn) return 0;

    let aValue: string;
    let bValue: string;

    if (sortColumn === 'companyName') {
      aValue = a.ipo.companyName;
      bValue = b.ipo.companyName;
    } else if (sortColumn === 'exchange') {
      aValue = formatExchanges(a.ipo.listingExchanges);
      bValue = formatExchanges(b.ipo.listingExchanges);
    } else {
      return 0;
    }

    const comparison = aValue.localeCompare(bValue);
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  return (
    <div className="space-y-6">
      {/* Search Filters (AC#4) */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-2 block">Company Name</label>
          <ColumnSearch
            type="text"
            placeholder="Search by company name..."
            value={companyName}
            onChange={handleCompanyNameChange}
            debounceMs={300}
          />
        </div>
        <div className="w-full md:w-48">
          <label className="text-sm font-medium mb-2 block">Exchange</label>
          <ColumnSearch
            type="select"
            placeholder="Select exchange"
            value={exchange}
            onChange={handleExchangeChange}
            options={[
              { label: 'All Exchanges', value: 'All' },
              { label: 'BSE', value: 'BSE' },
              { label: 'NSE', value: 'NSE' },
              { label: 'Both', value: 'Both' },
            ]}
          />
        </div>
      </div>

      {/* Prospectus Table */}
      <MainboardProspectusTable
        prospectusData={sortedData}
        loading={loading}
        error={error}
        total={data.total}
        page={data.page}
        limit={data.limit}
        onPageChange={handlePageChange}
        onSort={handleSort}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
      />
    </div>
  );
}
