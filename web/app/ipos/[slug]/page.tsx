/**
 * IPO Detail Page
 *
 * Server-side rendered page displaying comprehensive IPO information
 * Features:
 * - SSR for Tier 1 data (above fold): IPOHeader, KeyMetricsCards, InfoSection
 * - Client-side tabs for Tier 2 data (below fold)
 * - Dynamic SEO metadata with Open Graph and JSON-LD
 * - 404 handling for invalid slugs
 * - Breadcrumbs navigation
 * - Error boundary wrapper
 *
 * @route /ipos/[slug]
 * @example /ipos/swiggy-ipo
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import { IPOHeader } from '@/components/ipo/IPOHeader';
import { KeyMetricsCards } from '@/components/ipo/KeyMetricsCards';
import { InfoSection } from '@/components/ipo/InfoSection';
import { IPODetailTabs } from '@/components/ipo/IPODetailTabs';
import { AllotmentCheckerCard } from '@/components/ipo/AllotmentCheckerCard';
import { LotCalculator } from '@/components/tools/LotCalculator';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { AffiliateSection } from '@/components/affiliate/AffiliateSection';
import { ListingPerformance } from '@/components/ipo/ListingPerformance';
import { getSectorAverage } from '@/lib/utils/sector-averages';
import type { IPODetailResponse } from '@/lib/db/types';
import {
  generateIPODetailMetadata,
  ipoToMetadataParams,
} from '@/lib/seo/metadata';
import {
  generateFinancialProductSchema,
  generateBreadcrumbSchema,
  generateIPODetailBreadcrumbs,
  toJsonLdScript,
} from '@/lib/seo/structured-data';

// ==================== TYPES ====================

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

// ==================== METADATA ====================

/**
 * Generate dynamic metadata for SEO
 * Uses centralized SEO utilities for consistency
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    // Fetch IPO data for metadata
    // Use NEXT_PUBLIC_API_BASE_URL if set, otherwise construct from PORT or default to 3000
    const port = process.env.PORT || '3000';
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${port}/api`;
    const response = await fetch(`${baseUrl}/ipos/${slug}`, {
      next: { revalidate: 900 }, // 15 minutes
    });

    if (!response.ok) {
      return {
        title: 'IPO Not Found | IPODhan',
        description: 'The requested IPO could not be found.',
      };
    }

    const data: IPODetailResponse = await response.json();
    const { ipo } = data;

    // Convert IPO to metadata params and generate metadata
    const metadataParams = ipoToMetadataParams(ipo);
    return generateIPODetailMetadata(metadataParams);
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'IPO Details | IPODhan',
      description: 'View comprehensive IPO information on IPODhan.',
    };
  }
}

// ==================== PAGE COMPONENT ====================

/**
 * IPO Detail Page Component
 * Server-side rendered with progressive loading for tabs
 */
export default async function IPODetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { tab } = await searchParams;

  // Fetch IPO data server-side
  // Use NEXT_PUBLIC_API_BASE_URL if set, otherwise construct from PORT or default to 3000
  const port = process.env.PORT || '3000';
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${port}/api`;

  let data: IPODetailResponse;
  try {
    const response = await fetch(`${baseUrl}/ipos/${slug}`, {
      next: { revalidate: 900 }, // 15 minutes cache
    });

    if (!response.ok) {
      // Invalid slug - show 404
      notFound();
    }

    data = await response.json();
  } catch (error) {
    console.error('Error fetching IPO data:', error);
    notFound();
  }

  const { ipo, gmpRecords, subscriptions, listingPerformance } = data;

  // Calculate metrics for KeyMetricsCards
  const latestSubscription = subscriptions?.[0];
  const latestGMP = gmpRecords?.[0];

  const subscriptionValue = latestSubscription?.totalSubscription ?? null;
  const gmpValue = latestGMP?.gmp ?? null;
  const gmpPercent = latestGMP && ipo.priceRangeMax
    ? (latestGMP.gmp / ipo.priceRangeMax) * 100
    : null;

  // Determine subscription trend (simplified - in real app, compare with previous day)
  const subscriptionTrend: 'up' | 'down' | 'neutral' =
    subscriptionValue !== null && Number(subscriptionValue) > 1 ? 'up' : 'neutral';

  // Fetch sector average for listing performance comparison
  const sectorAverage = ipo.status === 'LISTED' && ipo.listingDate && listingPerformance
    ? await getSectorAverage(ipo.sector)
    : null;

  // Generate structured data using SEO utilities
  const financialProductSchema = generateFinancialProductSchema(ipo);
  const breadcrumbItems = generateIPODetailBreadcrumbs(ipo.companyName, slug);
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);

  return (
    <>
      {/* Structured Data for SEO */}
      <Script
        id="financial-product-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLdScript(financialProductSchema),
        }}
      />
      <Script
        id="breadcrumb-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLdScript(breadcrumbSchema),
        }}
      />

      {/* Page Content */}
      <div className="min-h-screen bg-background">
        {/* Breadcrumbs Navigation */}
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-3">
            <Breadcrumbs
              items={[
                { label: 'Home', href: '/' },
                { label: 'IPOs', href: '/dashboard' },
                { label: ipo.companyName, href: `/ipos/${slug}` },
              ]}
            />
          </div>
        </div>

        {/* Tier 1: Above Fold Content (SSR) */}
        <IPOHeader ipo={ipo} />

        {/* Main Content */}
        <div className="container mx-auto px-4 py-8">
          <div className="space-y-8">
            {/* Key Metrics Cards */}
            <KeyMetricsCards
              issueSize={Number(ipo.issueSize)}
              subscription={subscriptionValue !== null ? Number(subscriptionValue) : null}
              subscriptionTrend={subscriptionTrend}
              gmp={gmpValue}
              gmpPercent={gmpPercent}
            />

            {/* IPO Information Section */}
            <InfoSection ipo={ipo} />

            {/* Apply for IPO Section (Story 5.5) */}
            {(ipo.status === 'OPEN' || ipo.status === 'UPCOMING') && (
              <AffiliateSection
                ipoId={ipo.id}
                companyName={ipo.companyName}
              />
            )}

            {/* Lot Size Calculator (Story 5.1) */}
            {ipo.priceRangeMax && ipo.lotSize && (
              <LotCalculator
                mode="embedded"
                ipoData={{
                  id: ipo.id,
                  companyName: ipo.companyName,
                  slug: ipo.slug,
                  priceRangeMax: ipo.priceRangeMax,
                  lotSize: ipo.lotSize,
                }}
                title="Calculate Your Investment"
                description="Find out how many lots you can buy with your investment amount"
              />
            )}

            {/* Allotment Status Checker (Story 4.6) */}
            {(ipo.status === 'CLOSED' || ipo.status === 'LISTED') && (
              <AllotmentCheckerCard
                status={ipo.status}
                registrar={ipo.registrarRelation?.shortName || ipo.registrar || 'Registrar'}
                registrarUrl={ipo.registrarRelation?.allotmentCheckUrl || null}
                companyName={ipo.companyName}
              />
            )}

            {/* Listing Performance (Story 6.3) */}
            {ipo.status === 'LISTED' && ipo.listingDate && listingPerformance && (
              <ListingPerformance
                data={{
                  issuePrice: listingPerformance.issuePrice,
                  listingPrice: listingPerformance.listingPrice,
                  listingGainPercent: parseFloat(listingPerformance.listingGainPercent),
                  currentPrice: listingPerformance.currentPrice,
                  currentGainPercent: listingPerformance.currentGainPercent
                    ? parseFloat(listingPerformance.currentGainPercent)
                    : null,
                }}
                sector={ipo.sector}
                sectorAverage={sectorAverage}
              />
            )}

            {/* Tier 2: Below Fold Content (Client-Side Tabs) */}
            <IPODetailTabs
              slug={slug}
              ipo={ipo}
              ipoData={data}
              initialTab={tab || 'overview'}
            />
          </div>
        </div>
      </div>
    </>
  );
}
