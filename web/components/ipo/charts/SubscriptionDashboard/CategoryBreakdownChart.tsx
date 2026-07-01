'use client';

/**
 * CategoryBreakdownChart Component
 *
 * Displays subscription breakdown by investor category (QIB, NII, Retail)
 * using a grouped bar chart with detailed statistics
 */

import { BarChartBase } from '../base/BarChartBase';
import { formatSubscription, formatLargeNumber } from './utils';
import type { CategoryBreakdownChartProps } from './types';
import { CheckCircle, AlertCircle, Users } from 'lucide-react';

export function CategoryBreakdownChart({
  categories,
  stats,
  className,
}: CategoryBreakdownChartProps) {
  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/25 p-8 text-center">
        <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          Category breakdown not available yet
        </p>
      </div>
    );
  }

  // Prepare data for grouped bar chart
  const chartData = categories.map((cat) => ({
    category: cat.label,
    subscription: cat.subscription,
    subscriptionLabel: formatSubscription(cat.subscription),
  }));

  // Bars configuration
  const bars: any[] = [
    {
      dataKey: 'subscription',
      label: 'Subscription',
      fillColor: 'var(--chart-1)',
      fill: 'var(--chart-1)',
      radius: [4, 4, 0, 0] as [number, number, number, number],
      name: 'Subscription',
    },
  ];

  // Custom tooltip
  const customTooltip = (props: any) => {
    if (!props.active || !props.payload || props.payload.length === 0) {
      return null;
    }

    const data = props.payload[0].payload;
    const category = categories.find((c) => c.label === data.category);

    if (!category) return null;

    return (
      <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg min-w-[180px]">
        <p className="font-medium text-sm mb-2">{category.label}</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">Subscription:</span>
            <span className="font-bold">{formatSubscription(category.subscription)}</span>
          </div>
          {category.applications !== null && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground">Applications:</span>
              <span className="font-medium">{formatLargeNumber(category.applications)}</span>
            </div>
          )}
          {category.sharesOffered !== null && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground">Shares Offered:</span>
              <span className="font-medium">
                {formatLargeNumber(category.sharesOffered)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Determine subscription status for each category
  const getSubscriptionStatus = (subscription: number) => {
    if (subscription >= 1) {
      return {
        icon: CheckCircle,
        color: 'text-green-600 dark:text-green-500',
        label: 'Subscribed',
      };
    }
    return {
      icon: AlertCircle,
      color: 'text-orange-600 dark:text-orange-500',
      label: 'Under-subscribed',
    };
  };

  return (
    <div className={className}>
      {/* Category Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {categories.slice(0, 3).map((category) => {
          const status = getSubscriptionStatus(category.subscription);
          const StatusIcon = status.icon;

          return (
            <div
              key={category.category}
              className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {category.label}
                  </p>
                  <p className="text-2xl font-bold">
                    {formatSubscription(category.subscription)}
                  </p>
                </div>
                <StatusIcon className={`h-5 w-5 ${status.color}`} />
              </div>

              <div className="space-y-1.5">
                {category.applications !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Applications:</span>
                    <span className="font-medium">
                      {formatLargeNumber(category.applications)}
                    </span>
                  </div>
                )}
                {category.sharesOffered !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Shares Offered:</span>
                    <span className="font-medium">
                      {formatLargeNumber(category.sharesOffered)}
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="mt-3">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(category.subscription * 100, 100)}%`,
                      backgroundColor: category.color,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bar Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-4">Category Comparison</h4>
        <BarChartBase
          data={chartData}
          xAxisKey="category"
          bars={bars}
          height={280}
          showGrid={true}
          showLegend={false}
          enableAnimations={true}
          yAxisFormatter={(value: number) => formatSubscription(value)}
        />
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Subscription levels by investor category
        </p>
      </div>

      {/* Additional Categories (Employee, Shareholder) */}
      {categories.length > 3 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {categories.slice(3).map((category) => {
            const status = getSubscriptionStatus(category.subscription);
            const StatusIcon = status.icon;

            return (
              <div
                key={category.category}
                className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <div>
                    <p className="text-sm font-medium">{category.label}</p>
                    {category.sharesOffered && (
                      <p className="text-xs text-muted-foreground">
                        {formatLargeNumber(category.sharesOffered)} shares
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">
                    {formatSubscription(category.subscription)}
                  </span>
                  <StatusIcon className={`h-4 w-4 ${status.color}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {stats.totalApplications && (
        <div className="mt-4 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Applications</p>
              <p className="text-xl font-bold">
                {formatLargeNumber(stats.totalApplications)}
              </p>
            </div>
            <Users className="h-8 w-8 text-muted-foreground/50" />
          </div>
        </div>
      )}
    </div>
  );
}
