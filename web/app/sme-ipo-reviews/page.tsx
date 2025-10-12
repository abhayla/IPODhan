'use client';

/**
 * SME IPO Reviews & Analysis Page
 *
 * Displays expert SME IPO reviews and analysis from SEBI registered analysts.
 * Features:
 * - Year navigation with URL query params
 * - Column-level search (review title, author, recommendation, IPO name)
 * - Sortable columns
 * - Pagination (50 records per page)
 * - Educational header explaining review benefits
 */

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';
import Link from 'next/link';
import {
  getSMEIPOReviews,
  type Review,
} from '@/lib/services/sme-reviews-service';

// ===== EDUCATIONAL HEADER COMPONENT =====

function ReviewsHeader() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold mb-3 text-gray-900">
        SME IPO Reviews & Analysis
      </h2>
      <p className="text-sm text-gray-700 mb-2">
        IPO forecast helps investors decide if the SME IPO is worth investing in.
        Our analysis covers:
      </p>
      <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 ml-2">
        <li>Company background and offer details</li>
        <li>Company valuation and capital structure</li>
        <li>Financial performance and strengths</li>
        <li>Risks & benefits analysis</li>
        <li>Peer comparison</li>
      </ul>
      <p className="text-sm text-gray-600 mt-3 italic">
        Analysis tailored for both short and long-term investors
      </p>
    </div>
  );
}

// ===== COLUMN DEFINITIONS =====

const columns: ColumnDef<Review>[] = [
  {
    key: 'rowNumber',
    header: '#',
    sortable: false,
    searchable: false,
    align: 'center',
    className: 'w-16',
    render: (_value: any, _row: Review, index?: number) => (index ?? 0) + 1,
  },
  {
    key: 'reviewTitle',
    header: 'Review Title',
    searchable: true,
    className: 'min-w-[300px]',
    render: (value: string, row: Review) =>
      renderFunctions.link(value, `/ipo-reviews/${row.id}`),
  },
  {
    key: 'author',
    header: 'Author',
    searchable: true,
    className: 'min-w-[200px]',
  },
  {
    key: 'recommendation',
    header: 'Recommendation',
    searchable: true,
    className: 'min-w-[150px]',
    render: (value: string) => (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        {value}
      </span>
    ),
  },
  {
    key: 'ipoName',
    header: 'IPO',
    searchable: true,
    className: 'min-w-[200px]',
    render: (value: string, row: Review) =>
      renderFunctions.link(value, `/ipos/${row.ipoSlug}`),
  },
];

// ===== MAIN PAGE COMPONENT =====

export default function SMEIPOReviewsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ===== STATE =====

  const [year, setYear] = useState(
    searchParams.get('year') || new Date().getFullYear().toString()
  );
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [data, setData] = useState<Review[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ===== DATA FETCHING =====

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const result = await getSMEIPOReviews(Number(year), {
          reviewTitle: searches.reviewTitle,
          author: searches.author,
          recommendation: searches.recommendation,
          ipoName: searches.ipoName,
          page,
        });

        setData(result.reviews);
        setTotalCount(result.totalCount);
      } catch (err) {
        console.error('Error fetching reviews:', err);
        setError('Failed to load SME IPO reviews. Please try again later.');
        setData([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [year, page, searches]);

  // ===== EVENT HANDLERS =====

  const handleYearChange = (newYear: string) => {
    setYear(newYear);
    setPage(1);
    router.push(`/sme-ipo-reviews?year=${newYear}`);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`/sme-ipo-reviews?${params.toString()}`);
  };

  const handleSearch = (newSearches: Record<string, string>) => {
    setSearches(newSearches);
    setPage(1);
  };

  // ===== RENDER =====

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-6 animate-pulse" />
        <div className="bg-gray-100 rounded-lg p-6 mb-6 animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-3" />
          <div className="h-4 bg-gray-200 rounded w-full mb-2" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4">
        <h1 className="text-3xl font-bold mb-6">
          SME IPO Reviews & Analysis
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">
        SME IPO Reviews & Analysis
      </h1>

      <ReviewsHeader />

      <div className="mb-4 text-sm text-gray-600">
        Total Records: {totalCount}
      </div>

      <DataTable
        data={data}
        columns={columns}
        emptyMessage={`No SME IPO reviews available for ${year}`}
        keyExtractor={(row) => row.id}
        enableColumnSearch={true}
        enableYearFilter={true}
        enablePagination={true}
        yearFilterConfig={{
          selectedYear: year,
          onYearChange: handleYearChange,
        }}
        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          totalRecords: totalCount,
          onPageChange: handlePageChange,
        }}
        columnSearchConfig={{
          onSearch: handleSearch,
          currentSearches: searches,
        }}
      />
    </div>
  );
}
