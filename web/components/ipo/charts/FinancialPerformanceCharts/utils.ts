/**
 * Utility Functions for Financial Performance Charts
 *
 * Provides data transformation, margin calculation, and validation helpers
 * for financial chart components.
 */

import { calculateGrowth } from '@/lib/utils/chart-data';
import type {
  FinancialDataFromDB,
  FinancialChartDataWithMargins,
  DataCompletenessResult,
  GrowthTrend,
  FinancialRatioItem,
  IndustryBenchmarks,
} from './types';

/**
 * Convert Drizzle numeric string to number
 *
 * Drizzle ORM returns PostgreSQL numeric/decimal types as strings
 * to preserve precision. This helper safely converts to number.
 *
 * @param value - String value from database
 * @returns Parsed number or null if invalid
 *
 * @example
 * ```ts
 * parseNumeric("1234.56"); // Returns 1234.56
 * parseNumeric(null); // Returns null
 * parseNumeric(""); // Returns null
 * ```
 */
export function parseNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Calculate profit margin percentage
 *
 * Formula: (Profit / Revenue) × 100
 *
 * @param revenue - Revenue in crores
 * @param profit - Profit in crores
 * @returns Profit margin percentage or null if cannot calculate
 *
 * @example
 * ```ts
 * calculateProfitMargin(1000, 200); // Returns 20.0
 * calculateProfitMargin(1000, -50); // Returns -5.0 (loss)
 * calculateProfitMargin(0, 100); // Returns null (division by zero)
 * calculateProfitMargin(null, 100); // Returns null
 * ```
 */
export function calculateProfitMargin(
  revenue: number | null,
  profit: number | null
): number | null {
  if (revenue === null || profit === null || revenue === 0) return null;
  return (profit / revenue) * 100;
}

/**
 * Calculate EBITDA margin percentage
 *
 * Formula: (EBITDA / Revenue) × 100
 *
 * @param revenue - Revenue in crores
 * @param ebitda - EBITDA in crores
 * @returns EBITDA margin percentage or null if cannot calculate
 *
 * @example
 * ```ts
 * calculateEBITDAMargin(1000, 300); // Returns 30.0
 * calculateEBITDAMargin(1000, 0); // Returns 0.0
 * calculateEBITDAMargin(0, 300); // Returns null (division by zero)
 * ```
 */
export function calculateEBITDAMargin(
  revenue: number | null,
  ebitda: number | null
): number | null {
  if (revenue === null || ebitda === null || revenue === 0) return null;
  return (ebitda / revenue) * 100;
}

/**
 * Transform financial data with calculated margins and growth rates
 *
 * Converts database financial data (wide format) to chart-ready data
 * (long format) with calculated margins and YoY growth percentages.
 *
 * @param data - Financial data from database
 * @returns Array of financial data points with margins and growth
 *
 * @example
 * ```ts
 * const data = {
 *   revenueFy2022: "1000", revenueFy2023: "1500", revenueFy2024: "2000",
 *   profitFy2022: "200", profitFy2023: "300", profitFy2024: "400",
 *   ebitdaFy2022: "300", ebitdaFy2023: "450", ebitdaFy2024: "600",
 * };
 *
 * const chartData = transformFinancialDataWithMargins(data);
 * // Returns: [
 * //   {
 * //     year: 'FY2022',
 * //     revenue: 1000, profit: 200, ebitda: 300,
 * //     profitMargin: 20.0, ebitdaMargin: 30.0,
 * //     revenueGrowth: null, // No previous year
 * //   },
 * //   {
 * //     year: 'FY2023',
 * //     revenue: 1500, profit: 300, ebitda: 450,
 * //     profitMargin: 20.0, ebitdaMargin: 30.0,
 * //     revenueGrowth: 50.0, // (1500-1000)/1000 * 100
 * //   },
 * //   ...
 * // ]
 * ```
 */
export function transformFinancialDataWithMargins(
  data: FinancialDataFromDB | null
): FinancialChartDataWithMargins[] {
  if (!data) return [];

  // Parse all numeric values
  const revenue2022 = parseNumeric(data.revenueFy2022);
  const revenue2023 = parseNumeric(data.revenueFy2023);
  const revenue2024 = parseNumeric(data.revenueFy2024);

  const profit2022 = parseNumeric(data.profitFy2022);
  const profit2023 = parseNumeric(data.profitFy2023);
  const profit2024 = parseNumeric(data.profitFy2024);

  const ebitda2022 = parseNumeric(data.ebitdaFy2022);
  const ebitda2023 = parseNumeric(data.ebitdaFy2023);
  const ebitda2024 = parseNumeric(data.ebitdaFy2024);

  const totalIncome2022 = parseNumeric(data.totalIncomeFy2022);
  const totalIncome2023 = parseNumeric(data.totalIncomeFy2023);
  const totalIncome2024 = parseNumeric(data.totalIncomeFy2024);

  const years: FinancialChartDataWithMargins[] = [];

  // FY2022
  if (
    revenue2022 !== null ||
    profit2022 !== null ||
    ebitda2022 !== null ||
    totalIncome2022 !== null
  ) {
    years.push({
      year: 'FY2022',
      revenue: revenue2022,
      profit: profit2022,
      ebitda: ebitda2022,
      totalIncome: totalIncome2022,
      profitMargin: calculateProfitMargin(revenue2022, profit2022),
      ebitdaMargin: calculateEBITDAMargin(revenue2022, ebitda2022),
      revenueGrowth: null, // No previous year
      profitGrowth: null,
      ebitdaGrowth: null,
    });
  }

  // FY2023
  if (
    revenue2023 !== null ||
    profit2023 !== null ||
    ebitda2023 !== null ||
    totalIncome2023 !== null
  ) {
    years.push({
      year: 'FY2023',
      revenue: revenue2023,
      profit: profit2023,
      ebitda: ebitda2023,
      totalIncome: totalIncome2023,
      profitMargin: calculateProfitMargin(revenue2023, profit2023),
      ebitdaMargin: calculateEBITDAMargin(revenue2023, ebitda2023),
      revenueGrowth: calculateGrowth(revenue2022, revenue2023),
      profitGrowth: calculateGrowth(profit2022, profit2023),
      ebitdaGrowth: calculateGrowth(ebitda2022, ebitda2023),
    });
  }

  // FY2024
  if (
    revenue2024 !== null ||
    profit2024 !== null ||
    ebitda2024 !== null ||
    totalIncome2024 !== null
  ) {
    years.push({
      year: 'FY2024',
      revenue: revenue2024,
      profit: profit2024,
      ebitda: ebitda2024,
      totalIncome: totalIncome2024,
      profitMargin: calculateProfitMargin(revenue2024, profit2024),
      ebitdaMargin: calculateEBITDAMargin(revenue2024, ebitda2024),
      revenueGrowth: calculateGrowth(revenue2023, revenue2024),
      profitGrowth: calculateGrowth(profit2023, profit2024),
      ebitdaGrowth: calculateGrowth(ebitda2023, ebitda2024),
    });
  }

  return years;
}

/**
 * Calculate data completeness percentage
 *
 * Checks how many of the core financial fields have data.
 * Returns percentage (0-100) and list of missing fields.
 *
 * @param data - Financial data from database
 * @returns Data completeness result with percentage and missing fields
 *
 * @example
 * ```ts
 * const result = calculateDataCompleteness(financialData);
 * // Returns: {
 * //   percentage: 67,
 * //   filledFields: 6,
 * //   totalFields: 9,
 * //   missingFields: ['ebitdaFy2022', 'ebitdaFy2023', 'ebitdaFy2024']
 * // }
 * ```
 */
export function calculateDataCompleteness(
  data: FinancialDataFromDB | null
): DataCompletenessResult {
  if (!data) {
    return {
      percentage: 0,
      filledFields: 0,
      totalFields: 9,
      missingFields: [
        'revenueFy2022', 'revenueFy2023', 'revenueFy2024',
        'profitFy2022', 'profitFy2023', 'profitFy2024',
        'ebitdaFy2022', 'ebitdaFy2023', 'ebitdaFy2024',
      ],
    };
  }

  // Top-line completeness counts revenue OR total income (#54): the compact
  // Chittorgarh source carries "Total Income" but not "Revenue from operations",
  // so counting only revenue under-reports ~132 IPOs as "No revenue data".
  const topLine = (rev: string | null | undefined, inc: string | null | undefined) =>
    rev !== null && rev !== undefined && rev !== '' ? rev : inc;
  const fields = [
    { name: 'revenueFy2022', value: topLine(data.revenueFy2022, data.totalIncomeFy2022) },
    { name: 'revenueFy2023', value: topLine(data.revenueFy2023, data.totalIncomeFy2023) },
    { name: 'revenueFy2024', value: topLine(data.revenueFy2024, data.totalIncomeFy2024) },
    { name: 'profitFy2022', value: data.profitFy2022 },
    { name: 'profitFy2023', value: data.profitFy2023 },
    { name: 'profitFy2024', value: data.profitFy2024 },
    { name: 'ebitdaFy2022', value: data.ebitdaFy2022 },
    { name: 'ebitdaFy2023', value: data.ebitdaFy2023 },
    { name: 'ebitdaFy2024', value: data.ebitdaFy2024 },
  ];

  const filledFields = fields.filter((f) => f.value !== null && f.value !== '').length;
  const missingFields = fields
    .filter((f) => f.value === null || f.value === '')
    .map((f) => f.name);

  return {
    percentage: Math.round((filledFields / fields.length) * 100),
    filledFields,
    totalFields: fields.length,
    missingFields,
  };
}

/**
 * Check if financial data has sufficient information to render charts
 *
 * Minimum requirement: At least 2 consecutive years of revenue OR profit data
 *
 * @param data - Financial data from database
 * @returns True if sufficient data exists, false otherwise
 *
 * @example
 * ```ts
 * // Has FY2023 and FY2024 revenue
 * hasMinimumFinancialData({ revenueFy2023: "100", revenueFy2024: "150", ... }); // true
 *
 * // Only has FY2022 revenue
 * hasMinimumFinancialData({ revenueFy2022: "100", ... }); // false
 *
 * // No data
 * hasMinimumFinancialData(null); // false
 * ```
 */
export function hasMinimumFinancialData(data: FinancialDataFromDB | null): boolean {
  if (!data) return false;

  // Count top-line years — revenue OR total income (#54). The compact Chittorgarh
  // source carries total income but not "Revenue from operations", so counting only
  // revenue wrongly gates the whole section as "Financial Performance Data Unavailable"
  // for income-only IPOs even though the charts can plot total income.
  const topLineYears = [
    parseNumeric(data.revenueFy2022) ?? parseNumeric(data.totalIncomeFy2022),
    parseNumeric(data.revenueFy2023) ?? parseNumeric(data.totalIncomeFy2023),
    parseNumeric(data.revenueFy2024) ?? parseNumeric(data.totalIncomeFy2024),
  ].filter((v) => v !== null).length;

  // Count profit years
  const profitYears = [
    parseNumeric(data.profitFy2022),
    parseNumeric(data.profitFy2023),
    parseNumeric(data.profitFy2024),
  ].filter((v) => v !== null).length;

  // Need at least 2 years of top-line OR profit data
  return topLineYears >= 2 || profitYears >= 2;
}

/**
 * Calculate growth trends for all financial metrics
 *
 * Analyzes growth patterns and determines if metrics are improving,
 * declining, or stable.
 *
 * @param data - Transformed financial data with growth rates
 * @returns Array of growth trend analyses
 *
 * @example
 * ```ts
 * const trends = calculateGrowthTrends(chartData);
 * // Returns: [
 * //   {
 * //     metric: 'Revenue',
 * //     growth2023: 50.0,
 * //     growth2024: 33.33,
 * //     averageGrowth: 41.67,
 * //     trend: 'improving'
 * //   },
 * //   ...
 * // ]
 * ```
 */
export function calculateGrowthTrends(
  data: FinancialChartDataWithMargins[]
): GrowthTrend[] {
  if (data.length < 2) return [];

  const trends: GrowthTrend[] = [];

  // Helper to determine trend direction
  const getTrendDirection = (
    growth2023: number | null,
    growth2024: number | null
  ): 'improving' | 'declining' | 'stable' => {
    if (growth2023 === null && growth2024 === null) return 'stable';
    if (growth2023 === null) return growth2024! > 0 ? 'improving' : 'declining';
    if (growth2024 === null) return growth2023 > 0 ? 'improving' : 'declining';

    // Both exist - check if growth is accelerating
    if (growth2024 > growth2023) return 'improving';
    if (growth2024 < growth2023) return 'declining';
    return 'stable';
  };

  // Helper to calculate average growth
  const getAverageGrowth = (
    growth2023: number | null,
    growth2024: number | null
  ): number | null => {
    const values = [growth2023, growth2024].filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  };

  // Revenue trend
  const revenueGrowth2023 = data.find((d) => d.year === 'FY2023')?.revenueGrowth || null;
  const revenueGrowth2024 = data.find((d) => d.year === 'FY2024')?.revenueGrowth || null;
  trends.push({
    metric: 'Revenue',
    growth2023: revenueGrowth2023,
    growth2024: revenueGrowth2024,
    averageGrowth: getAverageGrowth(revenueGrowth2023, revenueGrowth2024),
    trend: getTrendDirection(revenueGrowth2023, revenueGrowth2024),
  });

  // Profit trend
  const profitGrowth2023 = data.find((d) => d.year === 'FY2023')?.profitGrowth || null;
  const profitGrowth2024 = data.find((d) => d.year === 'FY2024')?.profitGrowth || null;
  trends.push({
    metric: 'Profit',
    growth2023: profitGrowth2023,
    growth2024: profitGrowth2024,
    averageGrowth: getAverageGrowth(profitGrowth2023, profitGrowth2024),
    trend: getTrendDirection(profitGrowth2023, profitGrowth2024),
  });

  // EBITDA trend
  const ebitdaGrowth2023 = data.find((d) => d.year === 'FY2023')?.ebitdaGrowth || null;
  const ebitdaGrowth2024 = data.find((d) => d.year === 'FY2024')?.ebitdaGrowth || null;
  trends.push({
    metric: 'EBITDA',
    growth2023: ebitdaGrowth2023,
    growth2024: ebitdaGrowth2024,
    averageGrowth: getAverageGrowth(ebitdaGrowth2023, ebitdaGrowth2024),
    trend: getTrendDirection(ebitdaGrowth2023, ebitdaGrowth2024),
  });

  return trends;
}

/**
 * Prepare financial ratios for grid display
 *
 * Converts raw ratio values into display-ready format with
 * trend indicators and color schemes.
 *
 * @param data - Financial data from database
 * @param industryBenchmarks - Optional industry benchmarks for comparison
 * @returns Array of financial ratio items for grid display
 *
 * @example
 * ```ts
 * const ratios = prepareFinancialRatios(financialData, {
 *   industryPe: 25,
 *   sectorName: 'Technology'
 * });
 * // Returns array of ratio items with formatted values and trends
 * ```
 */
export function prepareFinancialRatios(
  data: FinancialDataFromDB,
  industryBenchmarks?: IndustryBenchmarks
): FinancialRatioItem[] {
  const ratios: FinancialRatioItem[] = [];

  // ROE (Return on Equity)
  const roe = parseNumeric(data.roe);
  if (roe !== null) {
    ratios.push({
      label: 'ROE',
      value: `${roe.toFixed(2)}%`,
      rawValue: roe,
      trend: roe >= 15 ? 'up' : roe >= 10 ? 'neutral' : 'down',
      trendPercentage: null,
      description: 'Return on Equity - Profitability efficiency',
      unit: '%',
      colorScheme: roe >= 15 ? 'green' : roe >= 10 ? 'blue' : 'red',
    });
  }

  // Debt-to-Equity Ratio
  const debtToEquity = parseNumeric(data.debtToEquity);
  if (debtToEquity !== null) {
    ratios.push({
      label: 'Debt-to-Equity',
      value: `${debtToEquity.toFixed(2)}x`,
      rawValue: debtToEquity,
      trend: debtToEquity <= 1 ? 'up' : debtToEquity <= 2 ? 'neutral' : 'down',
      trendPercentage: null,
      description: 'Leverage ratio - Lower is better',
      unit: 'x',
      colorScheme: debtToEquity <= 1 ? 'green' : debtToEquity <= 2 ? 'blue' : 'red',
    });
  }

  // Current Ratio
  const currentRatio = parseNumeric(data.currentRatio);
  if (currentRatio !== null) {
    ratios.push({
      label: 'Current Ratio',
      value: `${currentRatio.toFixed(2)}x`,
      rawValue: currentRatio,
      trend: currentRatio >= 1.5 ? 'up' : currentRatio >= 1 ? 'neutral' : 'down',
      trendPercentage: null,
      description: 'Liquidity ratio - Ability to cover short-term liabilities',
      unit: 'x',
      colorScheme: currentRatio >= 1.5 ? 'green' : currentRatio >= 1 ? 'blue' : 'red',
    });
  }

  // Quick Ratio
  const quickRatio = parseNumeric(data.quickRatio);
  if (quickRatio !== null) {
    ratios.push({
      label: 'Quick Ratio',
      value: `${quickRatio.toFixed(2)}x`,
      rawValue: quickRatio,
      trend: quickRatio >= 1 ? 'up' : quickRatio >= 0.5 ? 'neutral' : 'down',
      trendPercentage: null,
      description: 'Short-term liquidity without inventory',
      unit: 'x',
      colorScheme: quickRatio >= 1 ? 'green' : quickRatio >= 0.5 ? 'blue' : 'red',
    });
  }

  // P/E Ratio (with industry comparison if available)
  const peRatio = parseNumeric(data.peRatio);
  if (peRatio !== null) {
    let trend: 'up' | 'down' | 'neutral' = 'neutral';
    let colorScheme: FinancialRatioItem['colorScheme'] = 'blue';

    if (industryBenchmarks?.industryPe) {
      const industryPe = industryBenchmarks.industryPe;
      if (peRatio < industryPe * 0.8) {
        trend = 'up'; // Undervalued
        colorScheme = 'green';
      } else if (peRatio > industryPe * 1.2) {
        trend = 'down'; // Overvalued
        colorScheme = 'red';
      }
    }

    ratios.push({
      label: 'P/E Ratio',
      value: `${peRatio.toFixed(2)}x`,
      rawValue: peRatio,
      trend,
      trendPercentage: null,
      description: industryBenchmarks?.industryPe
        ? `Industry Avg: ${industryBenchmarks.industryPe.toFixed(2)}x`
        : 'Price-to-Earnings ratio',
      unit: 'x',
      colorScheme,
    });
  }

  // RONW (Return on Net Worth)
  const ronw = parseNumeric(data.ronw);
  if (ronw !== null) {
    ratios.push({
      label: 'RONW',
      value: `${ronw.toFixed(2)}%`,
      rawValue: ronw,
      trend: ronw >= 15 ? 'up' : ronw >= 10 ? 'neutral' : 'down',
      trendPercentage: null,
      description: 'Return on Net Worth',
      unit: '%',
      colorScheme: ronw >= 15 ? 'green' : ronw >= 10 ? 'blue' : 'red',
    });
  }

  return ratios;
}

/**
 * Format revenue/profit/EBITDA for display in charts
 *
 * Formats values in crores with proper decimal precision
 *
 * @param value - Value in crores
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string
 *
 * @example
 * ```ts
 * formatFinancialValue(1234.56); // "₹1,234.56 Cr"
 * formatFinancialValue(1234.56, 0); // "₹1,235 Cr"
 * formatFinancialValue(null); // "N/A"
 * ```
 */
export function formatFinancialValue(
  value: number | null,
  decimals: number = 2
): string {
  if (value === null) return 'N/A';

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  return `₹${formatted} Cr`;
}

/**
 * Format growth percentage with color indicator
 *
 * @param value - Growth percentage
 * @returns Formatted string with +/- prefix
 *
 * @example
 * ```ts
 * formatGrowthPercentage(15.67); // "+15.67%"
 * formatGrowthPercentage(-5.23); // "-5.23%"
 * formatGrowthPercentage(0); // "0.00%"
 * formatGrowthPercentage(null); // "N/A"
 * ```
 */
export function formatGrowthPercentage(value: number | null): string {
  if (value === null) return 'N/A';

  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
