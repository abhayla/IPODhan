'use client';

/**
 * FinancialPerformanceCharts - Main Container Component
 *
 * Orchestrates all financial visualization sub-components with collapsible sections.
 * Displays revenue, profitability, EBITDA trends, and key financial ratios.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, DollarSign, PieChart } from 'lucide-react';
import type { FinancialPerformanceChartsProps, FinancialStatementView } from './types';
import {
  transformFinancialDataWithMargins,
  hasMinimumFinancialData,
  calculateDataCompleteness,
} from './utils';
import { RevenueChart } from './RevenueChart';
import { ProfitabilityChart } from './ProfitabilityChart';
import { EBITDAChart } from './EBITDAChart';
import { FinancialRatiosGrid } from './FinancialRatiosGrid';
import { ipoEmptyStateMessage } from '@/lib/utils/ipo-empty-state-copy';

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
  status,
  industryBenchmarks,
  peerData,
  statements = [],
  defaultExpanded = false,
  showAdvanced = false,
}: FinancialPerformanceChartsProps): React.ReactElement | null {
  // State for collapsible sections
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const hasCharts = hasMinimumFinancialData(financialData);

  // No data → render nothing. A full "Financial Performance Data Unavailable"
  // card is exactly the empty-state noise R17 #1 flagged; the detail page's
  // one-line "Awaiting data" strip acknowledges it once instead. The restated
  // statements table can still stand on its own when the chart series is absent.
  if (!hasCharts && statements.length === 0) {
    return null;
  }

  if (!hasCharts) {
    return (
      <section className="space-y-6" aria-label="Restated financial statements">
        <RestatedStatementsTable statements={statements} />
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
      <div className="bg-card rounded-lg border p-6">
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
            <div className="bg-card rounded-lg border p-6">
              <RevenueChart
                data={chartData}
                companyName={companyName}
                height={300}
                showGrowth={true}
              />
            </div>

            {/* Profitability Chart */}
            <div className="bg-card rounded-lg border p-6">
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
            <div className="bg-card rounded-lg border p-6">
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
            <div className="bg-card rounded-lg border p-6">
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
        <div className="bg-muted/40 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {[
                { n: chartData.length, label: 'Fiscal Years', cls: 'text-blue-600 dark:text-blue-400' },
                { n: chartData.filter((d) => d.revenue !== null).length, label: 'Revenue Points', cls: 'text-green-600 dark:text-green-400' },
                { n: chartData.filter((d) => d.ebitda !== null).length, label: 'EBITDA Points', cls: 'text-amber-600 dark:text-amber-400' },
              ]
                // Never advertise a zero — a "0 Revenue Points" chip reads as broken (R17 #1)
                .filter((s) => s.n > 0)
                .map((s, i) => (
                  <React.Fragment key={s.label}>
                    {i > 0 && <div className="h-8 w-px bg-gray-300 dark:bg-gray-600" />}
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${s.cls}`}>{s.n}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">{s.label}</div>
                    </div>
                  </React.Fragment>
                ))}
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
      <RestatedStatementsTable statements={statements} />
    </section>
  );
}

/**
 * Export display name for debugging
 */
FinancialPerformanceCharts.displayName = 'FinancialPerformanceCharts';

/**
 * Per-year restated statements exactly as the offer document reports them:
 * revenue, EBITDA, PAT, net worth, operating cash flow, basic EPS and the
 * derived RoNW, plus DSCR / rent when the extractor found them. Columns whose
 * every cell is empty are dropped rather than rendered as a wall of dashes.
 */
function RestatedStatementsTable({
  statements,
}: {
  statements: FinancialStatementView[];
}): React.ReactElement | null {
  if (!statements || statements.length === 0) return null;

  const years = [...statements].sort((a, b) => a.fiscalYear - b.fiscalYear);

  const toNumber = (v: string | null): number | null => {
    if (v === null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // Amount columns are stored in the row's own unit; show every figure in the
  // crores the rest of the page uses so years can be compared at a glance.
  const toCrore = (v: string | null, unit: string): number | null => {
    const n = toNumber(v);
    if (n === null) return null;
    if (unit === 'MILLION') return n / 10;
    if (unit === 'LAKH') return n / 100;
    return n;
  };

  const fmt = (n: number | null, suffix = ''): string =>
    n === null ? '—' : `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;

  const rows: Array<{ label: string; values: Array<number | null>; suffix?: string }> = [
    { label: 'Revenue from operations (₹ Cr)', values: years.map((y) => toCrore(y.revenue, y.unit)) },
    { label: 'Total income (₹ Cr)', values: years.map((y) => toCrore(y.totalIncome, y.unit)) },
    { label: 'EBITDA (₹ Cr)', values: years.map((y) => toCrore(y.ebitda, y.unit)) },
    { label: 'Profit after tax (₹ Cr)', values: years.map((y) => toCrore(y.pat, y.unit)) },
    { label: 'Net worth (₹ Cr)', values: years.map((y) => toCrore(y.netWorth, y.unit)) },
    {
      label: 'Operating cash flow (₹ Cr)',
      values: years.map((y) => toCrore(y.opCashFlow, y.unit)),
    },
    { label: 'Basic EPS (₹)', values: years.map((y) => toNumber(y.epsBasic)) },
    {
      label: 'RoNW (%)',
      suffix: '%',
      values: years.map((y) => {
        const pat = toNumber(y.pat);
        const nw = toNumber(y.netWorth);
        return pat === null || nw === null || nw === 0 ? null : (pat / nw) * 100;
      }),
    },
    { label: 'DSCR', values: years.map((y) => toNumber(y.dscr)) },
    { label: 'Rent expense (₹ Cr)', values: years.map((y) => toCrore(y.rentExpense, y.unit)) },
  ].filter((r) => r.values.some((v) => v !== null));

  if (rows.length === 0) return null;

  const bases = Array.from(new Set(years.map((y) => y.basis))).join(' / ');

  return (
    <div className="bg-card rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Financial statements from the offer document
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {bases === 'RESTATED'
          ? 'Restated'
          : bases === 'STANDALONE'
            ? 'Standalone'
            : bases}{' '}
        basis, as filed
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="py-3 px-4 text-left font-semibold">Metric</th>
              {years.map((y) => (
                <th key={y.fiscalYear} className="py-3 px-4 text-right font-semibold">
                  FY{y.fiscalYear}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{row.label}</td>
                {row.values.map((v, i) => (
                  <td
                    key={`${row.label}-${years[i].fiscalYear}`}
                    className="py-3 px-4 text-right font-medium"
                  >
                    {fmt(v, row.suffix ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
