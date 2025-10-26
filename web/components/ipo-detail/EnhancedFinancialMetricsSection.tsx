/**
 * Enhanced Financial Metrics Section
 * Story 11.12: EBITDA Multi-Period View
 *
 * Displays comprehensive financial metrics with multi-year comparison including:
 * - Revenue, Profit, EBITDA, Total Income (FY2022-FY2024)
 * - Year-over-Year growth percentages
 * - Additional financial ratios (Current, Quick, Inventory Turnover)
 * - Total Borrowings
 *
 * @component
 * @param {Object} financialData - Financial data from database
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface FinancialMetrics {
  // Multi-year revenue data
  revenueFy2022: number | null;
  revenueFy2023: number | null;
  revenueFy2024: number | null;

  // Multi-year profit data
  profitFy2022: number | null;
  profitFy2023: number | null;
  profitFy2024: number | null;

  // Multi-year EBITDA data
  ebitdaFy2022: number | null;
  ebitdaFy2023: number | null;
  ebitdaFy2024: number | null;

  // Multi-year total income data
  totalIncomeFy2022: number | null;
  totalIncomeFy2023: number | null;
  totalIncomeFy2024: number | null;

  // Additional ratios
  totalBorrowings: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  inventoryTurnover: number | null;
}

interface EnhancedFinancialMetricsSectionProps {
  financialData: FinancialMetrics | null;
}

/**
 * Calculate Year-over-Year growth percentage
 */
function calculateYoYGrowth(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Format currency in ₹ Crores
 */
function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return `₹${value.toFixed(2)} Cr`;
}

/**
 * Format percentage with sign
 */
function formatPercentage(value: number | null): string {
  if (value === null) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format ratio (2 decimal places)
 */
function formatRatio(value: number | null): string {
  if (value === null) return 'N/A';
  return value.toFixed(2);
}

/**
 * Get growth indicator icon
 */
function GrowthIndicator({ growth }: { growth: number | null }) {
  if (growth === null) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
  if (growth > 0) {
    return <TrendingUp className="h-4 w-4 text-green-600" />;
  }
  if (growth < 0) {
    return <TrendingDown className="h-4 w-4 text-red-600" />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Table row component for multi-year data
 */
interface FinancialRowProps {
  label: string;
  fy2022: number | null;
  fy2023: number | null;
  fy2024: number | null;
}

function FinancialRow({ label, fy2022, fy2023, fy2024 }: FinancialRowProps) {
  const growth2023 = calculateYoYGrowth(fy2023, fy2022);
  const growth2024 = calculateYoYGrowth(fy2024, fy2023);

  return (
    <tr className="border-b last:border-0">
      <td className="py-3 px-4 font-medium">{label}</td>
      <td className="py-3 px-4 text-right">{formatCurrency(fy2022)}</td>
      <td className="py-3 px-4 text-right">{formatCurrency(fy2023)}</td>
      <td className="py-3 px-4 text-right flex items-center justify-end gap-2">
        <GrowthIndicator growth={growth2023} />
        <span className={growth2023 !== null && growth2023 > 0 ? 'text-green-600' : growth2023 !== null && growth2023 < 0 ? 'text-red-600' : ''}>
          {formatPercentage(growth2023)}
        </span>
      </td>
      <td className="py-3 px-4 text-right">{formatCurrency(fy2024)}</td>
      <td className="py-3 px-4 text-right flex items-center justify-end gap-2">
        <GrowthIndicator growth={growth2024} />
        <span className={growth2024 !== null && growth2024 > 0 ? 'text-green-600' : growth2024 !== null && growth2024 < 0 ? 'text-red-600' : ''}>
          {formatPercentage(growth2024)}
        </span>
      </td>
    </tr>
  );
}

export function EnhancedFinancialMetricsSection({ financialData }: EnhancedFinancialMetricsSectionProps) {
  // Don't render if no financial data exists
  if (!financialData) {
    return null;
  }

  // Check if we have any multi-year data to display
  const hasMultiYearData =
    financialData.revenueFy2022 !== null ||
    financialData.revenueFy2023 !== null ||
    financialData.revenueFy2024 !== null ||
    financialData.profitFy2022 !== null ||
    financialData.profitFy2023 !== null ||
    financialData.profitFy2024 !== null ||
    financialData.ebitdaFy2022 !== null ||
    financialData.ebitdaFy2023 !== null ||
    financialData.ebitdaFy2024 !== null ||
    financialData.totalIncomeFy2022 !== null ||
    financialData.totalIncomeFy2023 !== null ||
    financialData.totalIncomeFy2024 !== null;

  const hasAdditionalRatios =
    financialData.totalBorrowings !== null ||
    financialData.currentRatio !== null ||
    financialData.quickRatio !== null ||
    financialData.inventoryTurnover !== null;

  // Don't render if no data available
  if (!hasMultiYearData && !hasAdditionalRatios) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enhanced Financial Metrics</CardTitle>
        <p className="text-sm text-muted-foreground">
          Multi-year financial comparison with EBITDA and key performance ratios
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Multi-Year Comparison Table */}
          {hasMultiYearData && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="py-3 px-4 text-left font-semibold">Metric</th>
                    <th className="py-3 px-4 text-right font-semibold">FY2022</th>
                    <th className="py-3 px-4 text-right font-semibold">FY2023</th>
                    <th className="py-3 px-4 text-right font-semibold">YoY Growth</th>
                    <th className="py-3 px-4 text-right font-semibold">FY2024</th>
                    <th className="py-3 px-4 text-right font-semibold">YoY Growth</th>
                  </tr>
                </thead>
                <tbody>
                  <FinancialRow
                    label="Revenue"
                    fy2022={financialData.revenueFy2022}
                    fy2023={financialData.revenueFy2023}
                    fy2024={financialData.revenueFy2024}
                  />
                  <FinancialRow
                    label="Profit"
                    fy2022={financialData.profitFy2022}
                    fy2023={financialData.profitFy2023}
                    fy2024={financialData.profitFy2024}
                  />
                  <FinancialRow
                    label="EBITDA"
                    fy2022={financialData.ebitdaFy2022}
                    fy2023={financialData.ebitdaFy2023}
                    fy2024={financialData.ebitdaFy2024}
                  />
                  <FinancialRow
                    label="Total Income"
                    fy2022={financialData.totalIncomeFy2022}
                    fy2023={financialData.totalIncomeFy2023}
                    fy2024={financialData.totalIncomeFy2024}
                  />
                </tbody>
              </table>
            </div>
          )}

          {/* Additional Financial Ratios */}
          {hasAdditionalRatios && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Additional Financial Ratios</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {financialData.totalBorrowings !== null && (
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-1">Total Borrowings</p>
                    <p className="text-xl font-bold">{formatCurrency(financialData.totalBorrowings)}</p>
                  </div>
                )}
                {financialData.currentRatio !== null && (
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-1">Current Ratio</p>
                    <p className="text-xl font-bold">{formatRatio(financialData.currentRatio)}</p>
                  </div>
                )}
                {financialData.quickRatio !== null && (
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-1">Quick Ratio</p>
                    <p className="text-xl font-bold">{formatRatio(financialData.quickRatio)}</p>
                  </div>
                )}
                {financialData.inventoryTurnover !== null && (
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-1">Inventory Turnover</p>
                    <p className="text-xl font-bold">{formatRatio(financialData.inventoryTurnover)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Information Note */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> All amounts are in ₹ Crores. YoY Growth = Year-over-Year Growth Percentage.
              Financial data sourced from company filings and regulatory disclosures.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
