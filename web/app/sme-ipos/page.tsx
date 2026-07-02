/**
 * SME IPOs Landing Page (spec L1 — status-tabbed single table)
 *
 * Data-first listing index: educational header → KPI ribbon → status tabs
 * (Open · Upcoming · Recently listed · All), each rendering ONE table.
 * Replaces the former card-grid composition. Listing-gain data is REAL
 * (listing_performance); the old Math.random() performance/subscription cards
 * are gone (#98).
 *
 * Server component with ISR (5-minute revalidation).
 */

import type { Metadata } from 'next';
import {
  getSMESummaryMetrics,
  getSMEDetailedList,
} from '@/lib/services/sme-landing-service';
import { getListingGainsByIds } from '@/lib/services/listing-gains-service';
import { getLiveMetricsByIds } from '@/lib/services/live-metrics-service';
import { isLiveIPO } from '@/lib/services/ipo-live-status';
import { ListingIndexClient } from '@/components/listing/ListingIndexClient';

// ===== ISR CONFIGURATION =====
export const revalidate = 300; // 5 minutes — matches backing Redis TTL

// ===== SEO METADATA =====
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

interface PageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SMEIPOsLandingPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const currentYear = parseInt(
    (params?.year as string) || String(new Date().getFullYear()),
    10
  );

  try {
    const [metrics, detailedData] = await Promise.all([
      getSMESummaryMetrics(),
      getSMEDetailedList({ year: currentYear }),
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
              name: 'SME IPOs - Complete Hub',
              description:
                'Comprehensive SME IPO information hub with current, upcoming, and listed IPOs on BSE SME and NSE Emerge',
              url: 'https://ipodhan.com/sme-ipos',
              mainEntity: {
                '@type': 'ItemList',
                numberOfItems: metrics.totalIPOs,
                itemListElement: detailedData.data.slice(0, 10).map((ipo, index) => ({
                  '@type': 'ListItem',
                  position: index + 1,
                  item: {
                    '@type': 'FinancialProduct',
                    name: `${ipo.companyName} IPO`,
                    category: 'SME IPO',
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
                    item: { '@id': 'https://ipodhan.com/sme-ipos', name: 'SME IPOs' },
                  },
                ],
              },
            }),
          }}
        />

        <div className="container mx-auto px-4 py-8">
          <header className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-gray-900">SME IPOs</h1>
            <p className="max-w-3xl text-sm leading-relaxed text-gray-600">
              Initial public offerings of small and medium enterprises on BSE SME and NSE
              Emerge — smaller companies with lower minimum investment than Mainboard IPOs.
              Track open, upcoming, and recently listed SME IPOs with price band, issue
              size, and listing gains.
            </p>
          </header>

          <ListingIndexClient
            segmentLabel="SME"
            data={detailedData.data}
            allTimeTotal={metrics.totalIPOs}
            gainsMap={gainsMap}
            liveMetricsMap={liveMetricsMap}
            initialYear={currentYear}
          />
        </div>
      </>
    );
  } catch (error) {
    console.error('Error loading SME IPOs landing page:', error);
    return (
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="mb-3 text-2xl font-semibold text-gray-900">SME IPOs</h1>
          <p className="leading-relaxed text-gray-600">
            SME IPOs are Initial Public Offerings of Small and Medium Enterprises listed on
            BSE SME and NSE Emerge platforms.
          </p>
        </header>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-800">
            Unable to load SME IPO data at this time. Please try again later.
          </p>
        </div>
      </div>
    );
  }
}
