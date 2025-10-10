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
 * - Subscription: Subscription breakdown by category
 * - GMP: Grey Market Premium chart
 * - Documents: DRHP, RHP, Prospectus links
 */

'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
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

// Lazy load tab components for code-splitting
const CompanyOverview = lazy(() =>
  import('./CompanyOverview').then((mod) => ({ default: mod.CompanyOverview }))
);
const RatingDisplay = lazy(() =>
  import('./RatingDisplay').then((mod) => ({ default: mod.RatingDisplay }))
);
const ShareButtons = lazy(() =>
  import('./ShareButtons').then((mod) => ({ default: mod.ShareButtons }))
);
const FinancialTable = lazy(() =>
  import('./FinancialTable').then((mod) => ({ default: mod.FinancialTable }))
);
const SubscriptionBreakdown = lazy(() =>
  import('./SubscriptionBreakdown').then((mod) => ({ default: mod.SubscriptionBreakdown }))
);
const GMPChart = lazy(() =>
  import('./GMPChart').then((mod) => ({ default: mod.GMPChart }))
);
const DocumentList = lazy(() =>
  import('./DocumentList').then((mod) => ({ default: mod.DocumentList }))
);

// ==================== TYPES ====================

interface IPODetailTabsProps {
  slug: string;
  ipo: IPO;
  ipoData: IPODetailResponse;
  initialTab?: string;
}

type TabValue = 'overview' | 'financials' | 'subscription' | 'gmp' | 'documents';

// Valid tab values for validation
const VALID_TABS: TabValue[] = ['overview', 'financials', 'subscription', 'gmp', 'documents'];

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

  // Extract data for tabs
  const { financialData, documents, subscriptions, gmpRecords } = ipoData;

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
      <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid shadow-sm">
        <TabsTrigger value="overview" className="touch-manipulation">Overview</TabsTrigger>
        <TabsTrigger value="financials" className="touch-manipulation">Financials</TabsTrigger>
        <TabsTrigger value="subscription" className="touch-manipulation">Subscription</TabsTrigger>
        <TabsTrigger value="gmp" className="touch-manipulation">GMP</TabsTrigger>
        <TabsTrigger value="documents" className="touch-manipulation">Documents</TabsTrigger>
      </TabsList>

      {/* Tab Contents */}

      {/* Overview Tab */}
      <TabsContent value="overview" className="space-y-6 mt-6">
        <TabErrorBoundary tabName="Overview">
          <Suspense fallback={<CompanyOverviewSkeleton />}>
            <CompanyOverview
              companyDescription={ipo.companyDescription || 'No description available.'}
              riskFactors={[]} // TODO: Add risk factors when available
            />
          </Suspense>
        </TabErrorBoundary>

        {/* Rating Section */}
        <TabErrorBoundary tabName="Rating">
          <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-lg font-semibold">IPODhan Rating</h3>
              <RatingDisplay
                rating={ipo.rating}
                rationale={ipo.ratingRationale}
                showRationale={true}
                size="lg"
              />
            </div>
          </Suspense>
        </TabErrorBoundary>

        {/* Share Buttons */}
        <TabErrorBoundary tabName="Share">
          <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted" />}>
            <ShareButtons
              companyName={ipo.companyName}
              rating={ipo.rating}
              url={shareUrl}
              keyMetrics={keyMetrics}
            />
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>

      {/* Financials Tab */}
      <TabsContent value="financials" className="mt-6">
        <TabErrorBoundary tabName="Financials">
          <Suspense fallback={<FinancialTableSkeleton />}>
            {financialData ? (
              <FinancialTable financialData={financialData} />
            ) : (
              <div className="rounded-lg border bg-card p-8 text-center">
                <p className="text-muted-foreground">
                  Financial data not available yet.
                </p>
              </div>
            )}
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>

      {/* Subscription Tab */}
      <TabsContent value="subscription" className="mt-6">
        <TabErrorBoundary tabName="Subscription">
          <Suspense fallback={<SubscriptionBreakdownSkeleton />}>
            {subscriptions && subscriptions.length > 0 ? (
              <SubscriptionBreakdown subscription={subscriptions[0]} />
            ) : (
              <div className="rounded-lg border bg-card p-8 text-center">
                <p className="text-muted-foreground">
                  Subscription data will be available once the IPO opens for bidding.
                </p>
              </div>
            )}
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>

      {/* GMP Tab */}
      <TabsContent value="gmp" className="mt-6">
        <TabErrorBoundary tabName="GMP">
          <Suspense fallback={<GMPChartSkeleton />}>
            {gmpRecords && gmpRecords.length > 0 ? (
              <GMPChart
                gmpRecords={gmpRecords}
              />
            ) : (
              <div className="rounded-lg border bg-card p-8 text-center">
                <p className="text-muted-foreground">
                  GMP data not available yet. Grey Market Premium will be tracked closer to the IPO opening.
                </p>
              </div>
            )}
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>

      {/* Documents Tab */}
      <TabsContent value="documents" className="mt-6">
        <TabErrorBoundary tabName="Documents">
          <Suspense fallback={<DocumentListSkeleton />}>
            {documents && documents.length > 0 ? (
              <DocumentList documents={documents} />
            ) : (
              <div className="rounded-lg border bg-card p-8 text-center">
                <p className="text-muted-foreground">
                  IPO documents (DRHP, RHP, Prospectus) will be added once available.
                </p>
              </div>
            )}
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>
    </Tabs>
  );
}
