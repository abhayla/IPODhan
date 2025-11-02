/**
 * IPODetailClientSections Component
 *
 * Client component wrapper for collapsible sections on IPO detail page.
 * Manages global expand/collapse state and provides SectionControlBar.
 *
 * This component is separated to keep the main page as a Server Component
 * while still supporting interactive client-side features.
 *
 * @example
 * ```tsx
 * <IPODetailClientSections
 *   financialData={financialData}
 *   subscriptions={subscriptions}
 *   gmpRecords={gmpRecords}
 *   // ... other props
 * />
 * ```
 */

'use client';

import { SectionControlBar, useSectionControl } from '@/components/ipo/SectionControlBar';
import { CollapsibleSection, ChartErrorBoundary } from '@/components/ui';
import {
  FinancialPerformanceCharts,
  SubscriptionDashboard,
  ListingPerformanceCharts,
  DemandGraph,
  GMPHistoryChart,
} from '@/components/ipo/charts';
import { IPOObjectivesSection } from '@/components/ipo-detail/IPOObjectivesSection';
import { CompanyContactSection } from '@/components/ipo-detail/CompanyContactSection';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
import { PeerComparisonSection } from '@/components/ipo/PeerComparisonSection';
import type { IPODetailResponse } from '@/lib/db/types';

// ==================== TYPES ====================

export interface IPODetailClientSectionsProps {
  ipo: IPODetailResponse['ipo'];
  financialData: IPODetailResponse['financialData'];
  ipoFinancials: IPODetailResponse['ipoFinancials'];
  ipoDetails: IPODetailResponse['ipoDetails'];
  reviewSummary: IPODetailResponse['reviewSummary'];
  subscriptions: IPODetailResponse['subscriptions'];
  latestSubscription: NonNullable<IPODetailResponse['subscriptions']>[0] | null;
  gmpRecords: IPODetailResponse['gmpRecords'];
  listingPerformance: IPODetailResponse['listingPerformance'];
  peerCompanies: IPODetailResponse['peerCompanies'];
}

// ==================== COMPONENT ====================

export function IPODetailClientSections({
  ipo,
  financialData,
  ipoFinancials,
  ipoDetails,
  reviewSummary,
  subscriptions,
  latestSubscription,
  gmpRecords,
  listingPerformance,
  peerCompanies,
}: IPODetailClientSectionsProps) {
  // Define all collapsible section IDs
  const sectionIds = [
    'financial-performance-section',
    'gmp-history-section',
    'listing-performance-section',
    'demand-graph-section',
    'ipo-objectives-section',
    'company-contact-section',
    'recommendation-summary-section',
    'category-reservation-section',
    'peer-comparison-section',
  ];

  // Use section control hook for global state management
  const { expandedSections, allExpanded, toggleAll, toggleSection } =
    useSectionControl(sectionIds, true); // Default expanded = true for important sections

  // Count visible sections (for SectionControlBar display)
  const visibleSectionCount = sectionIds.filter((id) => {
    // Only count sections that are actually rendered
    // TODO: Re-enable when demand graph data is available
    // if (id === 'demand-graph-section') {
    //   return (
    //     (ipo.status === 'OPEN' || ipo.status === 'CLOSED') &&
    //     demandGraph && demandGraph.length > 0
    //   );
    // }
    if (id === 'gmp-history-section') {
      return gmpRecords && gmpRecords.length > 0;
    }
    if (id === 'listing-performance-section') {
      return (
        ipo.status === 'LISTED' &&
        ipo.listingDate &&
        listingPerformance &&
        listingPerformance.issuePrice &&
        listingPerformance.listingPrice
      );
    }
    return true; // Other sections are always visible
  }).length;

  return (
    <>
      {/* Section Control Bar */}
      <SectionControlBar
        sectionCount={visibleSectionCount}
        allExpanded={allExpanded}
        onToggleAll={toggleAll}
        className="mb-6"
        sticky={true}
        zIndex={30}
      />

      {/* Financial Performance Charts (Phase 3 - Visual Dashboard) */}
      {/* Phase 4: Wrapped in CollapsibleSection for progressive disclosure */}
      <CollapsibleSection
        id="financial-performance-section"
        title="Financial Performance Analysis"
        subtitle="Revenue, profitability, and key financial metrics"
        expanded={expandedSections['financial-performance-section']}
        onExpandedChange={(isExpanded) => toggleSection('financial-performance-section', isExpanded)}
        badge={
          financialData?.revenueFy2024 || financialData?.revenueFy2023 || financialData?.revenueFy2022
            ? `₹${(Number(financialData?.revenueFy2024 || financialData?.revenueFy2023 || financialData?.revenueFy2022 || 0) / 10000000).toFixed(0)}Cr Revenue`
            : undefined
        }
        className="mb-6"
      >
        <ChartErrorBoundary chartName="Financial Performance Charts">
          <FinancialPerformanceCharts
            financialData={financialData}
            companyName={ipo.companyName}
            industryBenchmarks={
              ipoFinancials?.industryPe
                ? {
                    industryPe: ipoFinancials.industryPe
                      ? Number(ipoFinancials.industryPe)
                      : null,
                    sectorName: ipo.sector,
                  }
                : undefined
            }
            peerData={
              peerCompanies && peerCompanies.length > 0
                ? peerCompanies.slice(0, 5).map((peer) => ({
                    companyName: peer.companyName,
                    peRatio: peer.peRatio ? Number(peer.peRatio) : null,
                    eps: peer.eps ? Number(peer.eps) : null,
                    ronw: peer.ronw ? Number(peer.ronw) : null,
                  }))
                : undefined
            }
            defaultExpanded={false}
            showAdvanced={false}
          />
        </ChartErrorBoundary>
      </CollapsibleSection>

      {/* Subscription Dashboard (Phase 3 - Real-time Subscription Tracking) */}
      {(ipo.status === 'OPEN' || ipo.status === 'CLOSED' || ipo.status === 'LISTED') &&
        subscriptions &&
        subscriptions.length > 0 && (
          <ChartErrorBoundary chartName="Subscription Dashboard">
            <SubscriptionDashboard
              subscriptions={subscriptions}
              latestSubscription={latestSubscription ?? null}
              companyName={ipo.companyName}
              closeDate={ipo.closeDate ? new Date(ipo.closeDate) : null}
              defaultExpanded={true}
              showAdvanced={false}
            />
          </ChartErrorBoundary>
        )}

      {/* Demand Graph (Phase 3 - Price-wise Demand Distribution) */}
      {/* Phase 3B: Conditional rendering - only show when demand data is available */}
      {/* Phase 4: Wrapped in CollapsibleSection for progressive disclosure */}
      {/* TODO: Re-enable when demand graph data is available in database and added to props */}
      {/* {(ipo.status === 'OPEN' || ipo.status === 'CLOSED') &&
        demandGraph &&
        demandGraph.length > 0 && (
          <CollapsibleSection
            id="demand-graph-section"
            title="Demand Analysis"
            subtitle="Price-wise bid distribution across exchanges"
            expanded={expandedSections['demand-graph-section']}
            onExpandedChange={(isExpanded) => toggleSection('demand-graph-section', isExpanded)}
            className="mb-6"
          >
            <DemandGraph
              demandRecords={demandGraph}
              companyName={ipo.companyName}
              priceRangeMax={ipo.priceRangeMax}
              defaultExchange="BOTH"
              defaultExpanded={false}
              showAdvanced={true}
            />
          </CollapsibleSection>
        )} */}

      {/* Enhanced GMP History Chart (Phase 3 - 30-day Trend Analysis) */}
      {/* Phase 4: Wrapped in CollapsibleSection for progressive disclosure */}
      {gmpRecords && gmpRecords.length > 0 && (
        <CollapsibleSection
          id="gmp-history-section"
          title="Grey Market Premium (GMP) Trend"
          subtitle="30-day GMP movement and expected listing price"
          expanded={expandedSections['gmp-history-section']}
          onExpandedChange={(isExpanded) => toggleSection('gmp-history-section', isExpanded)}
          badge={
            gmpRecords.length > 0 && gmpRecords[0].gmp ? `GMP: ₹${gmpRecords[0].gmp}` : undefined
          }
          className="mb-6"
        >
          <ChartErrorBoundary chartName="GMP History Chart">
            <GMPHistoryChart
              gmpRecords={gmpRecords.map((record) => ({
                id: record.id,
                ipoId: ipo.id,
                timestamp: new Date(record.timestamp),
                gmp: record.gmp,
                expectedListingPrice: record.expectedListingPrice,
                subjectRate: record.subjectRate,
                kostakRate: record.kostakRate,
                saudaDetails: record.saudaDetails,
                source: record.source,
              }))}
              companyName={ipo.companyName}
              priceRangeMax={ipo.priceRangeMax}
              daysToShow={30}
              defaultExpanded={false}
              showAdvanced={true}
              showListingPrice={true}
            />
          </ChartErrorBoundary>
        </CollapsibleSection>
      )}

      {/* IPO Objectives Section (Story 11.13) */}
      {/* Phase 4: Wrapped in CollapsibleSection */}
      <CollapsibleSection
        id="ipo-objectives-section"
        title="Use of Proceeds"
        subtitle="How the company plans to utilize IPO funds"
        expanded={expandedSections['ipo-objectives-section']}
        onExpandedChange={(isExpanded) => toggleSection('ipo-objectives-section', isExpanded)}
        className="mb-6"
      >
        <IPOObjectivesSection objectives={ipo.objectives ?? null} />
      </CollapsibleSection>

      {/* Company Contact Section (Story 11.12) */}
      {/* Phase 4: Wrapped in CollapsibleSection */}
      <CollapsibleSection
        id="company-contact-section"
        title="Company Information"
        subtitle="Contact details, registrar, and compliance officer"
        expanded={expandedSections['company-contact-section']}
        onExpandedChange={(isExpanded) => toggleSection('company-contact-section', isExpanded)}
        className="mb-6"
      >
        <CompanyContactSection
          contactData={
            ipoDetails
              ? {
                  companyAddress: ipoDetails.companyAddress,
                  companyPhone: ipoDetails.companyPhone,
                  companyEmail: ipoDetails.companyEmail,
                  companyCity: ipoDetails.companyCity,
                  companyState: ipoDetails.companyState,
                  companyPincode: ipoDetails.companyPincode,
                  complianceOfficer: ipoDetails.complianceOfficer,
                  complianceOfficerPhone: ipoDetails.complianceOfficerPhone,
                  complianceOfficerEmail: ipoDetails.complianceOfficerEmail,
                }
              : null
          }
        />
      </CollapsibleSection>

      {/* Recommendation Summary Section (Story 11.14) */}
      {/* Phase 4: Wrapped in CollapsibleSection */}
      <CollapsibleSection
        id="recommendation-summary-section"
        title="Analyst Recommendations"
        subtitle="Expert reviews and ratings from top analysts"
        expanded={expandedSections['recommendation-summary-section']}
        onExpandedChange={(isExpanded) =>
          toggleSection('recommendation-summary-section', isExpanded)
        }
        className="mb-6"
      >
        <RecommendationSummarySection
          reviewSummary={reviewSummary ?? null}
          ipoSegment={(ipo.segment as 'MAINBOARD' | 'SME') || 'MAINBOARD'}
        />
      </CollapsibleSection>

      {/* Category Reservation Section (Story 11.9) */}
      {/* Phase 4: Wrapped in CollapsibleSection */}
      <CollapsibleSection
        id="category-reservation-section"
        title="Share Allocation"
        subtitle="Category-wise reservation and lot sizes"
        expanded={expandedSections['category-reservation-section']}
        onExpandedChange={(isExpanded) =>
          toggleSection('category-reservation-section', isExpanded)
        }
        className="mb-6"
      >
        <CategoryReservationSection
          reservationData={
            ipoDetails
              ? {
                  qibSharesOffered: ipoDetails.qibSharesOffered,
                  niiSharesOffered: ipoDetails.niiSharesOffered,
                  retailSharesOffered: ipoDetails.retailSharesOffered,
                  retailMaxAllottees: ipoDetails.retailMaxAllottees,
                  employeeSharesOffered: ipoDetails.employeeSharesOffered,
                  anchorSharesOffered: ipoDetails.anchorSharesOffered,
                }
              : null
          }
        />
      </CollapsibleSection>

      {/* Peer Comparison Section (Story 11.11) */}
      {/* Phase 4: Wrapped in CollapsibleSection */}
      <CollapsibleSection
        id="peer-comparison-section"
        title="Peer Comparison"
        subtitle="Compare key metrics with industry peers"
        expanded={expandedSections['peer-comparison-section']}
        onExpandedChange={(isExpanded) => toggleSection('peer-comparison-section', isExpanded)}
        badge={peerCompanies && peerCompanies.length > 0 ? `${peerCompanies.length} peers` : undefined}
        className="mb-6"
      >
        <PeerComparisonSection companyName={ipo.companyName} peerCompanies={peerCompanies} />
      </CollapsibleSection>

      {/* Listing Performance Charts (Phase 3 - Post-Listing Tracking) */}
      {/* Phase 4: Wrapped in CollapsibleSection for progressive disclosure */}
      {ipo.status === 'LISTED' &&
        ipo.listingDate &&
        listingPerformance &&
        listingPerformance.issuePrice &&
        listingPerformance.listingPrice && (
          <CollapsibleSection
            id="listing-performance-section"
            title="Post-Listing Performance"
            subtitle="Stock price movement and market performance"
            expanded={expandedSections['listing-performance-section']}
            onExpandedChange={(isExpanded) =>
              toggleSection('listing-performance-section', isExpanded)
            }
            badge={
              listingPerformance.listingGainPercent
                ? `${Number(listingPerformance.listingGainPercent) > 0 ? '+' : ''}${Number(
                    listingPerformance.listingGainPercent
                  ).toFixed(1)}% Listing Gain`
                : undefined
            }
            className="mb-6"
          >
            <ChartErrorBoundary chartName="Listing Performance Charts">
              <ListingPerformanceCharts
                listingPerformance={{
                  issuePrice: listingPerformance.issuePrice,
                  listingPrice: listingPerformance.listingPrice,
                  listingGainPercent: Number(listingPerformance.listingGainPercent),
                  currentPrice: listingPerformance.currentPrice
                    ? Number(listingPerformance.currentPrice)
                    : null,
                  currentGainPercent: listingPerformance.currentGainPercent
                    ? Number(listingPerformance.currentGainPercent)
                    : null,
                  // Note: weekHigh52, weekLow52, marketCap, volume not in DB schema yet
                }}
                issuePrice={listingPerformance.issuePrice}
                companyName={ipo.companyName}
                sector={ipo.sector}
                listingDate={new Date(ipo.listingDate)}
                defaultExpanded={true}
                showAdvanced={false}
              />
            </ChartErrorBoundary>
          </CollapsibleSection>
        )}
    </>
  );
}
