/**
 * Mainboard Performance Tracker Client Component
 *
 * Client-side component for Mainboard IPO Performance Tracker
 * - Handles year filtering with URL state management
 * - Uses DataTable with approved feature configuration
 * - Implements expandable company name links
 * - Color-coded gains/losses with proper formatting
 *
 * Story 9.7a: Mainboard IPO Performance Tracker Page
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';
import { HiChevronDown, HiChevronRight } from 'react-icons/hi2';

// ==================== TYPES ====================

/**
 * Performance Tracker Data Structure
 * Represents a Mainboard IPO with performance metrics
 */
export interface PerformanceData {
  id: string;
  companyName: string;
  slug: string;
  listedOn: string | null;
  issuePrice: number;
  listingDayClose: number;
  listingDayGain: number; // Calculated: ((listingDayClose - issuePrice) / issuePrice) × 100
  currentPrice: number | null;
  profitLoss: number | null; // Calculated: ((currentPrice - issuePrice) / issuePrice) × 100
}

// ==================== EXPANDABLE COMPANY CELL ====================

/**
 * Expandable Company Name Cell
 * Shows company name with expandable links for IPO Detail and Stock Quotes (AC#7, AC#8)
 */
function ExpandableCompanyCell({ companyName, slug }: { companyName: string; slug: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-left hover:text-primary transition-colors font-medium"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} links for ${companyName}`}
      >
        {companyName}
        {expanded ? (
          <HiChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <HiChevronRight className="h-4 w-4 flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="pl-5 space-y-1 text-sm">
          <Link
            href={`/ipos/${slug}`}
            className="text-blue-600 hover:underline block"
            aria-label={`View IPO details for ${companyName}`}
          >
            IPO Detail →
          </Link>
          <a
            href={`https://www.nseindia.com/get-quotes/equity?symbol=${slug.toUpperCase()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline block"
            aria-label={`View stock quotes for ${companyName} on NSE`}
          >
            Stock Quotes (NSE) ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ==================== COLUMN DEFINITIONS ====================

/**
 * Define 7 columns for Performance Tracker (AC#2)
 * Columns:
 * 1. Company Name (with expandable IPO Detail and Stock Quotes links)
 * 2. Listed On (date format)
 * 3. Issue Price (₹) - right-aligned
 * 4. Listing Day Close (₹) - right-aligned
 * 5. Listing Day Gain (%) - right-aligned, color-coded
 * 6. Current Price (₹) - right-aligned
 * 7. Profit/Loss (%) - right-aligned, color-coded
 */
const performanceColumns: ColumnDef<PerformanceData>[] = [
  {
    key: 'companyName',
    header: 'Company Name',
    sortable: true,
    searchable: false, // Column search NOT enabled for performance tracker
    align: 'left',
    minWidth: '200px',
    render: (value, row) => <ExpandableCompanyCell companyName={value} slug={row.slug} />,
  },
  {
    key: 'listedOn',
    header: 'Listed On',
    sortable: true,
    searchable: false,
    align: 'left',
    render: (value) => renderFunctions.date(value, 'MMM dd, yyyy'), // AC#17: date formatting
  },
  {
    key: 'issuePrice',
    header: 'Issue Price',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (value) => {
      // AC#18: Rupee symbol (₹) displayed correctly
      if (value === null || value === undefined) return '-';
      return `₹${value.toFixed(2)}`;
    },
  },
  {
    key: 'listingDayClose',
    header: 'Listing Day Close',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (value) => {
      // AC#18: Rupee symbol (₹) displayed correctly
      if (value === null || value === undefined) return '-';
      return `₹${value.toFixed(2)}`;
    },
  },
  {
    key: 'listingDayGain',
    header: 'Listing Day Gain',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (value) => renderFunctions.percentWithColor(value), // AC#6, AC#17: color coding and 2 decimal precision
  },
  {
    key: 'currentPrice',
    header: 'Current Price',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (value) => {
      // AC#18: Rupee symbol (₹) displayed correctly
      if (value === null || value === undefined) return '-';
      return `₹${value.toFixed(2)}`;
    },
  },
  {
    key: 'profitLoss',
    header: 'Profit/Loss',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (value) => renderFunctions.percentWithColor(value), // AC#6, AC#17: color coding and 2 decimal precision
  },
];

// ==================== MOCK DATA HELPER ====================

/**
 * Generate mock performance data for demonstration
 * In production, this would be fetched from the API with real data
 *
 * NOTE: This is temporary mock data. Replace with actual API call
 * when ListingPerformance table and currentPrice field are available.
 */
function generateMockPerformanceData(year: string): PerformanceData[] {
  const currentYear = new Date().getFullYear();
  const selectedYear = parseInt(year, 10);

  // Return empty if future year
  if (selectedYear > currentYear) {
    return [];
  }

  // Sample data for demonstration (AC#9: accurate calculations)
  const mockData: PerformanceData[] = [
    {
      id: '1',
      companyName: 'Tech Innovations Ltd',
      slug: 'tech-innovations-ltd',
      listedOn: `${year}-10-15`,
      issuePrice: 100,
      listingDayClose: 125.5,
      listingDayGain: 25.5, // ((125.50 - 100) / 100) × 100 = 25.50%
      currentPrice: 145.8,
      profitLoss: 45.8, // ((145.80 - 100) / 100) × 100 = 45.80%
    },
    {
      id: '2',
      companyName: 'Green Energy Solutions',
      slug: 'green-energy-solutions',
      listedOn: `${year}-09-20`,
      issuePrice: 250,
      listingDayClose: 230.0,
      listingDayGain: -8.0, // ((230 - 250) / 250) × 100 = -8.00%
      currentPrice: 215.5,
      profitLoss: -13.8, // ((215.50 - 250) / 250) × 100 = -13.80%
    },
    {
      id: '3',
      companyName: 'Healthcare Plus India',
      slug: 'healthcare-plus-india',
      listedOn: `${year}-08-05`,
      issuePrice: 500,
      listingDayClose: 675.25,
      listingDayGain: 35.05, // ((675.25 - 500) / 500) × 100 = 35.05%
      currentPrice: 820.0,
      profitLoss: 64.0, // ((820 - 500) / 500) × 100 = 64.00%
    },
    {
      id: '4',
      companyName: 'Infrastructure Builders Corp',
      slug: 'infrastructure-builders-corp',
      listedOn: `${year}-07-12`,
      issuePrice: 150,
      listingDayClose: 148.5,
      listingDayGain: -1.0, // ((148.50 - 150) / 150) × 100 = -1.00%
      currentPrice: 162.3,
      profitLoss: 8.2, // ((162.30 - 150) / 150) × 100 = 8.20%
    },
    {
      id: '5',
      companyName: 'Digital Finance Ltd',
      slug: 'digital-finance-ltd',
      listedOn: `${year}-06-18`,
      issuePrice: 300,
      listingDayClose: 385.0,
      listingDayGain: 28.33, // ((385 - 300) / 300) × 100 = 28.33%
      currentPrice: 425.75,
      profitLoss: 41.92, // ((425.75 - 300) / 300) × 100 = 41.92%
    },
    {
      id: '6',
      companyName: 'Manufacturing Excellence Ltd',
      slug: 'manufacturing-excellence-ltd',
      listedOn: `${year}-05-10`,
      issuePrice: 180,
      listingDayClose: 195.6,
      listingDayGain: 8.67, // ((195.6 - 180) / 180) × 100 = 8.67%
      currentPrice: 210.25,
      profitLoss: 16.81, // ((210.25 - 180) / 180) × 100 = 16.81%
    },
  ];

  // AC#10: Sort by listing date descending (newest first)
  return mockData.sort((a, b) => {
    const dateA = a.listedOn ? new Date(a.listedOn).getTime() : 0;
    const dateB = b.listedOn ? new Date(b.listedOn).getTime() : 0;
    return dateB - dateA;
  });
}

// ==================== MAIN CLIENT COMPONENT ====================

interface MainboardPerformanceTrackerClientProps {
  initialYear: string;
}

/**
 * Mainboard Performance Tracker Client Component
 *
 * Uses DataTable with:
 * - ✅ Sorting (always enabled)
 * - ❌ Column Search (NOT enabled for performance tracker per feature matrix)
 * - ✅ Year Filter (enableYearFilter=true)
 * - ✅ Pagination (enablePagination=true)
 * - ❌ Minimize Toggle (NOT enabled for performance tracker)
 */
export function MainboardPerformanceTrackerClient({
  initialYear,
}: MainboardPerformanceTrackerClientProps) {
  const router = useRouter();

  // AC#3: Year filter with default current year
  const [year, setYear] = useState<string>(initialYear);
  const [page, setPage] = useState(1);
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch performance data (AC#5: Mainboard IPOs only)
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // TODO: Replace with actual API call
        // const data = await getMainboardIPOPerformance(parseInt(year, 10));
        const data = generateMockPerformanceData(year);
        setPerformanceData(data);
      } catch (error) {
        console.error('Failed to fetch performance data:', error);
        setPerformanceData([]); // Graceful degradation
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [year]);

  // AC#4: Year filter updates URL query params
  const handleYearChange = (newYear: string) => {
    setYear(newYear);
    setPage(1); // Reset to first page when year changes
    router.push(`/mainboard-ipo-performance-tracker?year=${newYear}`);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  // Pagination configuration
  const pageSize = 50;
  const totalRecords = performanceData.length;
  const paginatedData = performanceData.slice((page - 1) * pageSize, page * pageSize);

  // AC#14: Loading skeleton
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="h-10 w-96 bg-gray-200 rounded animate-pulse mb-4"></div>
          <div className="h-6 w-full max-w-2xl bg-gray-200 rounded animate-pulse"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 w-full bg-gray-200 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          Mainboard IPO Performance Tracker
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Track post-listing performance of Mainboard IPOs with listing day gains and current
          profit/loss percentages. Analyze how Mainboard IPOs have performed since listing.
        </p>
      </div>

      {/* DataTable with Performance Tracker Configuration */}
      {/* AC#2, AC#3, AC#4, AC#6, AC#10, AC#12, AC#13, AC#17, AC#18 */}
      <DataTable
        data={paginatedData}
        columns={performanceColumns}
        emptyMessage={`No Mainboard IPOs listed in ${year}`} // AC#13: empty state message
        keyExtractor={(row) => row.id}
        // Feature flags (per approved feature matrix)
        enableColumnSearch={false} // ❌ NOT enabled for performance tracker
        enableYearFilter={true} // ✅ Year filter enabled
        enablePagination={true} // ✅ Pagination enabled
        enableMinimizeToggle={false} // ❌ NOT enabled for performance tracker
        // Year filter configuration (AC#3, AC#4)
        yearFilterConfig={{
          selectedYear: year,
          onYearChange: handleYearChange,
        }}
        // Pagination configuration
        paginationConfig={{
          pageSize,
          currentPage: page,
          totalRecords,
          onPageChange: handlePageChange,
        }}
      />

      {/* Info Section */}
      <div className="mt-12 border-t pt-8">
        <h2 className="text-2xl font-bold mb-4">About IPO Performance Tracking</h2>
        <div className="prose prose-gray max-w-none">
          <p className="text-muted-foreground">
            The Mainboard IPO Performance Tracker helps investors analyze post-listing performance
            of Mainboard IPOs. Key metrics tracked:
          </p>
          <ul className="list-disc list-inside text-muted-foreground mt-4 space-y-2">
            <li>
              <strong>Listing Day Gain:</strong> Percentage gain or loss on the first day of
              listing compared to issue price
            </li>
            <li>
              <strong>Profit/Loss:</strong> Overall percentage gain or loss from issue price to
              current market price
            </li>
            <li>
              <strong>Color Coding:</strong> Green indicates positive returns, red indicates losses
            </li>
          </ul>
          <p className="text-muted-foreground mt-4">
            <strong>Note:</strong> This page currently displays demonstration data. Real-time
            performance data will be available once the ListingPerformance table and current price
            updates are implemented.
          </p>
        </div>
      </div>
    </div>
  );
}
