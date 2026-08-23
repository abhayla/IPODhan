'use client';

/**
 * SubscriptionDashboard Component
 *
 * Comprehensive subscription tracking dashboard combining multiple visualizations:
 * - Overall subscription timeline (stacked area chart)
 * - Category breakdown (QIB, NII, Retail)
 * - Subscription heatmap (day-by-day intensity)
 * - Investor category cards (with sparklines)
 *
 * @example
 * ```tsx
 * <SubscriptionDashboard
 *   subscriptions={subscriptionData}
 *   latestSubscription={latest}
 *   companyName="XYZ Corporation"
 *   closeDate={new Date('2025-11-15')}
 * />
 * ```
 */

import { useState } from 'react';
import { OverallSubscriptionChart } from './OverallSubscriptionChart';
import { CategoryBreakdownChart } from './CategoryBreakdownChart';
import { SubscriptionHeatmap } from './SubscriptionHeatmap';
import { InvestorCategoryCards } from './InvestorCategoryCards';
import {
  transformToTimeSeriesData,
  calculateSubscriptionStats,
  getCategoryBreakdown,
  transformToHeatmapData,
  hasMinimumSubscriptionData,
  calculateSubscriptionCompleteness,
} from './utils';
import type { SubscriptionDashboardProps } from './types';
import { ChartContainer } from '../ChartContainer';
import { cn } from '@/lib/utils';
import { ipoEmptyStateMessage } from '@/lib/utils/ipo-empty-state-copy';
import {
  ChevronDown,
  ChevronUp,
  BarChart,
  Calendar,
  Users,
} from 'lucide-react';

export function SubscriptionDashboard({
  subscriptions,
  latestSubscription,
  companyName,
  closeDate,
  status,
  className,
  showAdvanced = false,
  defaultExpanded = true,
}: SubscriptionDashboardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeView, setActiveView] = useState<
    'overview' | 'categories' | 'heatmap' | 'all'
  >('overview'); // compact default — 'all' stacked 4x subscription views (2026-07-02 review)

  // Check if we have minimum data
  const hasData = hasMinimumSubscriptionData(subscriptions);

  // No data → render nothing. A full-height "No Subscription Data" card is the
  // exact empty-state noise the R17 review flagged; the detail page's one-line
  // "Awaiting data" strip acknowledges it once instead (R17 #1).
  if (!hasData) {
    return null;
  }

  // Transform data for visualizations
  const timeSeriesData = transformToTimeSeriesData(subscriptions);
  const stats = calculateSubscriptionStats(subscriptions, latestSubscription);
  const categories = getCategoryBreakdown(latestSubscription, stats);
  const heatmapData = transformToHeatmapData(subscriptions);

  // Calculate data completeness
  const completeness = calculateSubscriptionCompleteness(subscriptions);

  // Determine loading state
  const isLoading = false; // Could be passed as prop in future

  // P3-15 (T-302): the dashboard kept "real-time" framing even after the IPO
  // had CLOSED/LISTED — honest only while bidding is genuinely ongoing.
  const isStillBidding = status !== 'CLOSED' && status !== 'LISTED';

  // View toggles
  const viewOptions = [
    { value: 'all' as const, label: 'All Views', icon: BarChart },
    { value: 'overview' as const, label: 'Overview', icon: BarChart },
    { value: 'categories' as const, label: 'Categories', icon: Users },
    { value: 'heatmap' as const, label: 'Heatmap', icon: Calendar },
  ];

  const shouldShowView = (view: 'overview' | 'categories' | 'heatmap'): boolean => {
    return activeView === 'all' || activeView === view;
  };

  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart className="h-6 w-6 text-primary" />
            <div>
              <h3 className="text-lg font-semibold">Subscription Dashboard</h3>
              <p className="text-sm text-muted-foreground">
                {isStillBidding ? 'Real-time tracking' : 'Final subscription data'} for {companyName}
              </p>
            </div>
          </div>

          {/* Expand/Collapse Button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium"
            aria-label={isExpanded ? 'Collapse dashboard' : 'Expand dashboard'}
          >
            <span className="hidden sm:inline">
              {isExpanded ? 'Collapse' : 'Expand'}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Unlabeled "90% data" meter removed — an opaque meter erodes trust
            on a finance page (round-8 scorer; spec deletion list). */}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-6">
          {/* View Selector (only shown in advanced mode) */}
          {showAdvanced && (
            <div className="flex flex-wrap gap-2 mb-6 p-4 bg-muted/30 rounded-lg">
              {viewOptions.map((option) => {
                const Icon = option.icon;
                const isActive = activeView === option.value;

                return (
                  <button
                    key={option.value}
                    onClick={() => setActiveView(option.value)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background hover:bg-muted'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-6">
            {/* Overview: Overall Subscription Chart */}
            {shouldShowView('overview') && (
              <ChartContainer
                title="Overall Subscription Trend"
                description="Time-series view of subscription buildup"
                isEmpty={timeSeriesData.length === 0}
                isLoading={isLoading}
              >
                <OverallSubscriptionChart
                  data={timeSeriesData}
                  stats={stats}
                  closeDate={closeDate}
                  status={status}
                />
              </ChartContainer>
            )}

            {/* Categories: Category Breakdown + Investor Cards */}
            {shouldShowView('categories') && (
              <>
                <ChartContainer
                  title="Category Breakdown"
                  description="Subscription by investor category"
                  isEmpty={categories.length === 0}
                  isLoading={isLoading}
                >
                  <CategoryBreakdownChart categories={categories} stats={stats} />
                </ChartContainer>

                <ChartContainer
                  title="Investor Category Details"
                  description="Category-wise subscription trends"
                  isEmpty={categories.length === 0}
                  isLoading={isLoading}
                >
                  <InvestorCategoryCards
                    categories={categories}
                    subscriptions={subscriptions}
                  />
                </ChartContainer>
              </>
            )}

            {/* Heatmap: Day-by-day Activity */}
            {shouldShowView('heatmap') && heatmapData.length > 0 && (
              <ChartContainer
                title="Daily Activity Heatmap"
                description="Subscription intensity day-by-day"
                isEmpty={heatmapData.length === 0}
                isLoading={isLoading}
              >
                <SubscriptionHeatmap data={heatmapData} />
              </ChartContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export types for convenience
export type { SubscriptionDashboardProps } from './types';
