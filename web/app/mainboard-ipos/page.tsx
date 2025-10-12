/**
 * Mainboard IPOs Landing Page
 *
 * Comprehensive landing page for Mainboard IPOs with:
 * - Summary metrics (6 cards)
 * - Content sections (6 sections)
 * - Navigation cards (4 cards)
 * - Detailed table with search/filter/sort
 *
 * ISR: 5-minute revalidation
 */

import { Metadata } from 'next';
import Link from 'next/link';
import { MainboardSummaryMetricsSection } from '@/components/mainboard/MainboardSummaryMetrics';
import { MainboardContentSections } from '@/components/mainboard/MainboardContentSections';
import { MainboardNavigationCards } from '@/components/mainboard/MainboardNavigationCards';
import { DataTable, ColumnDef, renderFunctions, DEFAULT_IPO_YEARS_EXPORT } from '@/components/shared/DataTable';
import {
  getMainboardSummaryMetrics,
  getMainboardCurrentIPOs,
  getMainboardUpcomingIPOs,
  getMainboardRecentlyListedIPOs,
  getMainboardReviews,
  getMainboardPerformanceHighlights,
  getMainboardSubscriptionStatus,
  getMainboardDetailedList,
  IPO,
} from '@/lib/services/mainboard-landing-service';

// ISR: Revalidate every 5 minutes
export const revalidate = 300;

// SEO Metadata
export const metadata: Metadata = {
  title: 'Mainboard IPOs 2025 - Complete Hub | IPODhan',
  description:
    'Access comprehensive Mainboard IPO information including current, upcoming, and listed IPOs. View performance metrics, reviews, prospectus documents, and IPO calendar.',
  keywords:
    'mainboard ipo, mainboard ipo 2025, nse ipo, bse ipo, ipo performance, ipo reviews, ipo calendar, India',
  openGraph: {
    title: 'Mainboard IPOs 2025 - Complete Hub',
    description: 'Comprehensive Mainboard IPO hub with metrics, reviews, and detailed listings',
    type: 'website',
  },
};

// Define columns for detailed table
const detailedColumns: ColumnDef<IPO>[] = [
  {
    key: 'companyName',
    header: 'Company',
    searchable: true,
    render: (value, row) => (
      <Link href={`/ipos/${row.slug}`} className="text-blue-600 hover:underline font-medium">
        {value}
      </Link>
    ),
  },
  {
    key: 'openDate',
    header: 'Opening Date',
    render: (value) => renderFunctions.date(value),
  },
  {
    key: 'closeDate',
    header: 'Closing Date',
    render: (value) => renderFunctions.date(value),
  },
  {
    key: 'listingDate',
    header: 'Listing Date',
    render: (value) => renderFunctions.date(value) || 'TBD',
  },
  {
    key: 'priceRangeMax',
    header: 'Issue Price',
    align: 'right',
    render: (value) => renderFunctions.currency(value),
  },
  {
    key: 'issueSize',
    header: 'Total Issue Amount',
    align: 'right',
    render: (value) => {
      if (!value) return '-';
      return `${renderFunctions.currency(parseFloat(value))} Cr`;
    },
  },
  {
    key: 'listingExchanges',
    header: 'Listing At',
    align: 'center',
    render: (value: ('NSE' | 'BSE')[] | null) => {
      if (!value || value.length === 0) return '-';
      return value.join(', ');
    },
  },
  {
    key: 'leadManagers',
    header: 'Lead Manager',
    searchable: true,
    render: (value: string[] | null) => {
      if (!value || value.length === 0) return '-';
      return value[0]; // Show first manager
    },
  },
  {
    key: 'id',
    header: 'Compare',
    align: 'center',
    sortable: false,
    searchable: false,
    render: () => <input type="checkbox" className="h-4 w-4" />,
  },
];

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function MainboardIPOsPage({ searchParams }: PageProps) {
  // Parse query params
  const year = parseInt((searchParams?.year as string) || String(new Date().getFullYear()), 10);

  // Fetch all data in parallel
  const [
    metrics,
    currentIPOs,
    upcomingIPOs,
    recentlyListedIPOs,
    reviews,
    performanceHighlights,
    subscriptionStatus,
    { data: detailedList, totalCount },
  ] = await Promise.all([
    getMainboardSummaryMetrics(),
    getMainboardCurrentIPOs(),
    getMainboardUpcomingIPOs(),
    getMainboardRecentlyListedIPOs(),
    getMainboardReviews(),
    getMainboardPerformanceHighlights(),
    getMainboardSubscriptionStatus(),
    getMainboardDetailedList({ year }),
  ]);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Educational Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-3">Mainboard IPOs</h1>
        <p className="text-gray-600 leading-relaxed">
          Mainboard IPOs are public offerings listed on NSE and BSE main boards. These are
          typically large companies with higher minimum investment requirements compared to SME
          IPOs. Access comprehensive information on current, upcoming, and listed Mainboard IPOs
          including performance metrics, expert reviews, prospectus documents, and event calendar.
        </p>
      </div>

      {/* Summary Metrics Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Mainboard IPO Metrics</h2>
        <MainboardSummaryMetricsSection metrics={metrics} />
      </section>

      {/* Content Sections */}
      <section className="mb-12">
        <MainboardContentSections
          currentIPOs={currentIPOs}
          upcomingIPOs={upcomingIPOs}
          recentlyListedIPOs={recentlyListedIPOs}
          reviews={reviews}
          performanceHighlights={performanceHighlights}
          subscriptionStatus={subscriptionStatus}
        />
      </section>

      {/* Navigation Cards */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Explore Mainboard IPO Features</h2>
        <MainboardNavigationCards />
      </section>

      {/* Detailed Table Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Detailed Mainboard IPO Listings</h2>
        <p className="text-gray-600 mb-4">
          Showing {totalCount} records for year {year}
        </p>

        <DataTable
          data={detailedList}
          columns={detailedColumns}
          emptyMessage="No Mainboard IPOs found for this year"
          // Enable features
          enableColumnSearch={true}
          enableYearFilter={true}
          enableMinimizeToggle={true}
          // Year filter configuration
          yearFilterConfig={{
            availableYears: DEFAULT_IPO_YEARS_EXPORT,
            selectedYear: String(year),
            onYearChange: (newYear) => {
              // Note: This won't work in server component
              // Client component wrapper needed for year change
            },
          }}
          // Column search configuration
          columnSearchConfig={{
            currentSearches: {},
          }}
        />
      </section>
    </div>
  );
}
