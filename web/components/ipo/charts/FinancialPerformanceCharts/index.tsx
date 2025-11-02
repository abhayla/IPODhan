'use client';

/**
 * FinancialPerformanceCharts - Main Container Component
 *
 * Orchestrates all financial visualization sub-components with collapsible sections.
 * Displays revenue, profitability, EBITDA trends, and key financial ratios.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, DollarSign, PieChart } from 'lucide-react';
import type { FinancialPerformanceChartsProps } from './types';
import {
  transformFinancialDataWithMargins,
  hasMinimumFinancialData,
  calculateDataCompleteness,
} from './utils';
import { RevenueChart } from './RevenueChart';
import { ProfitabilityChart } from './ProfitabilityChart';
import { EBITDAChart } from './EBITDAChart';
import { FinancialRatiosGrid } from './FinancialRatiosGrid';

/**
 * FinancialPerformanceCharts - Comprehensive financial visualization suite
 *
 * Features:
 * - Revenue trend analysis
 * - Profitability with margin indicators
 * - EBITDA operating performance
 * - Key financial ratios grid
 * - Collapsible sections for progressive disclosure
 * - Responsive layout
 * - Empty state handling
 * - Data completeness warnings
 *
 * @example
 * ```tsx
 * <FinancialPerformanceCharts
 *   financialData={data}
 *   companyName="ABC Corporation"
 *   industryBenchmarks={{ industryPe: 25, sectorName: 'Technology' }}
 *   defaultExpanded={false}
 *   showAdvanced={false}
 * />
 * ```
 */
export default function FinancialPerformanceCharts({
  financialData,
  companyName,
  industryBenchmarks,
  peerData,
  defaultExpanded = false,
  showAdvanced = false,
}: FinancialPerformanceChartsProps): React.ReactElement | null {
  // State for collapsible sections
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Check if we have sufficient data
  if (!hasMinimumFinancialData(financialData)) {
    return (
      <section
        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8"
        aria-labelledby="financial-performance-title"
      >
        <div className="text-center">
          <DollarSign className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
          <h2
            id="financial-performance-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2"
          >
            Financial Performance Data Unavailable
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Comprehensive financial data (revenue, profit, EBITDA trends) is not yet available for
            this IPO. Check back after the company files its prospectus.
          </p>
        </div>
      </section>
    );
  }

  // Transform data with margins and growth
  const chartData = transformFinancialDataWithMargins(financialData);

  // Calculate data completeness
  const completeness = calculateDataCompleteness(financialData);

  // Determine if we should show warning
  const showCompletenessWarning = completeness.percentage < 67;

  return (
    <section
      className="space-y-6"
      aria-labelledby="financial-performance-title"
      aria-describedby="financial-performance-description"
    >
      {/* Section Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <h2
                id="financial-performance-title"
                className="text-xl font-bold text-gray-900 dark:text-gray-100"
              >
                Financial Performance
              </h2>
            </div>
            <p
              id="financial-performance-description"
              className="text-sm text-gray-600 dark:text-gray-400 mt-2"
            >
              Comprehensive analysis of {companyName}'s financial trends across fiscal years
              FY2022-FY2024
            </p>

            {/* Data completeness indicator */}
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      completeness.percentage >= 80
                        ? 'bg-green-500'
                        : completeness.percentage >= 50
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }`}
                    style={{ width: `${completeness.percentage}%` }}
                    aria-label={`Data completeness: ${completeness.percentage}%`}
                  />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {completeness.percentage}% data available
                </span>
              </div>
              {showCompletenessWarning && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  ⚠️ Limited data
                </span>
              )}
            </div>
          </div>

          {/* Expand/Collapse Button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            aria-expanded={isExpanded}
            aria-controls="financial-charts-content"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isExpanded ? 'Hide Charts' : 'Show Charts'}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div
          id="financial-charts-content"
          className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300"
          role="region"
          aria-live="polite"
        >
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <RevenueChart
                data={chartData}
                companyName={companyName}
                height={300}
                showGrowth={true}
              />
            </div>

            {/* Profitability Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <ProfitabilityChart
                data={chartData}
                companyName={companyName}
                height={300}
                showMargin={true}
              />
            </div>
          </div>

          {/* EBITDA Chart (Full Width if data exists) */}
          {chartData.some((d) => d.ebitda !== null) && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <EBITDAChart
                data={chartData}
                companyName={companyName}
                height={300}
                showMargin={true}
              />
            </div>
          )}

          {/* Financial Ratios Grid */}
          {financialData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <FinancialRatiosGrid
                financialData={financialData}
                industryBenchmarks={industryBenchmarks}
                showComparison={!!industryBenchmarks}
              />
            </div>
          )}

          {/* Data Source Note */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <PieChart className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-1">About This Data</p>
                <p className="text-blue-700 dark:text-blue-300">
                  Financial data is sourced from the company's filed prospectus and regulatory
                  disclosures. Figures are presented in Indian Rupees (₹) Crores. YoY growth
                  percentages are calculated based on fiscal year comparisons.
                </p>
                {showCompletenessWarning && (
                  <p className="text-amber-700 dark:text-amber-300 mt-2 font-medium">
                    ⚠️ Note: Some financial data is incomplete. Missing fields:{' '}
                    {completeness.missingFields.slice(0, 3).join(', ')}
                    {completeness.missingFields.length > 3 && ` and ${completeness.missingFields.length - 3} more`}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed State Preview */}
      {!isExpanded && (
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {chartData.length}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Fiscal Years</div>
              </div>
              <div className="h-8 w-px bg-gray-300 dark:bg-gray-600" />
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {chartData.filter((d) => d.revenue !== null).length}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Revenue Points</div>
              </div>
              <div className="h-8 w-px bg-gray-300 dark:bg-gray-600" />
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {chartData.filter((d) => d.ebitda !== null).length}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">EBITDA Points</div>
              </div>
            </div>
            <button
              onClick={() => setIsExpanded(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
              aria-label="Expand financial performance charts"
            >
              View All Charts →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Export display name for debugging
 */
FinancialPerformanceCharts.displayName = 'FinancialPerformanceCharts';
