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

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
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

// ==================== REAL DATA FETCH ====================

/**
 * Raw row shape returned by GET /api/ipos/history (the fields this page needs).
 * See web/app/api/ipos/history/route.ts and IPORepository.findHistorical().
 */
interface HistoricalIPOApiRow {
  id: string;
  companyName: string;
  slug: string;
  segment: 'MAINBOARD' | 'SME' | null;
  listingDate: string | null;
  issuePrice: string | number | null;
  listingClose: string | number | null;
  listingGainPercent: number | null;
  currentPriceLive: number | null;
  currentGainLive: number | null;
}

interface HistoricalIPOApiResponse {
  data: HistoricalIPOApiRow[];
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch REAL Mainboard IPO performance data from the historical IPOs API
 * (backed by the ipos + listing_performance tables) and filter to segment=MAINBOARD.
 * Returns an empty array (honest empty state) if the request fails or no rows match.
 */
async function fetchMainboardPerformanceData(year: string): Promise<PerformanceData[]> {
  const params = new URLSearchParams({
    year,
    sort: 'listing_date',
    sortOrder: 'desc',
    limit: '100',
  });
  const response = await fetch(`/api/ipos/history?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Historical IPO API returned ${response.status}`);
  }
  const json: HistoricalIPOApiResponse = await response.json();

  return json.data
    // T-277F checker finding #3: `row.listingGainPercent ?? 0` used to render
    // a row with NO listing_performance data (e.g. a reclassified trust with
    // no listing gain computed) as a fake 0.00/+0.00% instead of being
    // excluded. A null listingGainPercent means "no performance data yet" —
    // that row does not belong on a PERFORMANCE tracker at all.
    .filter((row) => row.segment === 'MAINBOARD' && row.listingGainPercent !== null)
    .map((row) => {
      const issuePrice = toNumber(row.issuePrice) ?? 0;
      const listingDayClose = toNumber(row.listingClose) ?? 0;
      return {
        id: row.id,
        companyName: row.companyName,
        slug: row.slug,
        listedOn: row.listingDate,
        issuePrice,
        listingDayClose,
        listingDayGain: row.listingGainPercent as number,
        currentPrice: row.currentPriceLive,
        profitLoss: row.currentGainLive,
      };
    });
}

// ==================== MAIN CLIENT COMPONENT ====================

interface MainboardPerformanceTrackerClientProps {
  initialYear: string;
  /**
   * Server-rendered rows for `initialYear` (P3-13, T-302). When present, the
   * first paint already shows real data and skips the loading skeleton;
   * client-side fetching still runs on year changes.
   */
  initialData?: PerformanceData[];
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
  initialData,
}: MainboardPerformanceTrackerClientProps) {
  const router = useRouter();

  // AC#3: Year filter with default current year
  const [year, setYear] = useState<string>(initialYear);
  const [page, setPage] = useState(1);
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>(initialData ?? []);
  // Server-rendered data for the initial year means the first paint is
  // already real — only show the loading skeleton when no initial data was
  // provided (P3-13, T-302).
  const [loading, setLoading] = useState(initialData === undefined);
  const hasServerData = useRef(initialData !== undefined);

  // Fetch performance data (AC#5: Mainboard IPOs only)
  useEffect(() => {
    // Skip the redundant client-side refetch on first mount when the server
    // already rendered this exact year's data.
    if (hasServerData.current) {
      hasServerData.current = false;
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const data = await fetchMainboardPerformanceData(year);
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
            <strong>Note:</strong> Current Price and Profit/Loss reflect the latest data our
            tracker has recorded and may lag live market prices.
          </p>
        </div>
      </div>
    </div>
  );
}
