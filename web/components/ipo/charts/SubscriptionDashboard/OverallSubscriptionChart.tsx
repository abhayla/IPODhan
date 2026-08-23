'use client';

/**
 * OverallSubscriptionChart Component
 *
 * Displays time-series subscription data with stacked area visualization
 * showing QIB, NII, and Retail subscription trends over time
 */

import { AreaChartBase } from '../base/AreaChartBase';
import { formatSubscription } from './utils';
import type { OverallSubscriptionChartProps } from './types';
import { format } from 'date-fns';
import { TrendingUp, Calendar, BarChart } from 'lucide-react';

export function OverallSubscriptionChart({
  data,
  stats,
  closeDate,
  status,
  className,
}: OverallSubscriptionChartProps) {
  // P3-15 (T-302): "Current ... closes {date}" is present/future-tense framing
  // that is honest only while bidding is genuinely ongoing. Once the IPO has
  // CLOSED or LISTED, the window already closed — say so in the past tense
  // instead of implying it's still open.
  const isStillBidding = status !== 'CLOSED' && status !== 'LISTED';
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/25 p-8 text-center">
        <BarChart className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          No subscription data available yet
        </p>
      </div>
    );
  }

  // Prepare data for stacked area chart
  const chartData = data.map((point) => ({
    date: point.dateLabel,
    QIB: point.qibSubscription || 0,
    NII: point.niiSubscription || 0,
    Retail: point.retailSubscription || 0,
    Total: point.totalSubscription,
  }));

  // Determine which areas to show based on available data
  const hasQIB = data.some((d) => d.qibSubscription !== null && d.qibSubscription > 0);
  const hasNII = data.some((d) => d.niiSubscription !== null && d.niiSubscription > 0);
  const hasRetail = data.some(
    (d) => d.retailSubscription !== null && d.retailSubscription > 0
  );

  const areas: any[] = [];
  if (hasRetail) {
    areas.push({
      dataKey: 'Retail',
      fill: 'var(--chart-3)',
      fillOpacity: 0.08,
      stroke: 'var(--chart-3)',
      name: 'Retail',
    });
  }
  if (hasNII) {
    areas.push({
      dataKey: 'NII',
      fill: 'var(--chart-2)',
      fillOpacity: 0.08,
      stroke: 'var(--chart-2)',
      name: 'NII',
    });
  }
  if (hasQIB) {
    areas.push({
      dataKey: 'QIB',
      fill: 'var(--chart-1)',
      fillOpacity: 0.08,
      stroke: 'var(--chart-1)',
      name: 'QIB',
    });
  }

  // If no category breakdown, show total only
  if (areas.length === 0) {
    areas.push({
      dataKey: 'Total',
      fill: 'var(--chart-1)',
      fillOpacity: 0.08,
      stroke: 'var(--chart-1)',
      name: 'Total',
    });
  }

  // Custom tooltip
  const customTooltip = (props: any) => {
    if (!props.active || !props.payload || props.payload.length === 0) {
      return null;
    }

    const data = props.payload[0].payload;

    return (
      <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg">
        <p className="font-medium text-sm mb-2">{data.date}</p>
        <div className="space-y-1">
          {hasQIB && data.QIB > 0 && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-chart-1" />
                <span>QIB:</span>
              </div>
              <span className="font-medium">{formatSubscription(data.QIB)}</span>
            </div>
          )}
          {hasNII && data.NII > 0 && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-chart-2" />
                <span>NII:</span>
              </div>
              <span className="font-medium">{formatSubscription(data.NII)}</span>
            </div>
          )}
          {hasRetail && data.Retail > 0 && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-chart-3" />
                <span>Retail:</span>
              </div>
              <span className="font-medium">{formatSubscription(data.Retail)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 text-xs font-semibold border-t pt-1 mt-1">
            <span>Total:</span>
            <span>{formatSubscription(data.Total)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={className}>
      {/* Spec D4.2: the Current/Peak/Average tile trio rendered three
          near-identical numbers during a live issue and read as dummy data
          (round-8 scorer). The current multiple lives in the fact ribbon;
          the chart carries the trend. One caption line replaces the tiles. */}
      <p className="mb-4 text-xs text-muted-foreground">
        {isStillBidding ? 'Current' : 'Final'} {formatSubscription(stats.total)}
        {closeDate
          ? isStillBidding
            ? ` · closes ${format(closeDate, 'MMM dd')}`
            : ` · closed ${format(closeDate, 'MMM dd')}`
          : ''}
      </p>

      {/* Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-4">Subscription Trend Over Time</h4>
        <AreaChartBase
          data={chartData}
          xAxisKey="date"
          areas={areas}
          height={300}
          showGrid={true}
          showLegend={areas.length > 1}
          enableAnimations={true}
          yAxisFormatter={(value: number) => formatSubscription(value)}
        />
        {areas.length > 1 && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Category-wise subscription over time (1x = fully subscribed)
          </p>
        )}
      </div>
    </div>
  );
}
