'use client';

/**
 * ProfitabilityChart Component
 *
 * Displays profitability analysis using a composed chart with:
 * - Profit amounts as bars (left Y-axis)
 * - Profit margin % as a line (right Y-axis)
 *
 * Color codes: Green for profit, Red for loss
 */

import React from 'react';
import { ComposedChartBase } from '../base/ComposedChartBase';
import { ChartContainer } from '../ChartContainer';
import type { ProfitabilityChartProps } from './types';
import { formatFinancialValue, formatGrowthPercentage } from './utils';

/**
 * ProfitabilityChart - Composed chart showing profit and margin trends
 *
 * Features:
 * - Dual Y-axis (profit amount + margin %)
 * - Bars for profit/loss by year
 * - Line for profit margin percentage
 * - Color-coded: green (profit), red (loss)
 * - Responsive design
 * - Empty state handling
 *
 * @example
 * ```tsx
 * <ProfitabilityChart
 *   data={[
 *     { year: 'FY2022', profit: 200, profitMargin: 20.0 },
 *     { year: 'FY2023', profit: 300, profitMargin: 20.0 },
 *     { year: 'FY2024', profit: -50, profitMargin: -3.3 },
 *   ]}
 *   companyName="ABC Corporation"
 *   height={300}
 *   showMargin={true}
 * />
 * ```
 */
export function ProfitabilityChart({
  data,
  companyName,
  height = 300,
  showMargin = true,
}: ProfitabilityChartProps): React.ReactElement | null {
  // Filter data to only include years with profit data
  const profitData = data.filter((d) => d.profit !== null);

  // Don't render if no profit data
  if (profitData.length === 0) {
    return (
      <ChartContainer
        title="Profitability Analysis"
        description="Profit and margin trends"
        isEmpty={true}
        emptyMessage="No profit data available for this IPO"
      />
    );
  }

  // Determine if company has losses
  const hasLosses = profitData.some((d) => d.profit !== null && d.profit < 0);

  // Custom tooltip content
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const dataPoint = payload[0].payload;
    const profit = dataPoint.profit;
    const margin = dataPoint.profitMargin;
    const growth = dataPoint.profitGrowth;

    const isProfit = profit !== null && profit >= 0;

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-2">
          {dataPoint.year}
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {isProfit ? 'Profit:' : 'Loss:'}
            </span>
            <span
              className={`text-sm font-medium ${
                isProfit
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {formatFinancialValue(Math.abs(profit), 2)}
            </span>
          </div>
          {showMargin && margin !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-gray-600 dark:text-gray-400">Margin:</span>
              <span
                className={`text-sm font-medium ${
                  margin >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {margin.toFixed(2)}%
              </span>
            </div>
          )}
          {growth !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-gray-600 dark:text-gray-400">YoY Growth:</span>
              <span
                className={`text-sm font-medium ${
                  growth >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatGrowthPercentage(growth)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Tooltip formatter for legend
  const tooltipFormatter = (value: number, name: string): [string, string] => {
    if (name === 'profit') {
      return [formatFinancialValue(Math.abs(value), 2), value >= 0 ? 'Profit' : 'Loss'];
    }
    if (name === 'profitMargin') {
      return [`${value.toFixed(2)}%`, 'Profit Margin'];
    }
    return [String(value), name];
  };

  // Y-axis formatters
  const leftAxisFormatter = (value: number): string => {
    if (Math.abs(value) >= 1000) {
      return `₹${(value / 1000).toFixed(1)}K Cr`;
    }
    return `₹${value.toFixed(0)} Cr`;
  };

  const rightAxisFormatter = (value: number): string => {
    return `${value.toFixed(0)}%`;
  };

  // Prepare chart series configuration
  const series: any[] = [
    // Profit bars
    {
      type: 'bar' as const,
      dataKey: 'profit',
      label: hasLosses ? 'Profit/Loss' : 'Profit',
      color: hasLosses ? '#10b981' : '#10b981', // emerald-500 (green)
      yAxisId: 'left' as const,
      radius: [4, 4, 0, 0] as [number, number, number, number],
    },
  ];

  // Add profit margin line if showMargin is true
  if (showMargin) {
    series.push({
      type: 'line' as const,
      dataKey: 'profitMargin',
      label: 'Profit Margin %',
      color: '#f59e0b', // amber-500 (orange)
      yAxisId: 'right' as const,
      strokeWidth: 3,
      showDots: true,
      curveType: 'monotone' as const,
    });
  }

  // Y-axes configuration
  const yAxes: any[] = [
    {
      id: 'left' as const,
      label: hasLosses ? 'Profit/Loss (₹ Cr)' : 'Profit (₹ Cr)',
      formatter: leftAxisFormatter,
      orientation: 'left' as const,
    },
  ];

  if (showMargin) {
    yAxes.push({
      id: 'right' as const,
      label: 'Margin (%)',
      formatter: rightAxisFormatter,
      orientation: 'right' as const,
    });
  }

  return (
    <ChartContainer
      title="Profitability Analysis"
      description={`${companyName} - Profit and Margin Trends${hasLosses ? ' (Has Losses)' : ' (Profitable)'}`}
    >
      <ComposedChartBase
        data={profitData}
        series={series}
        xAxisKey="year"
        xAxisLabel="Fiscal Year"
        yAxes={yAxes}
        tooltipFormatter={tooltipFormatter}
        height={height}
        showGrid={true}
        showLegend={true}
        enableAnimations={true}
        animationDuration={1500}
        margin={{ top: 10, right: 60, left: 60, bottom: 10 }}
      />
    </ChartContainer>
  );
}

/**
 * Export display name for debugging
 */
ProfitabilityChart.displayName = 'ProfitabilityChart';
