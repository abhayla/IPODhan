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
import { IssueStructureSection } from '@/components/ipo/IssueStructureSection';
import { IPODetailTabs } from '@/components/ipo/IPODetailTabs';
import { AllotmentCheckerCard } from '@/components/ipo/AllotmentCheckerCard';
import { LotCalculator } from '@/components/tools/LotCalculator';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { AffiliateSection } from '@/components/affiliate/AffiliateSection';
import { ListingPerformance } from '@/components/ipo/ListingPerformance';
import { IPOScoreSection } from '@/components/ipo/IPOScoreSection';
import { PeerComparisonSection } from '@/components/ipo/PeerComparisonSection';
import { SectorAverageComparison } from '@/components/ipo/SectorAverageComparison';
import { PromoterHoldingSection } from '@/components/ipo/PromoterHoldingSection';
import { AnchorInvestorsSection } from '@/components/ipo/AnchorInvestorsSection';
import { KPIHighlightSection } from '@/components/ipo-detail/KPIHighlightSection';
import { EnhancedFinancialMetricsSection } from '@/components/ipo-detail/EnhancedFinancialMetricsSection';
import { IPOObjectivesSection } from '@/components/ipo-detail/IPOObjectivesSection';
import { CompanyContactSection } from '@/components/ipo-detail/CompanyContactSection';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
import { getSectorAverage } from '@/lib/utils/sector-averages';
import { apiClient } from '@/lib/api-client';
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
    // Fetch IPO data for metadata using the API client
    // This ensures dynamic port detection and consistent API calls
    const data = await apiClient.getIPOBySlug(slug) as unknown as IPODetailResponse;
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

  // Fetch IPO data server-side using the API client
  // This ensures dynamic port detection and consistent API calls
  let data: IPODetailResponse;
  try {
    data = await apiClient.getIPOBySlug(slug) as unknown as IPODetailResponse;
  } catch (error) {
    console.error('Error fetching IPO data:', error);
    notFound();
  }

  const { ipo, gmpRecords, subscriptions, listingPerformance, ipoScore, ipoDetails, peerCompanies, financialData, anchorInvestor, reviewSummary } = data;

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

  // Fetch sector average for listed IPOs (Story 6.3)
  const sectorAverageGain =
    ipo.status === 'LISTED' && ipo.sector
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

            {/* Issue Structure Section (Story 4.11) */}
            <IssueStructureSection ipoDetails={ipoDetails || null} />

            {/* IPO Information Section */}
            <InfoSection ipo={ipo} ipoDetails={ipoDetails || null} />

            {/* IPO Score Section (Story 4.7) */}
            <IPOScoreSection score={ipoScore || null} />

            {/* Promoter Holding Section (Story 11.9) */}
            <PromoterHoldingSection
              promoterHoldingPreIssue={financialData?.promoterHoldingPreIssue ? Number(financialData.promoterHoldingPreIssue) : null}
              promoterHoldingPostIssue={financialData?.promoterHoldingPostIssue ? Number(financialData.promoterHoldingPostIssue) : null}
            />

            {/* Anchor Investors Section (Story 11.10) */}
            <AnchorInvestorsSection
              bidDate={anchorInvestor?.bidDate || null}
              totalSharesOffered={anchorInvestor?.totalSharesOffered ? Number(anchorInvestor.totalSharesOffered) : null}
              totalAmountRaised={anchorInvestor?.totalAmountRaised ? Number(anchorInvestor.totalAmountRaised) : null}
              anchorInvestorsCount={anchorInvestor?.anchorInvestorsCount || null}
              lockIn50PercentDate={anchorInvestor?.lockIn50PercentDate || null}
              lockInRemainingDate={anchorInvestor?.lockInRemainingDate || null}
              investorList={anchorInvestor?.investorList || null}
            />

            {/* KPI Highlight Section (Story 11.11) */}
            <KPIHighlightSection
              financialData={financialData ? {
                marketCap: financialData.marketCap ? Number(financialData.marketCap) : null,
                preIpoEps: financialData.preIpoEps ? Number(financialData.preIpoEps) : null,
                postIpoEps: financialData.postIpoEps ? Number(financialData.postIpoEps) : null,
                ronw: financialData.ronw ? Number(financialData.ronw) : null,
                roe: financialData.roe ? Number(financialData.roe) : null,
                netWorth: financialData.netWorth ? Number(financialData.netWorth) : null,
              } : null}
              ipoData={{
                priceRangeMax: ipo.priceRangeMax,
                issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
              }}
            />

            {/* Enhanced Financial Metrics Section (Story 11.12) */}
            <EnhancedFinancialMetricsSection
              financialData={financialData ? {
                revenueFy2022: financialData.revenueFy2022 ? Number(financialData.revenueFy2022) : null,
                revenueFy2023: financialData.revenueFy2023 ? Number(financialData.revenueFy2023) : null,
                revenueFy2024: financialData.revenueFy2024 ? Number(financialData.revenueFy2024) : null,
                profitFy2022: financialData.profitFy2022 ? Number(financialData.profitFy2022) : null,
                profitFy2023: financialData.profitFy2023 ? Number(financialData.profitFy2023) : null,
                profitFy2024: financialData.profitFy2024 ? Number(financialData.profitFy2024) : null,
                ebitdaFy2022: financialData.ebitdaFy2022 ? Number(financialData.ebitdaFy2022) : null,
                ebitdaFy2023: financialData.ebitdaFy2023 ? Number(financialData.ebitdaFy2023) : null,
                ebitdaFy2024: financialData.ebitdaFy2024 ? Number(financialData.ebitdaFy2024) : null,
                totalIncomeFy2022: financialData.totalIncomeFy2022 ? Number(financialData.totalIncomeFy2022) : null,
                totalIncomeFy2023: financialData.totalIncomeFy2023 ? Number(financialData.totalIncomeFy2023) : null,
                totalIncomeFy2024: financialData.totalIncomeFy2024 ? Number(financialData.totalIncomeFy2024) : null,
                totalBorrowings: financialData.totalBorrowings ? Number(financialData.totalBorrowings) : null,
                currentRatio: financialData.currentRatio ? Number(financialData.currentRatio) : null,
                quickRatio: financialData.quickRatio ? Number(financialData.quickRatio) : null,
                inventoryTurnover: financialData.inventoryTurnover ? Number(financialData.inventoryTurnover) : null,
              } : null}
            />

            {/* IPO Objectives Section (Story 11.13) */}
            <IPOObjectivesSection objectives={ipo.objectives ?? null} />

            {/* Company Contact Section (Story 11.14) */}
            <CompanyContactSection
              contactData={ipoDetails ? {
                companyAddress: ipoDetails.companyAddress ?? null,
                companyPhone: ipoDetails.companyPhone ?? null,
                companyEmail: ipoDetails.companyEmail ?? null,
                companyCity: ipoDetails.companyCity ?? null,
                companyState: ipoDetails.companyState ?? null,
                companyPincode: ipoDetails.companyPincode ?? null,
                complianceOfficer: ipoDetails.complianceOfficer ?? null,
                complianceOfficerPhone: ipoDetails.complianceOfficerPhone ?? null,
                complianceOfficerEmail: ipoDetails.complianceOfficerEmail ?? null,
              } : null}
            />

            {/* Recommendation Summary Section (Story 11.16) */}
            {reviewSummary && (
              <RecommendationSummarySection
                reviewSummary={reviewSummary}
                ipoSegment={ipo.segment || 'MAINBOARD'}
              />
            )}

            {/* Category Reservation Section (Story 11.15) */}
            <CategoryReservationSection
              reservationData={ipoDetails ? {
                qibSharesOffered: ipoDetails.qibSharesOffered ? Number(ipoDetails.qibSharesOffered) : null,
                niiSharesOffered: ipoDetails.niiSharesOffered ? Number(ipoDetails.niiSharesOffered) : null,
                retailSharesOffered: ipoDetails.retailSharesOffered ? Number(ipoDetails.retailSharesOffered) : null,
                retailMaxAllottees: ipoDetails.retailMaxAllottees ?? null,
                employeeSharesOffered: ipoDetails.employeeSharesOffered ? Number(ipoDetails.employeeSharesOffered) : null,
                anchorSharesOffered: ipoDetails.anchorSharesOffered ? Number(ipoDetails.anchorSharesOffered) : null,
              } : null}
            />

            {/* Peer Comparison Section */}
            {peerCompanies && peerCompanies.length > 0 && (
              <PeerComparisonSection
                peerCompanies={peerCompanies}
                companyName={ipo.companyName}
              />
            )}

            {/* Listing Performance Section (Story 6.3) */}
            {ipo.status === 'LISTED' &&
              ipo.listingDate &&
              listingPerformance &&
              listingPerformance.issuePrice &&
              listingPerformance.listingPrice && (
                <div className="space-y-4">
                  <ListingPerformance
                    issuePrice={listingPerformance.issuePrice}
                    listingOpen={listingPerformance.listingPrice}
                    listingHigh={listingPerformance.listingPrice}
                    listingClose={listingPerformance.listingPrice}
                    listingDate={new Date(ipo.listingDate)}
                    listingGainPercent={Number(listingPerformance.listingGainPercent)}
                  />
                  {sectorAverageGain !== null && ipo.sector && (
                    <SectorAverageComparison
                      listingGainPercent={Number(listingPerformance.listingGainPercent)}
                      sectorAverageGain={sectorAverageGain}
                      sector={ipo.sector}
                    />
                  )}
                </div>
              )}

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
