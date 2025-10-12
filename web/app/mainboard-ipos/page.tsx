/**
 * Mainboard IPOs Landing Page
 *
 * Comprehensive central hub for all Mainboard IPO information:
 * - Summary metrics dashboard (6 cards)
 * - Content sections (6 card grids: current, upcoming, recently listed, reviews, performance, subscription)
 * - Navigation cards (4 links to dedicated pages)
 * - Detailed IPO table with sorting, column search, year filter, and minimize toggle
 *
 * Server component with ISR (5-minute revalidation)
 *
 * Story 9.15: Mainboard IPOs Landing Page
 * AC#1, #3, #4, #5, #6, #7-17, #18-23
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { MainboardSummaryMetrics } from '@/components/mainboard/MainboardSummaryMetrics';
import { MainboardContentSections } from '@/components/mainboard/MainboardContentSections';
import { MainboardNavigationCards } from '@/components/mainboard/MainboardNavigationCards';
import { MainboardDetailedTableClient } from './MainboardDetailedTableClient';
import {
  getMainboardSummaryMetrics,
  getMainboardCurrentIPOs,
  getMainboardUpcomingIPOs,
  getMainboardRecentlyListedIPOs,
  getMainboardReviews,
  getMainboardPerformanceHighlights,
  getMainboardSubscriptionStatus,
  getMainboardDetailedList,
} from '@/lib/services/mainboard-landing-service';

// ===== ISR CONFIGURATION =====
// AC#19: Page uses ISR with 5-minute revalidation
export const revalidate = 300; // 5 minutes in seconds

// ===== SEO METADATA =====
// AC#22: SEO metadata configured
export const metadata: Metadata = {
  title: 'Mainboard IPOs 2025 - Complete Hub | IPODhan',
  description:
    'Access comprehensive Mainboard IPO information including current, upcoming, and listed IPOs. View performance metrics, reviews, prospectus documents, and IPO calendar.',
  keywords:
    'mainboard ipo, mainboard ipo 2025, nse ipo, bse ipo, ipo performance, ipo reviews, ipo calendar, India',
  openGraph: {
    title: 'Mainboard IPOs 2025 - Complete Hub | IPODhan',
    description:
      'Comprehensive Mainboard IPO hub with metrics, reviews, and detailed listings',
    type: 'website',
    url: 'https://ipodhan.com/mainboard-ipos',
  },
};

// ===== PAGE COMPONENT =====

interface PageProps {
  searchParams?: { [key: string]: string | string[] | undefined };
}

export default async function MainboardIPOsLandingPage({ searchParams }: PageProps) {
  // Parse query parameters
  const currentYear = parseInt(
    (searchParams?.year as string) || String(new Date().getFullYear()),
    10
  );

  try {
    // Fetch all data server-side with Promise.all for optimal performance
    const [
      metrics,
      currentIPOs,
      upcomingIPOs,
      recentlyListedIPOs,
      reviews,
      performanceHighlights,
      subscriptionStatus,
      detailedData,
    ] = await Promise.all([
      getMainboardSummaryMetrics(),
      getMainboardCurrentIPOs(),
      getMainboardUpcomingIPOs(),
      getMainboardRecentlyListedIPOs(),
      getMainboardReviews(),
      getMainboardPerformanceHighlights(),
      getMainboardSubscriptionStatus(),
      getMainboardDetailedList({ year: currentYear }),
    ]);

    return (
      <div className="container mx-auto px-4 py-8">
        {/* AC#18: Educational Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-3 text-gray-900">Mainboard IPOs</h1>
          <p className="text-gray-600 leading-relaxed">
            Mainboard IPOs are public offerings listed on NSE and BSE main boards. These are
            typically large companies with higher minimum investment requirements compared to SME
            IPOs. Access comprehensive information on current, upcoming, and listed Mainboard IPOs
            including performance metrics, expert reviews, prospectus documents, and event calendar.
          </p>
        </header>

        {/* AC#3: Summary Metrics Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">Mainboard IPO Metrics</h2>
          <MainboardSummaryMetrics metrics={metrics} />
        </section>

        {/* AC#4, AC#5: Content Sections (6 card grids) */}
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

        {/* AC#6: Navigation Cards */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">
            Explore Mainboard IPO Features
          </h2>
          <MainboardNavigationCards />
        </section>

        {/* AC#7-17: Detailed Table */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">
            Detailed Mainboard IPO Listings
          </h2>
          <MainboardDetailedTableClient
            data={detailedData.data}
            totalCount={detailedData.totalCount}
            initialYear={currentYear}
          />
        </section>
      </div>
    );
  } catch (error) {
    console.error('Error loading Mainboard IPOs landing page:', error);

    // Graceful degradation on error
    return (
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-3 text-gray-900">Mainboard IPOs</h1>
          <p className="text-gray-600 leading-relaxed">
            Mainboard IPOs are public offerings listed on NSE and BSE main boards.
          </p>
        </header>

        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-800 font-medium">
            Unable to load Mainboard IPO data at this time. Please try again later.
          </p>
        </div>
      </div>
    );
  }
}
