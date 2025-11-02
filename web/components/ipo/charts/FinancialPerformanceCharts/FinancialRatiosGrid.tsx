'use client';

/**
 * FinancialRatiosGrid Component
 *
 * Displays key financial ratios in a responsive grid layout with trend indicators
 * and industry comparisons.
 */

import React from 'react';
import type { FinancialRatiosGridProps } from './types';
import { prepareFinancialRatios } from './utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * FinancialRatiosGrid - Grid of financial ratio cards
 *
 * Features:
 * - Responsive grid layout (2x2 on desktop, 1 column on mobile)
 * - Color-coded trend indicators
 * - Industry benchmark comparison
 * - Detailed descriptions on hover
 * - Empty state handling
 *
 * @example
 * ```tsx
 * <FinancialRatiosGrid
 *   financialData={data}
 *   industryBenchmarks={{ industryPe: 25, sectorName: 'Technology' }}
 *   showComparison={true}
 * />
 * ```
 */
export function FinancialRatiosGrid({
  financialData,
  industryBenchmarks,
  showComparison = false,
}: FinancialRatiosGridProps): React.ReactElement {
  // Prepare ratios for display
  const ratios = prepareFinancialRatios(financialData, industryBenchmarks);

  // Empty state
  if (ratios.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          No financial ratios available for this IPO
        </p>
      </div>
    );
  }

  // Render trend icon
  const renderTrendIcon = (trend: 'up' | 'down' | 'neutral') => {
    if (trend === 'up') {
      return <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />;
    }
    if (trend === 'down') {
      return <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />;
    }
    return <Minus className="h-4 w-4 text-gray-500 dark:text-gray-400" />;
  };

  // Get color classes for card border based on color scheme
  const getColorClasses = (scheme: string) => {
    switch (scheme) {
      case 'green':
        return 'border-l-green-500 bg-green-50 dark:bg-green-950/20';
      case 'red':
        return 'border-l-red-500 bg-red-50 dark:bg-red-950/20';
      case 'blue':
        return 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/20';
      case 'amber':
        return 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/20';
      default:
        return 'border-l-gray-500 bg-gray-50 dark:bg-gray-950/20';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Key Financial Ratios
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Essential metrics for investment analysis
          </p>
        </div>
        {showComparison && industryBenchmarks && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Sector: {industryBenchmarks.sectorName || 'N/A'}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {ratios.map((ratio) => (
          <div
            key={ratio.label}
            className={`
              border-l-4 rounded-lg p-4 transition-shadow hover:shadow-md
              ${getColorClasses(ratio.colorScheme)}
            `}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {ratio.label}
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {ratio.description}
                </p>
              </div>
              {renderTrendIcon(ratio.trend)}
            </div>

            {/* Value */}
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {ratio.value}
              </span>
              {ratio.trendPercentage !== null && (
                <span
                  className={`text-xs font-medium ${
                    ratio.trendPercentage >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {ratio.trendPercentage >= 0 ? '+' : ''}
                  {ratio.trendPercentage.toFixed(1)}%
                </span>
              )}
            </div>

            {/* Industry comparison for P/E ratio */}
            {showComparison &&
              ratio.label === 'P/E Ratio' &&
              industryBenchmarks?.industryPe && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">Industry Avg:</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {industryBenchmarks.industryPe.toFixed(2)}x
                    </span>
                  </div>
                </div>
              )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400 pt-2">
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-green-600" />
          <span>Good</span>
        </div>
        <div className="flex items-center gap-1">
          <Minus className="h-3 w-3 text-gray-500" />
          <span>Average</span>
        </div>
        <div className="flex items-center gap-1">
          <TrendingDown className="h-3 w-3 text-red-600" />
          <span>Needs Improvement</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Export display name for debugging
 */
FinancialRatiosGrid.displayName = 'FinancialRatiosGrid';
