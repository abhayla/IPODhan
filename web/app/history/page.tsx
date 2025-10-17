/**
 * Historical IPOs Page
 *
 * Displays historical IPO performance with filtering, sorting, and search
 * Route: /history
 * Story: 6.2 - Historical IPOs Page
 */

import React, { Suspense } from 'react';
import { Metadata } from 'next';
import { HistoricalFiltersProvider } from '@/contexts/HistoricalFiltersContext';
import { HistoricalIPOsContent } from './HistoricalIPOsContent';

// SEO Metadata
export const metadata: Metadata = {
  title: 'IPO History - Past IPO Performance | IPODhan',
  description:
    'Research historical IPO performance in India. View listing gains, subscription data, and learn from past IPO trends.',
  keywords: [
    'IPO history',
    'past IPO performance',
    'listing gains',
    'IPO trends',
    'historical IPO data India',
  ],
  openGraph: {
    title: 'IPO History - Past IPO Performance | IPODhan',
    description: 'Research historical IPO performance in India.',
    url: 'https://ipodhan.com/history',
    type: 'website',
    siteName: 'IPODhan',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IPO History - Past IPO Performance | IPODhan',
    description: 'Research historical IPO performance in India.',
  },
};

// ISR with 1-hour revalidation
export const revalidate = 3600;

interface HistoricalIPOsPageProps {
  searchParams: Promise<{
    year?: string;
    sector?: string;
    performance?: string;
    sort?: string;
    sortOrder?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function HistoricalIPOsPage({ searchParams }: HistoricalIPOsPageProps) {
  const params = await searchParams;

  // Structured data (JSON-LD) for SEO
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'IPO History - Past IPO Performance',
    description: 'Research historical IPO performance in India',
    url: 'https://ipodhan.com/history',
    mainEntity: {
      '@type': 'ItemList',
      name: 'Historical IPOs',
      description: 'List of past IPOs with performance data',
    },
  };

  return (
    <>
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <HistoricalFiltersProvider
        initialFilters={{
          year: params.year || 'All',
          sector: params.sector || 'All',
          performance: (params.performance as 'All' | 'Positive' | 'Negative') || 'All',
          sort: (params.sort as 'listing_date' | 'listing_gain' | 'subscription') || 'listing_date',
          sortOrder: (params.sortOrder as 'ASC' | 'DESC') || 'DESC',
          searchQuery: params.search || '',
          search: params.search || '',
          page: params.page ? parseInt(params.page, 10) : 1,
          limit: 20,
        }}
      >
        <Suspense fallback={<div>Loading...</div>}>
          <HistoricalIPOsContent availableSectors={[]} availableYears={[]} />
        </Suspense>
      </HistoricalFiltersProvider>
    </>
  );
}
