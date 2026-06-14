/**
 * SME IPOs Landing Page
 *
 * Comprehensive central hub for all SME IPO information:
 * - Summary metrics dashboard (6 cards)
 * - Content sections (6 card grids: current, upcoming, recently listed, reviews, performance, subscription)
 * - Navigation cards (4 links to dedicated pages)
 * - Detailed IPO table with sorting, column search, year filter, and minimize toggle
 *
 * Server component with ISR (5-minute revalidation)
 *
 * Story 9.16: SME IPOs Landing Page
 * AC#1, #3, #4, #5, #6, #7-17, #18-23
 */

import type { Metadata } from 'next';
import { SMESummaryMetrics } from '@/components/sme/SMESummaryMetrics';
import { SMEContentSections } from '@/components/sme/SMEContentSections';
import { SMENavigationCards } from '@/components/sme/SMENavigationCards';
import { SMEDetailedTableClient } from './SMEDetailedTableClient';
import {
  getSMESummaryMetrics,
  getSMECurrentIPOs,
  getSMEUpcomingIPOs,
  getSMERecentlyListedIPOs,
  getSMEReviews,
  getSMEPerformanceHighlights,
  getSMESubscriptionStatus,
  getSMEDetailedList,
} from '@/lib/services/sme-landing-service';

// ===== ISR CONFIGURATION =====
// AC#19: Page uses ISR with 5-minute revalidation
export const revalidate = 300; // 5 minutes in seconds

// ===== SEO METADATA =====
// AC#22: SEO metadata configured
export const metadata: Metadata = {
  title: `SME IPOs ${new Date().getFullYear()} - Complete Hub | IPODhan`,
  description:
    'Access comprehensive SME IPO information including current, upcoming, and listed IPOs on BSE SME and NSE Emerge platforms. View performance metrics, reviews, prospectus documents, and IPO calendar.',
  keywords:
    'sme ipo, sme ipo 2025, bse sme, nse emerge, sme platform, ipo performance, ipo reviews, ipo calendar, India',
  openGraph: {
    title: `SME IPOs ${new Date().getFullYear()} - Complete Hub | IPODhan`,
    description:
      'Comprehensive SME IPO hub with metrics, reviews, and detailed listings on BSE SME and NSE Emerge',
    type: 'website',
    url: 'https://ipodhan.com/sme-ipos',
  },
};

// ===== PAGE COMPONENT =====

interface PageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SMEIPOsLandingPage({ searchParams }: PageProps) {
  // Await searchParams (Next.js 15 requirement)
  const params = searchParams ? await searchParams : {};

  // Parse query parameters
  const currentYear = parseInt(
    (params?.year as string) || String(new Date().getFullYear()),
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
      getSMESummaryMetrics(),
      getSMECurrentIPOs(),
      getSMEUpcomingIPOs(),
      getSMERecentlyListedIPOs(),
      getSMEReviews(),
      getSMEPerformanceHighlights(),
      getSMESubscriptionStatus(),
      getSMEDetailedList({ year: currentYear }),
    ]);

    return (
      <>
        {/* AC#22: Structured Data (JSON-LD) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: 'SME IPOs 2025 - Complete Hub',
              description:
                'Comprehensive SME IPO information hub with current, upcoming, and listed IPOs on BSE SME and NSE Emerge',
              url: 'https://ipodhan.com/sme-ipos',
              mainEntity: {
                '@type': 'ItemList',
                numberOfItems: metrics.totalIPOs,
                itemListElement: currentIPOs.slice(0, 10).map((ipo, index) => ({
                  '@type': 'ListItem',
                  position: index + 1,
                  item: {
                    '@type': 'FinancialProduct',
                    name: `${ipo.companyName} IPO`,
                    category: 'SME IPO',
                    description: ipo.companyDescription || `SME IPO for ${ipo.companyName}`,
                  },
                })),
              },
              breadcrumb: {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  {
                    '@type': 'ListItem',
                    position: 1,
                    item: {
                      '@id': 'https://ipodhan.com',
                      name: 'Home',
                    },
                  },
                  {
                    '@type': 'ListItem',
                    position: 2,
                    item: {
                      '@id': 'https://ipodhan.com/sme-ipos',
                      name: 'SME IPOs',
                    },
                  },
                ],
              },
            }),
          }}
        />

        <div className="container mx-auto px-4 py-8">
          {/* AC#18: Educational Header */}
          <header className="mb-8">
            <h1 className="text-3xl font-bold mb-3 text-gray-900">SME IPOs</h1>
            <p className="text-gray-600 leading-relaxed">
              SME IPOs are Initial Public Offerings of Small and Medium Enterprises listed on BSE SME and NSE Emerge platforms.
              These are smaller companies with lower minimum investment requirements compared to Mainboard IPOs.
              The SME platforms provide growth capital for emerging businesses while offering investors early-stage investment opportunities.
              Access comprehensive information on current, upcoming, and listed SME IPOs including performance metrics, expert reviews,
              prospectus documents, and event calendar.
            </p>
          </header>

        {/* AC#3: Summary Metrics Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">SME IPO Metrics</h2>
          <SMESummaryMetrics metrics={metrics} />
        </section>

        {/* AC#4, AC#5: Content Sections (6 card grids) */}
        <section className="mb-12">
          <SMEContentSections
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
            Explore SME IPO Features
          </h2>
          <SMENavigationCards />
        </section>

        {/* AC#7-17: Detailed Table */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">
            Detailed SME IPO Listings
          </h2>
          <SMEDetailedTableClient
            data={detailedData.data}
            totalCount={detailedData.totalCount}
            initialYear={currentYear}
          />
        </section>
        </div>
      </>
    );
  } catch (error) {
    console.error('Error loading SME IPOs landing page:', error);

    // Graceful degradation on error
    return (
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-3 text-gray-900">SME IPOs</h1>
          <p className="text-gray-600 leading-relaxed">
            SME IPOs are Initial Public Offerings of Small and Medium Enterprises listed on BSE SME and NSE Emerge platforms.
          </p>
        </header>

        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-800 font-medium">
            Unable to load SME IPO data at this time. Please try again later.
          </p>
        </div>
      </div>
    );
  }
}
