'use client';

/**
 * EBITDAChart Component
 *
 * Displays EBITDA (Earnings Before Interest, Tax, Depreciation, and Amortization)
 * trend across fiscal years with margin percentage indicators.
 */

import React from 'react';
import { LineChartBase } from '../base/LineChartBase';
import { ChartContainer } from '../ChartContainer';
import type { EBITDAChartProps } from './types';
import { formatFinancialValue, formatGrowthPercentage } from './utils';

/**
 * EBITDAChart - Line chart showing EBITDA trends with margin indicators
 *
 * Features:
 * - 3-year EBITDA trend (FY2022-FY2024)
 * - EBITDA margin % annotations
 * - YoY growth percentages in tooltips
 * - Indian currency formatting (₹ Crores)
 * - Responsive design
 * - Empty state handling
 *
 * @example
 * ```tsx
 * <EBITDAChart
 *   data={[
 *     { year: 'FY2022', ebitda: 300, ebitdaMargin: 30.0 },
 *     { year: 'FY2023', ebitda: 450, ebitdaMargin: 30.0 },
 *     { year: 'FY2024', ebitda: 600, ebitdaMargin: 30.0 },
 *   ]}
 *   companyName="ABC Corporation"
 *   height={300}
 *   showMargin={true}
 * />
 * ```
 */
export function EBITDAChart({
  data,
  companyName,
  height = 300,
  showMargin = true,
}: EBITDAChartProps): React.ReactElement | null {
  // Filter data to only include years with EBITDA
  const ebitdaData = data.filter((d) => d.ebitda !== null);

  // Don't render if no EBITDA data
  if (ebitdaData.length === 0) {
    return (
      <ChartContainer
        title="EBITDA Trend"
        description="Operating performance analysis"
        isEmpty={true}
        emptyMessage="No EBITDA data available for this IPO"
      />
    );
  }

  // Custom tooltip content with margin
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const dataPoint = payload[0].payload;
    const ebitda = dataPoint.ebitda;
    const margin = dataPoint.ebitdaMargin;
    const growth = dataPoint.ebitdaGrowth;

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-2">
          {dataPoint.year}
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-gray-600 dark:text-gray-400">EBITDA:</span>
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {formatFinancialValue(ebitda, 2)}
            </span>
          </div>
          {showMargin && margin !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-gray-600 dark:text-gray-400">Margin:</span>
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
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
          {growth === null && dataPoint.year === 'FY2022' && (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">
              Baseline year
            </div>
          )}
        </div>
      </div>
    );
  };

  // Tooltip formatter for legend
  const tooltipFormatter = (value: number, name: string): [string, string] => {
    if (name === 'ebitda') {
      return [formatFinancialValue(value, 2), 'EBITDA'];
    }
    return [String(value), name];
  };

  // Y-axis formatter for crores
  const yAxisFormatter = (value: number): string => {
    if (value >= 1000) {
      return `₹${(value / 1000).toFixed(1)}K Cr`;
    }
    return `₹${value.toFixed(0)} Cr`;
  };

  // Calculate average margin for badge
  const avgMargin = ebitdaData.reduce((sum, d) => {
    return sum + (d.ebitdaMargin || 0);
  }, 0) / ebitdaData.length;

  return (
    <ChartContainer
      title="EBITDA Trend"
      description={`${companyName} - Operating Performance Analysis${showMargin && avgMargin > 0 ? ` (Avg Margin: ${avgMargin.toFixed(1)}%)` : ``}`}
    >
      <LineChartBase
        data={ebitdaData}
        lines={[
          {
            dataKey: 'ebitda',
            label: 'EBITDA',
            color: '#f59e0b', // amber-500 (orange)
            strokeWidth: 3,
            showDots: true,
            dotRadius: 6,
            curveType: 'monotone',
          },
        ]}
        xAxisKey="year"
        xAxisLabel="Fiscal Year"
        yAxisLabel="EBITDA (₹ Crores)"
        yAxisFormatter={yAxisFormatter}
        tooltipFormatter={tooltipFormatter}
        height={height}
        showGrid={true}
        showLegend={false}
        enableAnimations={true}
        animationDuration={1500}
        margin={{ top: 10, right: 30, left: 60, bottom: 10 }}
      />
    </ChartContainer>
  );
}

/**
 * Export display name for debugging
 */
EBITDAChart.displayName = 'EBITDAChart';
