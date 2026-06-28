/**
 * IPO Detail Page
 *
 * Server-side rendered page displaying comprehensive IPO information
 * Features:
 * - SSR for Tier 1 data (above fold): IPOHeader, Timeline, Metrics, InfoSection
 * - Phase 2: Timeline widget and enhanced metrics cards
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
import { IPOTimelineWidget } from '@/components/ipo/IPOTimelineWidget';
import { CompanyOverview } from '@/components/ipo/CompanyOverview';
import { KeyMetricsCardsEnhanced } from '@/components/ipo/KeyMetricsCardsEnhanced';
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
import { IPOViewTracker } from '@/components/ipo/IPOViewTracker';
import {
  FinancialPerformanceCharts,
  SubscriptionDashboard,
  ListingPerformanceCharts,
  DemandGraph,
  GMPHistoryChart,
} from '@/components/ipo/charts';
import { IPOObjectivesSection } from '@/components/ipo-detail/IPOObjectivesSection';
import { CompanyContactSection } from '@/components/ipo-detail/CompanyContactSection';
import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
import { LotDetailsSection } from '@/components/ipo-detail/LotDetailsSection';
import { ListingDetailsSection } from '@/components/ipo-detail/ListingDetailsSection';
import { LeadManagerSection } from '@/components/ipo-detail/LeadManagerSection';
import { IPODetailsTable } from '@/components/ipo-detail/IPODetailsTable';
import { getSectorAverage } from '@/lib/utils/sector-averages';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ReviewRepository } from '@/lib/repositories/review-repository';
import { SEARCH_CONFIG } from '@/lib/config/search';
import { isRealIPO } from '@ipodhan/shared/utils/offering-type';
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
 *
 * ⚠️ ARCHITECTURAL NOTE: Server Components should use repositories directly,
 * not HTTP API calls. This follows the 3-layer architecture:
 * Server Component → Repository (not Server Component → HTTP → API → Repository)
 */
/** Coerce a numeric DB column (string | number | null) to a number, or null. */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    // Initialize repository (Server Components use repositories directly)
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch IPO data using repository pattern (with fuzzy fallback)
    const ipoWithRelations = await ipoRepository.findBySlugWithFallback(slug, {
      enableFuzzy: SEARCH_CONFIG.fallback.enabled,
      similarityThreshold: SEARCH_CONFIG.fuzzyMatch.similarityThreshold,
    });

    if (!ipoWithRelations) {
      return {
        title: 'IPO Not Found | IPODhan',
        description: 'The requested IPO could not be found.',
      };
    }

    // Parity with the page's 404: a non-IPO offering must not emit IPO metadata.
    if (!isRealIPO(ipoWithRelations.offeringType)) {
      return {
        title: 'IPO Not Found | IPODhan',
        description: 'The requested IPO could not be found.',
      };
    }

    // Extract IPO data without relations for metadata
    const { financialData: _, ipoFinancials: __, ipoDetails: ___, documents: ____, subscriptions: _____, gmpRecords: ______, listingPerformance: _______, peerCompanies: ________, registrarRelation, ipoScore: _________, anchorInvestor: __________, ...ipoData } = ipoWithRelations;

    const ipo = {
      ...ipoData,
      registrarRelation,
    };

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
 *
 * ⚠️ ARCHITECTURAL NOTE: Server Components should use repositories directly,
 * not HTTP API calls. This follows the 3-layer architecture:
 * Server Component → Repository (not Server Component → HTTP → API → Repository)
 */
export default async function IPODetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { tab } = await searchParams;

  // Initialize repositories (Server Components use repositories directly)
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);
  const reviewRepository = new ReviewRepository(db, redis);

  // Fetch IPO data using repository pattern (with fuzzy fallback)
  const ipoWithRelations = await ipoRepository.findBySlugWithFallback(slug, {
    enableFuzzy: SEARCH_CONFIG.fallback.enabled,
    similarityThreshold: SEARCH_CONFIG.fuzzyMatch.similarityThreshold,
  });

  if (!ipoWithRelations) {
    notFound();
  }

  // Non-IPO offerings (corporate actions like TENDER/BUYBACK/DELISTING AND other
  // offering types like OFS/FPO/RIGHTS/NCD/INVITS) are NOT IPOs. They have their own
  // listing surfaces; 404 the IPO detail URL so a non-IPO never renders as an IPO with
  // empty fields. Uses the shared isRealIPO() predicate for list↔detail parity (#6/#8).
  if (!isRealIPO(ipoWithRelations.offeringType)) {
    notFound();
  }

  // Fetch review summary (Story 11.16)
  const reviewSummary = await reviewRepository.getReviewSummary(ipoWithRelations.id);

  // Transform to API response format (same as API route)
  // Extract IPO data without relations for the ipo field
  const { financialData: _, ipoFinancials: __, ipoDetails: ___, documents: ____, subscriptions: _____, gmpRecords: ______, listingPerformance: _______, peerCompanies: ________, registrarRelation, ipoScore: _________, anchorInvestor: __________, ...ipoData } = ipoWithRelations;

  const data: IPODetailResponse = {
    ipo: {
      ...ipoData,
      registrarRelation,
    },
    financialData: ipoWithRelations.financialData ?? null,
    ipoFinancials: ipoWithRelations.ipoFinancials ?? null,
    ipoDetails: ipoWithRelations.ipoDetails ?? null,
    documents: ipoWithRelations.documents || [],
    subscriptions: ipoWithRelations.subscriptions || [],
    gmpRecords: ipoWithRelations.gmpRecords || [],
    listingPerformance: ipoWithRelations.listingPerformance ?? null,
    peerCompanies: ipoWithRelations.peerCompanies || [],
    peers: [],
    ipoScore: ipoWithRelations.ipoScore ?? null,
    anchorInvestor: ipoWithRelations.anchorInvestor ?? null,
    reviewSummary: reviewSummary ?? null,
    metadata: {
      lastUpdated: new Date().toISOString(),
    },
  };

  const { ipo, gmpRecords, subscriptions, listingPerformance, ipoScore, ipoDetails, peerCompanies, financialData, anchorInvestor } = data;

  // Calculate metrics for KeyMetricsCards
  const latestSubscription = subscriptions?.[0];
  const latestGMP = gmpRecords?.[0];

  const subscriptionValue = latestSubscription?.totalSubscription ?? null;
  const gmpValue = latestGMP?.gmp ?? null;
  // Guard against NaN/Infinity from a zero/absent price (C5/G19) — an absurd %
  // must render as "no data", never a garbage number.
  const gmpPercent = (() => {
    if (!latestGMP || !ipo.priceRangeMax) return null;
    const pct = (latestGMP.gmp / Number(ipo.priceRangeMax)) * 100;
    return Number.isFinite(pct) ? pct : null;
  })();

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

      {/* Track IPO view for personalization (Phase 5) */}
      <IPOViewTracker
        ipoId={ipo.id}
        slug={slug}
        companyName={ipo.companyName}
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
            {/* 1. IPO Timeline Widget */}
            <IPOTimelineWidget
              ipo={{
                openDate: ipo.openDate,
                closeDate: ipo.closeDate,
                allotmentDate: ipo.allotmentDate,
                listingDate: ipo.listingDate,
                status: ipo.status,
              }}
              ipoDetails={
                ipoDetails
                  ? {
                      basisOfAllotmentDate: ipoDetails.basisOfAllotmentDate,
                      initiationOfRefundsDate: ipoDetails.initiationOfRefundsDate,
                      creditOfSharesDate: ipoDetails.creditOfSharesDate,
                    }
                  : null
              }
            />

            {/* 2. Key Metrics Cards */}
            <KeyMetricsCardsEnhanced
              issueSize={Number(ipo.issueSize)}
              subscription={subscriptionValue !== null ? Number(subscriptionValue) : null}
              subscriptionTrend={subscriptionTrend}
              gmp={gmpValue}
              gmpPercent={gmpPercent}
              subscriptions={subscriptions}
              gmpRecords={gmpRecords}
            />

            {/* 2a. IPO Details Table */}
            <IPODetailsTable
              issueSize={ipo.issueSize ? Number(ipo.issueSize) : null}
              issueType={ipoDetails?.issueType ?? null}
              openDate={ipo.openDate}
              closeDate={ipo.closeDate}
              allotmentDate={ipo.allotmentDate}
              listingDate={ipo.listingDate}
              priceRangeMin={ipo.priceRangeMin}
              priceRangeMax={ipo.priceRangeMax}
              lotSize={ipo.lotSize}
              minBidQuantity={null}
              faceValue={ipo.faceValue}
              freshIssueSize={ipoDetails?.freshIssue ? Number(ipoDetails.freshIssue) : null}
              offerForSaleSize={ipoDetails?.ofsIssue ? Number(ipoDetails.ofsIssue) : null}
            />

            {/* 3. Issue Structure Section */}
            <IssueStructureSection ipoDetails={ipoDetails || null} />

            {/* 3a. Lot Details Section */}
            <LotDetailsSection
              lotSize={ipo.lotSize}
              priceRangeMin={ipo.priceRangeMin}
              priceRangeMax={ipo.priceRangeMax}
              faceValue={ipo.faceValue}
              minBidQuantity={null}
            />

            {/* 4. IPO Detail Tabs */}
            <IPODetailTabs
              slug={slug}
              ipo={ipo}
              ipoData={data}
              initialTab={tab || 'overview'}
            />

            {/* 5. IPO Information Section */}
            <InfoSection ipo={ipo} ipoDetails={ipoDetails || null} />

            {/* 6. IPO Score Section */}
            <IPOScoreSection score={ipoScore || null} />

            {/* 7. GMP History Chart */}
            <GMPHistoryChart
              gmpRecords={gmpRecords || []}
              companyName={ipo.companyName}
              priceRangeMax={ipo.priceRangeMax}
            />

            {/* 9. Financial Performance Charts */}
            <FinancialPerformanceCharts
              financialData={financialData}
              companyName={ipo.companyName}
              status={ipo.status}
            />

            {/* 10. Subscription Dashboard */}
            <SubscriptionDashboard
              subscriptions={subscriptions || []}
              latestSubscription={latestSubscription ?? null}
              companyName={ipo.companyName}
              closeDate={ipo.closeDate ? new Date(ipo.closeDate) : null}
              status={ipo.status}
            />

            {/* 11. Broker Recommendations */}
            <RecommendationSummarySection
              reviewSummary={reviewSummary}
              ipoSegment={ipo.segment as 'MAINBOARD' | 'SME'}
            />

            {/* 12. IPO Objectives Section */}
            <IPOObjectivesSection
              objectives={ipo.objectives}
              totalIssueSize={ipo.issueSize ? Number(ipo.issueSize) : undefined}
            />

            {/* 12a. Lead Managers Section */}
            {ipoDetails?.leadManagers && (
              <LeadManagerSection leadManagers={ipoDetails.leadManagers} />
            )}

            {/* 13. Promoter Holding Section */}
            <PromoterHoldingSection
              promoterHoldingPreIssue={financialData?.promoterHoldingPreIssue ? Number(financialData.promoterHoldingPreIssue) : null}
              promoterHoldingPostIssue={financialData?.promoterHoldingPostIssue ? Number(financialData.promoterHoldingPostIssue) : null}
            />

            {/* 13a. Category Reservation Section */}
            {ipoDetails && (
              <CategoryReservationSection
                reservationData={{
                  qibSharesOffered: ipoDetails.qibSharesOffered,
                  niiSharesOffered: ipoDetails.niiSharesOffered,
                  retailSharesOffered: ipoDetails.retailSharesOffered,
                  retailMaxAllottees: ipoDetails.retailMaxAllottees,
                  employeeSharesOffered: ipoDetails.employeeSharesOffered,
                  anchorSharesOffered: ipoDetails.anchorSharesOffered,
                }}
              />
            )}

            {/* 14. Anchor Investors Section */}
            <AnchorInvestorsSection
              bidDate={anchorInvestor?.bidDate || null}
              totalSharesOffered={anchorInvestor?.totalSharesOffered ? Number(anchorInvestor.totalSharesOffered) : null}
              totalAmountRaised={anchorInvestor?.totalAmountRaised ? Number(anchorInvestor.totalAmountRaised) : null}
              anchorInvestorsCount={anchorInvestor?.anchorInvestorsCount || null}
              lockIn50PercentDate={anchorInvestor?.lockIn50PercentDate || null}
              lockInRemainingDate={anchorInvestor?.lockInRemainingDate || null}
              investorList={anchorInvestor?.investorList || null}
            />

            {/* 15. KPI Highlight Section */}
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

            {/* 16. Peer Comparison */}
            <PeerComparisonSection
              peerCompanies={peerCompanies}
              companyName={ipo.companyName}
            />

            {/* Post-Listing Performance - Conditional for LISTED IPOs */}
            {ipo.status === 'LISTED' &&
             listingPerformance &&
             listingPerformance.issuePrice !== null &&
             listingPerformance.listingPrice !== null &&
             listingPerformance.listingGainPercent !== null && (
              <>
                <ListingPerformanceCharts
                  listingPerformance={{
                    issuePrice: listingPerformance.issuePrice,
                    listingPrice: listingPerformance.listingPrice,
                    listingGainPercent: typeof listingPerformance.listingGainPercent === 'string'
                      ? parseFloat(listingPerformance.listingGainPercent)
                      : listingPerformance.listingGainPercent,
                    currentPrice: listingPerformance.currentPrice,
                    currentGainPercent: listingPerformance.currentGainPercent
                      ? typeof listingPerformance.currentGainPercent === 'string'
                        ? parseFloat(listingPerformance.currentGainPercent)
                        : listingPerformance.currentGainPercent
                      : null,
                  }}
                  issuePrice={listingPerformance.issuePrice}
                  companyName={ipo.companyName}
                />

                {/* 16a. Listing Details Section */}
                <ListingDetailsSection
                  listingDate={ipo.listingDate}
                  symbol={ipo.symbol}
                  issuePrice={listingPerformance.issuePrice}
                  listingPrice={listingPerformance.listingPrice}
                  listingGainPercent={typeof listingPerformance.listingGainPercent === 'string'
                    ? parseFloat(listingPerformance.listingGainPercent)
                    : listingPerformance.listingGainPercent}
                  listingOpenPrice={toNum(listingPerformance.listingOpenPrice)}
                  listingHighPrice={toNum(listingPerformance.listingHighPrice)}
                  listingLowPrice={toNum(listingPerformance.listingLowPrice)}
                  listingClosePrice={toNum(listingPerformance.listingClosePrice)}
                  lastTradedPrice={toNum(listingPerformance.lastTradedPrice)}
                />
              </>
            )}

            {/* 17. Apply for IPO Section (Affiliate) */}
            {(ipo.status === 'OPEN' || ipo.status === 'UPCOMING') && (
              <AffiliateSection
                ipoId={ipo.id}
                companyName={ipo.companyName}
              />
            )}

            {/* 18. Lot Size Calculator */}
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

            {/* 19. Company Contact Section */}
            <CompanyContactSection
              contactData={{
                companyAddress: ipoDetails?.companyAddress ?? null,
                companyPhone: ipoDetails?.companyPhone ?? null,
                companyEmail: ipoDetails?.companyEmail ?? null,
                companyCity: ipoDetails?.companyCity ?? null,
                companyState: ipoDetails?.companyState ?? null,
                companyPincode: ipoDetails?.companyPincode ?? null,
                complianceOfficer: ipoDetails?.complianceOfficer ?? null,
                complianceOfficerPhone: ipoDetails?.complianceOfficerPhone ?? null,
                complianceOfficerEmail: ipoDetails?.complianceOfficerEmail ?? null,
              }}
            />

            {/* Allotment Status Checker (Story 4.6) */}
            {(ipo.status === 'CLOSED' || ipo.status === 'LISTED') && (
              <AllotmentCheckerCard
                status={ipo.status}
                registrar={ipo.registrarRelation?.shortName || ipo.registrar || 'Registrar'}
                registrarUrl={ipo.registrarRelation?.allotmentCheckUrl || null}
                companyName={ipo.companyName}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
