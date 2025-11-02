'use client';

/**
 * RevenueChart Component
 *
 * Displays revenue trend across fiscal years (FY2022-FY2024) using a line chart.
 * Shows YoY growth percentages in tooltips.
 */

import React from 'react';
import { LineChartBase } from '../base/LineChartBase';
import { ChartContainer } from '../ChartContainer';
import type { RevenueChartProps } from './types';
import { formatFinancialValue, formatGrowthPercentage } from './utils';

/**
 * RevenueChart - Line chart showing revenue trends
 *
 * Features:
 * - 3-year revenue trend (FY2022-FY2024)
 * - YoY growth annotations in tooltips
 * - Indian currency formatting (₹ Crores)
 * - Responsive design
 * - Empty state handling
 *
 * @example
 * ```tsx
 * <RevenueChart
 *   data={[
 *     { year: 'FY2022', revenue: 1000, revenueGrowth: null },
 *     { year: 'FY2023', revenue: 1500, revenueGrowth: 50.0 },
 *     { year: 'FY2024', revenue: 2000, revenueGrowth: 33.33 },
 *   ]}
 *   companyName="ABC Corporation"
 *   height={300}
 *   showGrowth={true}
 * />
 * ```
 */
export function RevenueChart({
  data,
  companyName,
  height = 300,
  showGrowth = true,
}: RevenueChartProps): React.ReactElement | null {
  // Filter data to only include years with revenue
  const revenueData = data.filter((d) => d.revenue !== null);

  // Don't render if no revenue data
  if (revenueData.length === 0) {
    return (
      <ChartContainer
        title="Revenue Trend"
        description="Fiscal year revenue analysis"
        isEmpty={true}
        emptyMessage="No revenue data available for this IPO"
      />
    );
  }

  // Custom tooltip formatter with YoY growth
  const tooltipFormatter = (value: number, name: string): [string, string] => {
    if (name === 'revenue') {
      return [formatFinancialValue(value, 2), 'Revenue'];
    }
    return [String(value), name];
  };

  // Custom tooltip content to show growth
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const dataPoint = payload[0].payload;
    const revenue = dataPoint.revenue;
    const growth = dataPoint.revenueGrowth;

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-2">
          {dataPoint.year}
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-gray-600 dark:text-gray-400">Revenue:</span>
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
              {formatFinancialValue(revenue, 2)}
            </span>
          </div>
          {showGrowth && growth !== null && (
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
          {showGrowth && growth === null && dataPoint.year === 'FY2022' && (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">
              Baseline year
            </div>
          )}
        </div>
      </div>
    );
  };

  // Y-axis formatter for crores
  const yAxisFormatter = (value: number): string => {
    if (value >= 1000) {
      return `₹${(value / 1000).toFixed(1)}K Cr`;
    }
    return `₹${value.toFixed(0)} Cr`;
  };

  return (
    <ChartContainer
      title="Revenue Trend"
      description={`${companyName} - Fiscal Year Revenue Analysis (${revenueData.length} Year${revenueData.length > 1 ? 's' : ''})`}
    >
      <LineChartBase
        data={revenueData}
        lines={[
          {
            dataKey: 'revenue',
            label: 'Revenue',
            color: '#3b82f6', // blue-500
            strokeWidth: 3,
            showDots: true,
            dotRadius: 6,
            curveType: 'monotone',
          },
        ]}
        xAxisKey="year"
        xAxisLabel="Fiscal Year"
        yAxisLabel="Revenue (₹ Crores)"
        yAxisFormatter={yAxisFormatter}
        tooltipFormatter={tooltipFormatter}
        height={height}
        showGrid={true}
        showLegend={false}
        enableAnimations={true}
        animationDuration={1500}
        margin={{ top: 10, right: 30, left: 60, bottom: 10 }}
      />
      {/* Render custom tooltip */}
      <style jsx global>{`
        .recharts-tooltip-wrapper {
          z-index: 50;
        }
      `}</style>
    </ChartContainer>
  );
}

/**
 * Export display name for debugging
 */
RevenueChart.displayName = 'RevenueChart';
