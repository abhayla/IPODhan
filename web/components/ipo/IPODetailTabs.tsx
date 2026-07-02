/**
 * IPODetailTabs Component
 *
 * Tabbed interface for Tier 2 data (below fold)
 * Features:
 * - Progressive loading with React.lazy() and Suspense
 * - URL query parameter sync (?tab=financials)
 * - Loading skeletons for tab content
 * - Smooth transitions (<500ms)
 * - Mobile-responsive horizontal scrolling
 *
 * Tabs:
 * - Overview: Company description, rating, share buttons
 * - Financials: 3-year financial data table
 * - Peer Comparison: Compare with peer companies (Story 4.8)
 * - Subscription: Subscription breakdown by category
 * - GMP: Grey Market Premium chart
 * - Documents: DRHP, RHP, Prospectus links
 */

'use client';

import { useEffect, useState } from 'react';
// Session 6: lazy and Suspense removed - no longer using lazy loading
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { IPODetailResponse, IPO } from '@/lib/db/types';
import {
  CompanyOverviewSkeleton,
  FinancialTableSkeleton,
  SubscriptionBreakdownSkeleton,
  GMPChartSkeleton,
  DocumentListSkeleton,
} from './skeletons';
import { TabErrorBoundary } from './TabErrorBoundary';

// Session 6: Lazy loading disabled - causes webpack errors with React 19 + Next.js 15
// Direct imports used instead for stability
import { CompanyOverview } from './CompanyOverview';
import { RatingDisplay } from './RatingDisplay';
import { ShareButtons } from './ShareButtons';
import { FinancialTable } from './FinancialTable';
import { PeerComparisonTab } from './PeerComparisonTab';
import { EnhancedSubscriptionView } from './EnhancedSubscriptionView';
import { GMPChart } from './GMPChart';
import { DocumentList } from './DocumentList';
import { DemandGraphChart } from '../ipo-detail/DemandGraphChart';
import { UPIDeadlineTimer } from '../ipo-detail/UPIDeadlineTimer';

// TEMP: Lazy loading commented out - React 19 + Next.js 15 webpack issues
// const CompanyOverview = lazy(() =>
//   import('./CompanyOverview').then((mod) => ({ default: mod.CompanyOverview }))
// );
// const RatingDisplay = lazy(() =>
//   import('./RatingDisplay').then((mod) => ({ default: mod.RatingDisplay }))
// );
// const ShareButtons = lazy(() =>
//   import('./ShareButtons').then((mod) => ({ default: mod.ShareButtons }))
// );
// const FinancialTable = lazy(() =>
//   import('./FinancialTable').then((mod) => ({ default: mod.FinancialTable }))
// );
// const PeerComparisonTab = lazy(() =>
//   import('./PeerComparisonTab').then((mod) => ({ default: mod.PeerComparisonTab }))
// );
// const EnhancedSubscriptionView = lazy(() =>
//   import('./EnhancedSubscriptionView').then((mod) => ({ default: mod.EnhancedSubscriptionView }))
// );
// const GMPChart = lazy(() =>
//   import('./GMPChart').then((mod) => ({ default: mod.GMPChart }))
// );
// const DocumentList = lazy(() =>
//   import('./DocumentList').then((mod) => ({ default: mod.DocumentList }))
// );
// const DemandGraphChart = lazy(() =>
//   import('../ipo-detail/DemandGraphChart').then((mod) => ({ default: mod.DemandGraphChart }))
// );
// const UPIDeadlineTimer = lazy(() =>
//   import('../ipo-detail/UPIDeadlineTimer').then((mod) => ({ default: mod.UPIDeadlineTimer }))
// );

// ==================== TYPES ====================

interface IPODetailTabsProps {
  slug: string;
  ipo: IPO;
  ipoData: IPODetailResponse;
  initialTab?: string;
}

type TabValue = 'overview' | 'financials' | 'peercomparison' | 'subscription' | 'gmp' | 'documents' | 'demand';

// Valid tab values for validation
const VALID_TABS: TabValue[] = ['overview', 'financials', 'peercomparison', 'subscription', 'gmp', 'documents', 'demand'];

// ==================== HELPER FUNCTIONS ====================

/**
 * Get status-aware message for Subscription tab
 * Returns appropriate message based on IPO status
 */
function getSubscriptionMessage(status: string): string {
  switch (status) {
    case 'LISTED':
      return 'Historical subscription data for this IPO is not available.';
    case 'CLOSED':
      return 'Subscription data for this IPO is not available.';
    case 'UPCOMING':
      return 'Subscription data will be available once the IPO opens for bidding.';
    case 'OPEN':
      return 'Subscription data is being tracked and will be updated in real-time during the IPO period.';
    default:
      return 'Subscription data not available.';
  }
}

/**
 * Get status-aware message for GMP tab
 * Returns appropriate message based on IPO status
 */
function getGMPMessage(status: string): string {
  switch (status) {
    case 'LISTED':
      return 'Grey Market Premium is no longer tracked after listing. Check the listing performance section for current market data.';
    case 'CLOSED':
      return 'Grey Market Premium data for this IPO is not available.';
    case 'UPCOMING':
      return 'Grey Market Premium will be tracked closer to the IPO opening.';
    case 'OPEN':
      return 'Grey Market Premium is being tracked and updated regularly during the IPO period.';
    default:
      return 'GMP data not available.';
  }
}

/**
 * Get status-aware message for Documents tab
 * Returns appropriate message based on IPO status
 */
function getDocumentsMessage(status: string): string {
  switch (status) {
    case 'LISTED':
      return 'IPO documents (DRHP, RHP, Prospectus) for this listed company are not available in our database.';
    case 'CLOSED':
      return 'IPO documents (DRHP, RHP, Prospectus) for this IPO are not available in our database.';
    case 'UPCOMING':
    case 'OPEN':
      return 'IPO documents (DRHP, RHP, Prospectus) will be added once available.';
    default:
      return 'IPO documents not available.';
  }
}

// ==================== COMPONENT ====================

/**
 * IPODetailTabs component with progressive loading
 * Syncs active tab with URL query parameter
 */
export function IPODetailTabs({
  slug,
  ipo,
  ipoData,
  initialTab = 'overview',
}: IPODetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get active tab from URL or use initial tab (with validation)
  const urlTab = searchParams.get('tab');
  const validatedTab = urlTab && VALID_TABS.includes(urlTab as TabValue)
    ? (urlTab as TabValue)
    : null;

  const [activeTab, setActiveTab] = useState<TabValue>(
    validatedTab || (initialTab as TabValue)
  );

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    setActiveTab(newTab);

    // Update URL query parameter without scroll
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === 'overview') {
      params.delete('tab'); // Remove tab param for default tab
    } else {
      params.set('tab', newTab);
    }

    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    router.push(newUrl, { scroll: false });
  };

  // Sync state with URL changes (browser back/forward)
  useEffect(() => {
    const tab = searchParams.get('tab') as TabValue | null;
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    } else if (!tab && activeTab !== 'overview') {
      setActiveTab('overview');
    }
  }, [searchParams, activeTab]);

  // Extract data for tabs (Story 4.10: Added ipoFinancials)
  const { financialData, ipoFinancials, documents, subscriptions, gmpRecords, peerCompanies } = ipoData;

  // Check if peer comparison data exists
  const hasPeerData = peerCompanies && peerCompanies.length > 0;

  // Share URL for social sharing
  const shareUrl = `https://ipodhan.com/ipos/${slug}`;

  // Prepare key metrics for share text
  const latestSubscription = subscriptions?.[0];
  const latestGMP = gmpRecords?.[0];
  const keyMetrics = {
    subscription: latestSubscription?.totalSubscription
      ? Number(latestSubscription.totalSubscription)
      : null,
    gmp: latestGMP?.gmp ?? null,
    issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      {/* Tab List */}
      {/* Mobile: horizontally scrollable flex strip — a 6/7-col grid at 390px
          collided tab labels into unreadable/untappable slivers (2026-07-02
          blind review). Desktop keeps the grid. */}
      <TabsList
        className={`flex w-full overflow-x-auto justify-start md:grid ${hasPeerData ? 'md:grid-cols-7' : 'md:grid-cols-6'} lg:w-auto lg:inline-grid shadow-sm`}
      >
        <TabsTrigger value="overview" className="touch-manipulation">Overview</TabsTrigger>
        <TabsTrigger value="financials" className="touch-manipulation">Financials</TabsTrigger>
        {hasPeerData && (
          <TabsTrigger value="peercomparison" className="touch-manipulation">Peers</TabsTrigger>
        )}
        <TabsTrigger value="subscription" className="touch-manipulation">Subscription</TabsTrigger>
        <TabsTrigger value="demand" className="touch-manipulation">Demand</TabsTrigger>
        <TabsTrigger value="gmp" className="touch-manipulation">GMP</TabsTrigger>
        <TabsTrigger value="documents" className="touch-manipulation">Documents</TabsTrigger>
      </TabsList>

      {/* Tab Contents */}

      {/* Overview Tab */}
      <TabsContent value="overview" className="space-y-6 mt-6">
        <TabErrorBoundary tabName="Overview">
          <CompanyOverview
            companyDescription={ipo.companyDescription || 'No description available.'}
            riskFactors={[]} // TODO: Add risk factors when available
          />
        </TabErrorBoundary>

        {/* Rating Section — hidden until a rating exists; an empty 'Not Rated'
            section undermines authority (2026-07-02 blind review). The header
            already shows the rating when present. */}
        {ipo.rating && (
          <TabErrorBoundary tabName="Rating">
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-lg font-semibold">IPODhan Rating</h3>
              <RatingDisplay
                rating={ipo.rating}
                rationale={ipo.ratingRationale}
                showRationale={true}
                size="lg"
              />
            </div>
          </TabErrorBoundary>
        )}

        {/* Share Buttons */}
        <TabErrorBoundary tabName="Share">
          <ShareButtons
            companyName={ipo.companyName}
            rating={ipo.rating}
            url={shareUrl}
            keyMetrics={keyMetrics}
          />
        </TabErrorBoundary>
      </TabsContent>

      {/* Financials Tab (Story 4.10: Pass ipoFinancials) */}
      <TabsContent value="financials" className="mt-6">
        <TabErrorBoundary tabName="Financials">
          {financialData ? (
            <FinancialTable
              financialData={financialData}
              ipoFinancials={ipoFinancials}
            />
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                Financial data not available yet.
              </p>
            </div>
          )}
        </TabErrorBoundary>
      </TabsContent>

      {/* Peer Comparison Tab (Story 4.8) */}
      {hasPeerData && (
        <TabsContent value="peercomparison" className="mt-6">
          <TabErrorBoundary tabName="Peer Comparison">
            <PeerComparisonTab ipoData={ipoData} />
          </TabErrorBoundary>
        </TabsContent>
      )}

      {/* Subscription Tab (Story 5.6: Enhanced with 7 categories) */}
      <TabsContent value="subscription" className="mt-6">
        <TabErrorBoundary tabName="Subscription">
          {subscriptions && subscriptions.length > 0 ? (
            <EnhancedSubscriptionView
              subscription={subscriptions[0]}
              issueSize={ipo.issueSize}
            />
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                {getSubscriptionMessage(ipo.status)}
              </p>
            </div>
          )}
        </TabErrorBoundary>
      </TabsContent>

      {/* Demand Tab - NEW: Price-wise demand visualization */}
      <TabsContent value="demand" className="mt-6">
        <TabErrorBoundary tabName="Demand Graph">
          <DemandGraphChart
            ipoSlug={slug}
            priceRangeMin={ipo.priceRangeMin ?? undefined}
            priceRangeMax={ipo.priceRangeMax ?? undefined}
          />
        </TabErrorBoundary>
      </TabsContent>

      {/* GMP Tab */}
      <TabsContent value="gmp" className="mt-6">
        <TabErrorBoundary tabName="GMP">
          {gmpRecords && gmpRecords.length > 0 ? (
            <GMPChart
              gmpRecords={gmpRecords}
            />
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                {getGMPMessage(ipo.status)}
              </p>
            </div>
          )}
        </TabErrorBoundary>
      </TabsContent>

      {/* Documents Tab */}
      <TabsContent value="documents" className="mt-6">
        <TabErrorBoundary tabName="Documents">
          {documents && documents.length > 0 ? (
            <DocumentList documents={documents} />
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                {getDocumentsMessage(ipo.status)}
              </p>
            </div>
          )}
        </TabErrorBoundary>
      </TabsContent>
    </Tabs>
  );
}
