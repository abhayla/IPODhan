/**
 * Mainboard IPOs Landing Page (spec L1 — status-tabbed single table)
 *
 * Data-first listing index: educational header → KPI ribbon → status tabs
 * (Open · Upcoming · Recently listed · All), each rendering ONE table.
 * Replaces the former card-grid composition (summary cards + 6 content grids +
 * nav cards + separate detailed table). Listing-gain data is REAL
 * (listing_performance); the old Math.random() performance/subscription cards
 * are gone (#98).
 *
 * Server component with ISR (5-minute revalidation).
 */

import type { Metadata } from 'next';
import {
  getMainboardSummaryMetrics,
  getMainboardDetailedList,
} from '@/lib/services/mainboard-landing-service';
import { getListingGainsByIds } from '@/lib/services/listing-gains-service';
import { getLiveMetricsByIds } from '@/lib/services/live-metrics-service';
import { isLiveIPO } from '@/lib/services/ipo-live-status';
import { ListingIndexClient } from '@/components/listing/ListingIndexClient';

// ===== ISR CONFIGURATION =====
export const revalidate = 300; // 5 minutes — matches backing Redis TTL

// ===== SEO METADATA =====
export const metadata: Metadata = {
  title: `Mainboard IPOs ${new Date().getFullYear()} - Complete Hub | IPODhan`,
  description:
    'Access comprehensive Mainboard IPO information including current, upcoming, and listed IPOs. View performance metrics, reviews, prospectus documents, and IPO calendar.',
  keywords:
    'mainboard ipo, mainboard ipo 2025, nse ipo, bse ipo, ipo performance, ipo reviews, ipo calendar, India',
  openGraph: {
    title: `Mainboard IPOs ${new Date().getFullYear()} - Complete Hub | IPODhan`,
    description:
      'Comprehensive Mainboard IPO hub with metrics, reviews, and detailed listings',
    type: 'website',
    url: 'https://ipodhan.com/mainboard-ipos',
  },
};

interface PageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MainboardIPOsLandingPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const currentYear = parseInt(
    (params?.year as string) || String(new Date().getFullYear()),
    10
  );

  try {
    const [metrics, detailedData] = await Promise.all([
      getMainboardSummaryMetrics(),
      getMainboardDetailedList({ year: currentYear }),
    ]);

    const gainsMap = await getListingGainsByIds(detailedData.data.map((ipo) => ipo.id));
    const liveMetricsMap = await getLiveMetricsByIds(
      detailedData.data.filter(isLiveIPO).map((ipo) => ipo.id)
    );

    return (
      <>
        {/* Structured Data (JSON-LD) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: 'Mainboard IPOs - Complete Hub',
              description:
                'Comprehensive Mainboard IPO information hub with current, upcoming, and listed IPOs',
              url: 'https://ipodhan.com/mainboard-ipos',
              mainEntity: {
                '@type': 'ItemList',
                numberOfItems: metrics.totalIPOs,
                itemListElement: detailedData.data.slice(0, 10).map((ipo, index) => ({
                  '@type': 'ListItem',
                  position: index + 1,
                  item: {
                    '@type': 'FinancialProduct',
                    name: `${ipo.companyName} IPO`,
                    category: 'Mainboard IPO',
                  },
                })),
              },
              breadcrumb: {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  {
                    '@type': 'ListItem',
                    position: 1,
                    item: { '@id': 'https://ipodhan.com', name: 'Home' },
                  },
                  {
                    '@type': 'ListItem',
                    position: 2,
                    item: {
                      '@id': 'https://ipodhan.com/mainboard-ipos',
                      name: 'Mainboard IPOs',
                    },
                  },
                ],
              },
            }),
          }}
        />

        <div className="container mx-auto px-4 py-8">
          <header className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-gray-900">Mainboard IPOs</h1>
            <p className="max-w-3xl text-sm leading-relaxed text-gray-600">
              Public offerings on the NSE and BSE main boards — larger companies with
              higher minimum investment than SME IPOs. Track open, upcoming, and recently
              listed Mainboard IPOs with price band, issue size, and listing gains.
            </p>
          </header>

          <ListingIndexClient
            segmentLabel="Mainboard"
            data={detailedData.data}
            allTimeTotal={metrics.totalIPOs}
            gainsMap={gainsMap}
            liveMetricsMap={liveMetricsMap}
            initialYear={currentYear}

            asOf={new Date().toISOString()}
          />
        </div>
      </>
    );
  } catch (error) {
    console.error('Error loading Mainboard IPOs landing page:', error);
    return (
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="mb-3 text-2xl font-semibold text-gray-900">Mainboard IPOs</h1>
          <p className="leading-relaxed text-gray-600">
            Mainboard IPOs are public offerings listed on NSE and BSE main boards.
          </p>
        </header>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-800">
            Unable to load Mainboard IPO data at this time. Please try again later.
          </p>
        </div>
      </div>
    );
  }
}
