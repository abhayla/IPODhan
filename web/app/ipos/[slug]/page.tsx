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
import { notFound, permanentRedirect } from 'next/navigation';
import Script from 'next/script';
import { IPOHeader } from '@/components/ipo/IPOHeader';
import { IPOTimelineWidget } from '@/components/ipo/IPOTimelineWidget';
import { CompanyOverview } from '@/components/ipo/CompanyOverview';
import { FactRibbon } from '@/components/ipo-detail/FactRibbon';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { formatIssueSizeCrores } from '@/lib/utils';
import { InfoSection } from '@/components/ipo/InfoSection';
import { IssueStructureSection } from '@/components/ipo/IssueStructureSection';
import { IPOSectionNav } from '@/components/ipo-detail/IPOSectionNav';
import { DocumentList } from '@/components/ipo/DocumentList';
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
  DemandGraph,
  GMPHistoryChart,
} from '@/components/ipo/charts';
import { IPOObjectivesSection } from '@/components/ipo-detail/IPOObjectivesSection';
import { CompanyContactSection } from '@/components/ipo-detail/CompanyContactSection';
import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
import { PendingDataNotice } from '@/components/ipo-detail/PendingDataNotice';
import { LotDetailsSection } from '@/components/ipo-detail/LotDetailsSection';
import { ListingDetailsSection } from '@/components/ipo-detail/ListingDetailsSection';
import { LeadManagerSection } from '@/components/ipo-detail/LeadManagerSection';
import { IPODetailsTable } from '@/components/ipo-detail/IPODetailsTable';
import { getSectorAverage } from '@/lib/utils/sector-averages';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ReviewRepository } from '@/lib/repositories/review-repository';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';
import { IpoValuationRepository } from '@ipodhan/shared/repositories/ipo-valuation-repository';
import { PromotersRepository } from '@ipodhan/shared/repositories/promoters-repository';
import { IpoIntermediariesRepository } from '@ipodhan/shared/repositories/ipo-intermediaries-repository';
import { IpoRiskFactorsRepository } from '@ipodhan/shared/repositories/ipo-risk-factors-repository';
import { FinancialStatementsRepository } from '@ipodhan/shared/repositories/financial-statements-repository';
import { BrlmTrackRecordRepository } from '@ipodhan/shared/repositories/brlm-track-record-repository';
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

// ==================== CONSTANTS ====================

/**
 * T-328: mirrors HIGH_VALUE_FIELDS in
 * scraper/src/services/cross-source-disagreement-monitor.ts and
 * HIGH_VALUE_LIVE_FIELDS in scraper/src/services/data-consolidation-service.ts
 * — the fields whose unresolved dispute renders the "under verification"
 * marker instead of asserting a HELD value as settled fact.
 */
const HIGH_VALUE_DISPUTE_FIELDS = new Set(['priceRangeMin', 'priceRangeMax', 'openDate', 'closeDate']);

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

  // A retired slug (name-pollution cleanup, dedup merge, admin rename) 308s to
  // its IPO's current slug instead of falling through to fuzzy/404 (P3-1, T-278).
  // permanentRedirect() (not redirect()) is required for a real 308 — Next
  // 15.5.4's redirect() throws RedirectStatusCode.TemporaryRedirect (307),
  // which keeps the retired URL indexed and transfers no link equity (T-278F).
  const redirectSlug = await ipoRepository.findRedirectSlug(slug);
  if (redirectSlug && redirectSlug !== slug) {
    permanentRedirect(`/ipos/${redirectSlug}`);
  }

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

  const { ipo, gmpRecords, subscriptions, listingPerformance, ipoScore, ipoDetails, peerCompanies, financialData, anchorInvestor, documents } = data;

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

  // T-328: on a live IPO, an unresolved HIGH_VALUE cross-source disagreement
  // means the currently-published price band/date is HELD, not settled — the
  // UI must say so instead of asserting the number as fact (LIFECYCLE-1, no
  // new tables: reads the existing data_conflicts row the scraper-side HOLD
  // writes). Only fetched for live IPOs — a CLOSED/LISTED IPO's fields are
  // never held (see data-consolidation-service.ts HIGH_VALUE_LIVE_FIELDS).
  const disputedFields: Set<string> =
    ipo.status === 'UPCOMING' || ipo.status === 'OPEN'
      ? new Set(
          (await new DataConflictsRepository(db, redis).findUnresolvedForIPO(ipo.id))
            .filter((c) => HIGH_VALUE_DISPUTE_FIELDS.has(c.fieldName))
            .map((c) => c.fieldName)
        )
      : new Set<string>();

  // ── W-75: extraction-fed tables (filing extractor output). Each load is
  // wrapped so a missing table / empty result never breaks the page; every
  // consumer below is null-safe, so an IPO without these rows renders exactly
  // as it did before.
  const safeLoad = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [
    valuationRows,
    promoterRows,
    acquisitionRangeRows,
    intermediaryRows,
    riskFactorRows,
    financialStatementRows,
    brlmTrackRecordRows,
  ] = await Promise.all([
    safeLoad(() => new IpoValuationRepository(db, redis).listByIpo(ipo.id), []),
    safeLoad(() => new PromotersRepository(db, redis).listPromotersByIpo(ipo.id), []),
    safeLoad(() => new PromotersRepository(db, redis).listAcquisitionRangesByIpo(ipo.id), []),
    safeLoad(() => new IpoIntermediariesRepository(db, redis).listByIpo(ipo.id), []),
    safeLoad(() => new IpoRiskFactorsRepository(db, redis).listByIpo(ipo.id), []),
    safeLoad(() => new FinancialStatementsRepository(db, redis).listByIpo(ipo.id), []),
    safeLoad(() => new BrlmTrackRecordRepository(db, redis).listBySourceIpo(ipo.id), []),
  ]);

  // The prospectus supersedes the price-band ad when both were extracted.
  const valuation =
    valuationRows.find((v) => v.pricingEvent === 'PROSPECTUS') ??
    valuationRows.find((v) => v.pricingEvent === 'PRICE_BAND_AD') ??
    null;

  // Peer-average P/E, for reading the issue's own P/E against its comparables.
  const peerPeValues = (peerCompanies ?? [])
    .map((p) => toNum(p.peRatio as string | number | null))
    .filter((n): n is number => n !== null && n > 0);
  const peerAveragePe =
    peerPeValues.length > 0
      ? peerPeValues.reduce((a, b) => a + b, 0) / peerPeValues.length
      : null;

  // RHP filing date — the date the prospectus was filed, not when we fetched it.
  const rhpFilingDate =
    (documents ?? []).find((d) => d.type === 'RHP' && d.filingDate)?.filingDate ?? null;

  // Concentration KPIs ride on the risk-factor rows that state them.
  const concentrationKpis = riskFactorRows.flatMap((rf) => {
    const raw = rf.kpis;
    if (!Array.isArray(raw)) return [];
    return (raw as Array<Record<string, unknown>>)
      .map((k) => ({
        label: typeof k?.label === 'string' ? k.label : null,
        valuePct: toNum(k?.value_pct as number | string | null),
        fiscalYear: typeof k?.fiscal_year === 'number' ? k.fiscal_year : null,
      }))
      .filter((k): k is { label: string; valuePct: number; fiscalYear: number | null } =>
        Boolean(k.label) && k.valuePct !== null
      );
  });

  const allocationPct = (() => {
    const raw = ipoDetails?.allocationPct as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const entries = Object.entries(raw)
      .map(([k, v]) => [k, toNum(v as number | string | null)] as const)
      .filter((e): e is readonly [string, number] => e[1] !== null);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  })();

  // Empty-prone sections render nothing when their data is absent; one compact
  // PendingDataNotice names what's awaited instead of a stack of dead cards
  // (2026-07-02 UI review). Presence flags are computed server-side, once.
  const hasIssueStructure = Boolean(
    ipoDetails && (ipoDetails.freshIssue || ipoDetails.ofsIssue || ipoDetails.issueType)
  );
  const hasScore = Boolean(ipoScore);
  const hasFinancials = Boolean(financialData);
  const hasGmpHistory = (gmpRecords?.length ?? 0) > 0;
  const hasBrokerReviews = Boolean(reviewSummary && (reviewSummary.totalReviews ?? 0) > 0);
  const hasObjectives = (ipo.objectives?.length ?? 0) > 0;
  const hasPromoterHolding = Boolean(
    financialData?.promoterHoldingPreIssue && financialData?.promoterHoldingPostIssue
  );
  const hasAnchor = Boolean(anchorInvestor);
  const hasKpis = Boolean(financialData);
  const hasPeers = (peerCompanies?.length ?? 0) > 0;

  const hasCompanyOverview = Boolean(ipo.companyDescription);
  const hasDocuments = (documents?.length ?? 0) > 0;

  const hasSubscriptions = (subscriptions?.length ?? 0) > 0;

  const pendingSections = [
    !hasIssueStructure && 'Issue structure',
    !hasScore && 'IPODhan score',
    !hasFinancials && 'Financials & KPIs',
    !hasSubscriptions && 'Subscription',
    !hasGmpHistory && 'GMP trend',
    !hasBrokerReviews && 'Broker reviews',
    !hasPromoterHolding && 'Promoter holding',
    !hasAnchor && 'Anchor investors',
    !hasPeers && 'Peer comparison',
    !hasDocuments && 'Documents',
  ].filter((s): s is string => Boolean(s));

  // Fact ribbon cells (spec D2 order); GMP is the only colored cell
  const fmtShortDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
      : 'TBA';
  const minInvestment =
    ipo.lotSize && ipo.priceRangeMax ? ipo.lotSize * Number(ipo.priceRangeMax) : null;
  const priceBandDisputed = disputedFields.has('priceRangeMin') || disputedFields.has('priceRangeMax');
  const openCloseDisputed = disputedFields.has('openDate') || disputedFields.has('closeDate');
  const ribbonCells = [
    {
      label: 'Price Band',
      value:
        ipo.priceRangeMin || ipo.priceRangeMax
          ? formatPriceBand(ipo.priceRangeMin, ipo.priceRangeMax)
          : 'TBA',
      disputed: priceBandDisputed,
    },
    { label: 'Lot Size', value: ipo.lotSize ? `${ipo.lotSize}` : 'TBA' },
    {
      label: 'Min. Investment',
      value: minInvestment ? `₹${minInvestment.toLocaleString('en-IN')}` : 'TBA',
    },
    {
      label: 'Issue Size',
      value: formatIssueSizeCrores(ipo.issueSize).replace(' Crores', ' Cr'),
      mobileHidden: true,
    },
    ...(gmpValue !== null
      ? [
          {
            label: 'GMP',
            value: `₹${gmpValue}${gmpPercent !== null ? ` (${gmpPercent >= 0 ? '+' : ''}${gmpPercent.toFixed(1)}%)` : ''}`,
            tone: (gmpValue >= 0 ? 'gain' : 'loss') as 'gain' | 'loss',
          },
        ]
      : []),
    ...(subscriptionValue !== null
      ? [{ label: 'Subscription', value: `${Number(subscriptionValue).toFixed(2)}x` }]
      : []),
    {
      label: 'Open–Close',
      value: `${fmtShortDate(ipo.openDate)} – ${fmtShortDate(ipo.closeDate)}`,
      mobileHidden: true,
      disputed: openCloseDisputed,
    },
    { label: 'Listing', value: fmtShortDate(ipo.listingDate) },
  ];

  // Sticky anchor nav (Screener pattern) — only sections that actually render
  const sectionNavItems = [
    { id: 'details', label: 'Details' },
    hasCompanyOverview && { id: 'overview', label: 'Overview' },
    { id: 'subscription', label: 'Subscription' },
    hasGmpHistory && { id: 'gmp', label: 'GMP' },
    hasFinancials && { id: 'financials', label: 'Financials' },
    hasPeers && { id: 'peers', label: 'Peers' },
    { id: 'allotment', label: 'Allotment' },
    hasDocuments && { id: 'documents', label: 'Documents' },
  ].filter((i): i is { id: string; label: string } => Boolean(i));

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
          <div className="space-y-5">
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
              anchorBidDate={anchorInvestor?.bidDate ?? null}
              rhpFilingDate={rhpFilingDate}
              upiCutoffTime={ipoDetails?.upiCutoffTime ?? null}
            />

            {/* Sticky section navigation — Screener puts it right under the
                header, before any section content (reference review round 7:
                'buried mid-page after ~5 sections'). */}
            <IPOSectionNav items={sectionNavItems} />

            {/* 2. Fact ribbon (spec D2/G4) — replaces the three stat cards */}
            <FactRibbon cells={ribbonCells} />

            {/* 2a. IPO Details Table */}
            <section id="details" className="scroll-mt-28">
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
            </section>

            {/* Apply CTA surfaced next to the key facts — was buried below every
                section at the page bottom (2026-07-02 UI review) */}
            {(ipo.status === 'OPEN' || ipo.status === 'UPCOMING') && (
              <AffiliateSection ipoId={ipo.id} companyName={ipo.companyName} />
            )}

            {/* 3. Issue Structure Section */}
            {(hasIssueStructure || valuation) && (
              <IssueStructureSection
                ipoDetails={ipoDetails || null}
                valuation={valuation}
                faceValue={ipo.faceValue ?? null}
                peerAveragePe={peerAveragePe}
                lotSize={ipo.lotSize}
                priceRangeMax={ipo.priceRangeMax}
              />
            )}

            {/* 3a. Lot Details Section */}
            <LotDetailsSection
              lotSize={ipo.lotSize}
              priceRangeMin={ipo.priceRangeMin}
              priceRangeMax={ipo.priceRangeMax}
              faceValue={ipo.faceValue}
              minBidQuantity={null}
            />

            {/* 4. Company Overview (was inside the removed tabs) */}
            {hasCompanyOverview && (
              <section id="overview" className="scroll-mt-28">
                <CompanyOverview
                  companyDescription={ipo.companyDescription || ''}
                  riskFactors={[]}
                  riskFactorItems={riskFactorRows.map((r) => ({
                    seq: r.seq,
                    heading: r.heading,
                    body: r.body,
                  }))}
                />
              </section>
            )}

            {/* 5. Allotment & Listing details */}
            <section id="allotment" className="scroll-mt-28">
              <InfoSection ipo={ipo} ipoDetails={ipoDetails || null} />
            </section>

            {/* 6. IPO Score Section */}
            {hasScore && <IPOScoreSection score={ipoScore || null} />}

            {/* 7. GMP History Chart */}
            {hasGmpHistory && (
              <section id="gmp" className="scroll-mt-28">
                <GMPHistoryChart
                  gmpRecords={gmpRecords || []}
                  companyName={ipo.companyName}
                  priceRangeMax={ipo.priceRangeMax}
                  defaultExpanded
                />
              </section>
            )}

            {/* 9. Financial Performance Charts */}
            {(hasFinancials || financialStatementRows.length > 0) && (
            <section id="financials" className="scroll-mt-28">
            <FinancialPerformanceCharts
              financialData={financialData}
              companyName={ipo.companyName}
              status={ipo.status}
              statements={financialStatementRows}
            />
            </section>
            )}

            {/* 10. Subscription Dashboard */}
            <section id="subscription" className="scroll-mt-28">
            <SubscriptionDashboard
              subscriptions={subscriptions || []}
              latestSubscription={latestSubscription ?? null}
              companyName={ipo.companyName}
              closeDate={ipo.closeDate ? new Date(ipo.closeDate) : null}
              status={ipo.status}
            />
            </section>

            {/* 11. Broker Recommendations */}
            {hasBrokerReviews && (
              <RecommendationSummarySection
                reviewSummary={reviewSummary}
                ipoSegment={ipo.segment as 'MAINBOARD' | 'SME'}
              />
            )}

            {/* 12. IPO Objectives Section */}
            {hasObjectives && (
              <IPOObjectivesSection
                objectives={ipo.objectives}
                totalIssueSize={ipo.issueSize ? Number(ipo.issueSize) : undefined}
              />
            )}

            {/* 13. Promoter Holding Section */}
            {(hasPromoterHolding || promoterRows.length > 0 || acquisitionRangeRows.length > 0) && (
              <PromoterHoldingSection
                promoterHoldingPreIssue={financialData?.promoterHoldingPreIssue ? Number(financialData.promoterHoldingPreIssue) : null}
                promoterHoldingPostIssue={financialData?.promoterHoldingPostIssue ? Number(financialData.promoterHoldingPostIssue) : null}
                promoters={promoterRows}
                acquisitionRanges={acquisitionRangeRows}
                preIpoPlacement={ipoDetails?.preIpoPlacement ?? null}
              />
            )}

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
                allocationPct={allocationPct}
                designatedExchange={ipoDetails.designatedExchange ?? null}
              />
            )}

            {/* 14. Anchor Investors Section */}
            {hasAnchor && (
            <AnchorInvestorsSection
              bidDate={anchorInvestor?.bidDate || null}
              totalSharesOffered={anchorInvestor?.totalSharesOffered ? Number(anchorInvestor.totalSharesOffered) : null}
              totalAmountRaised={anchorInvestor?.totalAmountRaised ? Number(anchorInvestor.totalAmountRaised) : null}
              anchorInvestorsCount={anchorInvestor?.anchorInvestorsCount || null}
              lockIn50PercentDate={anchorInvestor?.lockIn50PercentDate || null}
              lockInRemainingDate={anchorInvestor?.lockInRemainingDate || null}
              investorList={anchorInvestor?.investorList || null}
            />
            )}

            {/* 15. KPI Highlight Section */}
            {(hasKpis || financialStatementRows.length > 0 || concentrationKpis.length > 0) && (
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
              statements={financialStatementRows}
              concentrationKpis={concentrationKpis}
            />
            )}

            {/* 16. Peer Comparison */}
            {hasPeers && (
              <section id="peers" className="scroll-mt-28">
                <PeerComparisonSection
                  peerCompanies={peerCompanies}
                  companyName={ipo.companyName}
                />
              </section>
            )}

            {/* 16b. Documents (was inside the removed tabs) */}
            {hasDocuments && (
              <section id="documents" className="scroll-mt-28">
                <div className="rounded-lg border bg-card p-6">
                  <h3 className="mb-4 text-lg font-semibold">Documents</h3>
                  <DocumentList documents={documents} />
                </div>
              </section>
            )}

            {/* One compact notice replaces the removed empty-state cards */}
            <PendingDataNotice pendingSections={pendingSections} status={ipo.status} />

            {/* Post-Listing Performance - Conditional for LISTED IPOs */}
            {ipo.status === 'LISTED' &&
             listingPerformance &&
             listingPerformance.issuePrice !== null &&
             listingPerformance.listingPrice !== null &&
             listingPerformance.listingGainPercent !== null && (
              /* 16a. Listing Details Section */
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
            )}

            {/* Apply CTA lives above the fold now (after IPODetailsTable) */}

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

            {/* 18b. Lead Managers & other intermediaries (W-86) — moved to the
                bottom of the page, immediately above the company contact block:
                the appointed intermediaries are reference detail, not something
                an investor reads before the offer's own numbers. */}
            {(ipoDetails?.leadManagers || intermediaryRows.length > 0) && (
              <LeadManagerSection
                leadManagers={ipoDetails?.leadManagers ?? null}
                intermediaries={intermediaryRows}
                brlmTrackRecords={brlmTrackRecordRows}
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
                cin: ipo.cin ?? null,
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
