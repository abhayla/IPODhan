'use client';

/**
 * ListingPerformanceCharts Component
 *
 * Comprehensive post-listing performance dashboard combining:
 * - Stock price movement chart with period metrics
 * - Listing gains visualization with gauge chart
 * - Sector comparison analysis
 *
 * @example
 * ```tsx
 * <ListingPerformanceCharts
 *   listingPerformance={performanceData}
 *   issuePrice={100}
 *   companyName="XYZ Corporation"
 *   sector="Technology"
 *   listingDate={new Date('2024-01-15')}
 * />
 * ```
 */

import { useState } from 'react';
import { StockPriceChart } from './StockPriceChart';
import { ListingGainsChart } from './ListingGainsChart';
import { SectorComparisonChart } from './SectorComparisonChart';
import {
  generateHistoricalPriceData,
  calculatePerformancePeriods,
  calculateSectorComparison,
  calculateListingDayStats,
  hasMinimumListingData,
} from './utils';
import type { ListingPerformanceChartsProps } from './types';
import { ChartContainer } from '../ChartContainer';
import { cn } from '@/lib/utils';
import { HiChevronDown, HiChevronUp, HiChartBar } from 'react-icons/hi2';

export function ListingPerformanceCharts({
  listingPerformance,
  issuePrice,
  companyName,
  sector,
  listingDate,
  className,
  showAdvanced = false,
  defaultExpanded = true,
}: ListingPerformanceChartsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeView, setActiveView] = useState<'all' | 'price' | 'gains' | 'sector'>('all');

  // Check if we have minimum data
  const hasData = hasMinimumListingData(listingPerformance);

  // If no data, show empty state
  if (!hasData) {
    return (
      <div className={cn('rounded-lg border bg-card', className)}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <HiChartBar className="h-6 w-6 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">Listing Performance</h3>
                <p className="text-sm text-muted-foreground">
                  Post-listing stock performance tracking
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-muted-foreground/25 p-12 text-center">
            <HiChartBar className="mx-auto h-16 w-16 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">
              No Listing Data Available
            </p>
            <p className="text-sm text-muted-foreground">
              Performance data will appear here once {companyName} is listed
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Generate mock historical price data
  // NOTE: In production, this would fetch real data from stock market API
  const priceData = listingDate
    ? generateHistoricalPriceData(
        listingDate,
        issuePrice,
        listingPerformance.listingPrice,
        listingPerformance.currentPrice ?? null
      )
    : [];

  // Calculate performance periods
  const periods = calculatePerformancePeriods(
    priceData,
    listingPerformance.currentPrice ?? null,
    listingPerformance.listingPrice
  );

  // Calculate sector comparison
  const sectorComparison = calculateSectorComparison(
    listingPerformance.listingGainPercent,
    null, // In production, fetch sector average from API
    sector ?? null
  );

  // Calculate listing day stats
  const listingDayStats = calculateListingDayStats(
    issuePrice,
    listingPerformance.listingPrice,
    listingPerformance.listingGainPercent
  );

  // Determine loading state
  const isLoading = false; // Could be passed as prop in future

  // View options
  const viewOptions = [
    { value: 'all' as const, label: 'All Views' },
    { value: 'price' as const, label: 'Price Chart' },
    { value: 'gains' as const, label: 'Listing Gains' },
    { value: 'sector' as const, label: 'Sector Compare' },
  ];

  const shouldShowView = (view: 'price' | 'gains' | 'sector'): boolean => {
    return activeView === 'all' || activeView === view;
  };

  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HiChartBar className="h-6 w-6 text-primary" />
            <div>
              <h3 className="text-lg font-semibold">Listing Performance</h3>
              <p className="text-sm text-muted-foreground">
                Post-listing tracking for {companyName}
              </p>
            </div>
          </div>

          {/* Expand/Collapse Button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium"
            aria-label={isExpanded ? 'Collapse performance charts' : 'Expand performance charts'}
          >
            <span className="hidden sm:inline">
              {isExpanded ? 'Collapse' : 'Expand'}
            </span>
            {isExpanded ? (
              <HiChevronUp className="h-4 w-4" />
            ) : (
              <HiChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-6">
          {/* View Selector (only shown in advanced mode) */}
          {showAdvanced && (
            <div className="flex flex-wrap gap-2 mb-6 p-4 bg-muted/30 rounded-lg">
              {viewOptions.map((option) => {
                const isActive = activeView === option.value;

                return (
                  <button
                    key={option.value}
                    onClick={() => setActiveView(option.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background hover:bg-muted'
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-6">
            {/* Listing Gains Gauge */}
            {shouldShowView('gains') && (
              <ChartContainer
                title="Listing Day Performance"
                description="Gain/loss on listing day vs issue price"
                isEmpty={false}
                isLoading={isLoading}
              >
                <ListingGainsChart
                  issuePrice={issuePrice}
                  listingPrice={listingPerformance.listingPrice}
                  listingGainPercent={listingPerformance.listingGainPercent}
                  currentPrice={listingPerformance.currentPrice ?? undefined}
                  currentGainPercent={listingPerformance.currentGainPercent ?? undefined}
                  listingDayStats={listingDayStats}
                />
              </ChartContainer>
            )}

            {/* Stock Price Chart */}
            {shouldShowView('price') && priceData.length > 0 && (
              <ChartContainer
                title="Stock Price Movement"
                description="Historical price tracking since listing"
                isEmpty={priceData.length === 0}
                isLoading={isLoading}
              >
                <StockPriceChart
                  priceData={priceData}
                  issuePrice={issuePrice}
                  currentPrice={listingPerformance.currentPrice ?? null}
                  periods={periods}
                  weekHigh52={listingPerformance.weekHigh52 ?? null}
                  weekLow52={listingPerformance.weekLow52 ?? null}
                />
              </ChartContainer>
            )}

            {/* Sector Comparison */}
            {shouldShowView('sector') && sectorComparison && (
              <ChartContainer
                title="Sector Comparison"
                description={`Performance vs ${sector} sector average`}
                isEmpty={!sectorComparison}
                isLoading={isLoading}
              >
                <SectorComparisonChart comparison={sectorComparison} />
              </ChartContainer>
            )}
          </div>

          {/* Production Note */}
          {priceData.length === 0 && (
            <div className="mt-4 rounded-lg bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground text-center">
                ⓘ Historical price data integration coming soon. Currently showing listing day performance only.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export types for convenience
export type { ListingPerformanceChartsProps } from './types';
