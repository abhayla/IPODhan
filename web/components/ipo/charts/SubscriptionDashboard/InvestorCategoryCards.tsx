'use client';

/**
 * InvestorCategoryCards Component
 *
 * Displays category-wise subscription cards with mini sparkline trends
 * Shows QIB, NII, Retail, and other categories with visual indicators
 */

import { LineChartBase } from '../base/LineChartBase';
import { formatSubscription, getCategoryTrend } from './utils';
import type { InvestorCategoryCardsProps } from './types';
import { HiArrowTrendingUp, HiArrowTrendingDown, HiMinus } from 'react-icons/hi2';

export function InvestorCategoryCards({
  categories,
  subscriptions,
  className,
}: InvestorCategoryCardsProps) {
  if (categories.length === 0) {
    return null;
  }

  /**
   * Get trend direction based on last 2 data points
   */
  const getTrendDirection = (
    categoryKey: 'qib' | 'nii' | 'retail' | 'employee' | 'shareholder'
  ): 'up' | 'down' | 'neutral' => {
    const trend = getCategoryTrend(subscriptions, categoryKey);

    if (trend.length < 2) {
      return 'neutral';
    }

    const lastValue = trend[trend.length - 1].value;
    const secondLastValue = trend[trend.length - 2].value;

    if (lastValue > secondLastValue) {
      return 'up';
    }
    if (lastValue < secondLastValue) {
      return 'down';
    }
    return 'neutral';
  };

  /**
   * Get trend icon component
   */
  const getTrendIcon = (direction: 'up' | 'down' | 'neutral') => {
    switch (direction) {
      case 'up':
        return HiArrowTrendingUp;
      case 'down':
        return HiArrowTrendingDown;
      default:
        return HiMinus;
    }
  };

  /**
   * Get trend color
   */
  const getTrendColor = (direction: 'up' | 'down' | 'neutral'): string => {
    switch (direction) {
      case 'up':
        return 'text-green-600 dark:text-green-500';
      case 'down':
        return 'text-red-600 dark:text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  /**
   * Map category to trend key
   */
  const getCategoryKey = (
    categoryName: string
  ): 'qib' | 'nii' | 'retail' | 'employee' | 'shareholder' | null => {
    const normalized = categoryName.toLowerCase();
    if (normalized.includes('qib')) return 'qib';
    if (normalized.includes('nii')) return 'nii';
    if (normalized.includes('retail')) return 'retail';
    if (normalized.includes('employee')) return 'employee';
    if (normalized.includes('shareholder')) return 'shareholder';
    return null;
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category) => {
          const categoryKey = getCategoryKey(category.category);
          const trendData = categoryKey
            ? getCategoryTrend(subscriptions, categoryKey)
            : [];
          const trendDirection = categoryKey
            ? getTrendDirection(categoryKey)
            : 'neutral';
          const TrendIcon = getTrendIcon(trendDirection);
          const trendColor = getTrendColor(trendDirection);

          // Prepare sparkline data
          const sparklineData = trendData.map((point, index) => ({
            index,
            value: point.value,
          }));

          return (
            <div
              key={category.category}
              className="rounded-lg border bg-card p-4 hover:shadow-md transition-all"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    <p className="text-xs font-medium text-muted-foreground">
                      {category.label}
                    </p>
                  </div>
                  <p className="text-2xl font-bold">
                    {formatSubscription(category.subscription)}
                  </p>
                </div>
                <TrendIcon className={`h-5 w-5 ${trendColor}`} />
              </div>

              {/* Statistics */}
              <div className="space-y-1.5 mb-3">
                {category.applications !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Applications:</span>
                    <span className="font-medium">
                      {category.applications >= 100000
                        ? `${(category.applications / 100000).toFixed(2)} L`
                        : category.applications.toLocaleString()}
                    </span>
                  </div>
                )}
                {category.sharesOffered !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Shares Offered:</span>
                    <span className="font-medium">
                      {category.sharesOffered >= 100000
                        ? `${(category.sharesOffered / 100000).toFixed(2)} L`
                        : category.sharesOffered.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Mini Sparkline */}
              {sparklineData.length >= 2 && (
                <div className="h-12 mt-2">
                  <LineChartBase
                    data={sparklineData}
                    xAxisKey="index"
                    lines={[
                      {
                        dataKey: 'value',
                        label: category.label,
                        color: category.color,
                        strokeWidth: 2,
                        name: category.label,
                      },
                    ] as any}
                    height={48}
                    showGrid={false}
                    showLegend={false}
                    enableAnimations={true}
                  />
                </div>
              )}

              {sparklineData.length < 2 && (
                <div className="h-12 mt-2 flex items-center justify-center border border-dashed border-muted-foreground/25 rounded">
                  <p className="text-xs text-muted-foreground">
                    Insufficient data for trend
                  </p>
                </div>
              )}

              {/* Subscription Status Badge */}
              <div className="mt-3 pt-3 border-t">
                {category.subscription >= 1 ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 text-xs font-medium">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-600 dark:bg-green-500" />
                    Subscribed
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 text-xs font-medium">
                    <div className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-500" />
                    Under-subscribed
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
