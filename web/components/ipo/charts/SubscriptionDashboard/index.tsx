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

  // If no data, show empty state
  if (!hasData) {
    return (
      <div className={cn('rounded-lg border bg-card', className)}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <BarChart className="h-6 w-6 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">Subscription Dashboard</h3>
                <p className="text-sm text-muted-foreground">
                  Real-time subscription tracking
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-muted-foreground/25 p-12 text-center">
            <BarChart className="mx-auto h-16 w-16 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">
              No Subscription Data Available
            </p>
            <p className="text-sm text-muted-foreground">
              {ipoEmptyStateMessage('subscription', status, companyName)}
            </p>
          </div>
        </div>
      </div>
    );
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
                Real-time tracking for {companyName}
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

        {/* Data Quality Indicator */}
        {isExpanded && (
          <div className="mt-4 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${completeness}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {completeness}% data
            </span>
          </div>
        )}
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
