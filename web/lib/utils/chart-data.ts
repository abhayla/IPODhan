/**
 * Chart Data Transformation Utilities
 *
 * Provides helper functions for transforming database data into chart-friendly formats.
 * Includes formatters, calculators, and data transformers for all chart types.
 */

import { format, parseISO } from 'date-fns';

/**
 * Financial data structure from database
 */
export interface FinancialDataRaw {
  revenue_fy2022?: number | null;
  revenue_fy2023?: number | null;
  revenue_fy2024?: number | null;
  profit_fy2022?: number | null;
  profit_fy2023?: number | null;
  profit_fy2024?: number | null;
  ebitda_fy2022?: number | null;
  ebitda_fy2023?: number | null;
  ebitda_fy2024?: number | null;
  eps_fy2022?: number | null;
  eps_fy2023?: number | null;
  eps_fy2024?: number | null;
  [key: string]: any;
}

/**
 * Subscription data structure from database
 */
export interface SubscriptionDataRaw {
  id: string;
  timestamp: Date | string;
  subscriptionQIB?: number | null;
  subscriptionNII?: number | null;
  subscriptionRetail?: number | null;
  subscriptionEmployee?: number | null;
  subscriptionOverall?: number | null;
  [key: string]: any;
}

/**
 * GMP record structure from database
 */
export interface GMPRecordRaw {
  id: string;
  timestamp: Date | string;
  gmp: number;
  expectedListingPrice?: number | null;
  [key: string]: any;
}

/**
 * Transformed financial data point
 */
export interface FinancialChartData {
  year: string;
  revenue?: number | null;
  profit?: number | null;
  ebitda?: number | null;
  eps?: number | null;
}

/**
 * Transformed subscription data point
 */
export interface SubscriptionChartData {
  time: string;
  timestamp: Date;
  qib?: number | null;
  nii?: number | null;
  retail?: number | null;
  employee?: number | null;
  overall?: number | null;
}

/**
 * Transformed GMP data point
 */
export interface GMPChartData {
  date: string;
  timestamp: Date;
  gmp: number;
  expectedListingPrice?: number | null;
}

/**
 * Transform financial data from database to chart format
 *
 * Converts wide-format financial data (FY2022, FY2023, FY2024 columns)
 * into long-format time-series data suitable for line/bar charts.
 *
 * @example
 * ```ts
 * const chartData = transformFinancialData({
 *   revenue_fy2022: 100,
 *   revenue_fy2023: 150,
 *   revenue_fy2024: 200,
 *   profit_fy2022: 20,
 *   profit_fy2023: 30,
 *   profit_fy2024: 40,
 * });
 * // Returns: [
 * //   { year: 'FY2022', revenue: 100, profit: 20 },
 * //   { year: 'FY2023', revenue: 150, profit: 30 },
 * //   { year: 'FY2024', revenue: 200, profit: 40 },
 * // ]
 * ```
 */
export function transformFinancialData(
  data: FinancialDataRaw | null | undefined
): FinancialChartData[] {
  if (!data) return [];

  const years: FinancialChartData[] = [];

  // FY2022
  if (
    data.revenue_fy2022 !== null ||
    data.profit_fy2022 !== null ||
    data.ebitda_fy2022 !== null ||
    data.eps_fy2022 !== null
  ) {
    years.push({
      year: 'FY2022',
      revenue: data.revenue_fy2022,
      profit: data.profit_fy2022,
      ebitda: data.ebitda_fy2022,
      eps: data.eps_fy2022,
    });
  }

  // FY2023
  if (
    data.revenue_fy2023 !== null ||
    data.profit_fy2023 !== null ||
    data.ebitda_fy2023 !== null ||
    data.eps_fy2023 !== null
  ) {
    years.push({
      year: 'FY2023',
      revenue: data.revenue_fy2023,
      profit: data.profit_fy2023,
      ebitda: data.ebitda_fy2023,
      eps: data.eps_fy2023,
    });
  }

  // FY2024
  if (
    data.revenue_fy2024 !== null ||
    data.profit_fy2024 !== null ||
    data.ebitda_fy2024 !== null ||
    data.eps_fy2024 !== null
  ) {
    years.push({
      year: 'FY2024',
      revenue: data.revenue_fy2024,
      profit: data.profit_fy2024,
      ebitda: data.ebitda_fy2024,
      eps: data.eps_fy2024,
    });
  }

  return years;
}

/**
 * Transform subscription time-series data from database to chart format
 *
 * Formats subscription data with proper timestamps and friendly labels.
 *
 * @example
 * ```ts
 * const chartData = transformSubscriptionData(subscriptions);
 * // Returns data formatted for time-series charts
 * ```
 */
export function transformSubscriptionData(
  data: SubscriptionDataRaw[]
): SubscriptionChartData[] {
  if (!data || data.length === 0) return [];

  return data
    .map((record) => {
      const timestamp =
        typeof record.timestamp === 'string'
          ? parseISO(record.timestamp)
          : record.timestamp;

      return {
        time: format(timestamp, 'dd MMM HH:mm'),
        timestamp,
        qib: record.subscriptionQIB,
        nii: record.subscriptionNII,
        retail: record.subscriptionRetail,
        employee: record.subscriptionEmployee,
        overall: record.subscriptionOverall,
      };
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Transform GMP records from database to chart format
 *
 * Formats GMP historical data for line/area charts.
 *
 * @example
 * ```ts
 * const chartData = transformGMPData(gmpRecords);
 * // Returns GMP data formatted for trend charts
 * ```
 */
export function transformGMPData(data: GMPRecordRaw[]): GMPChartData[] {
  if (!data || data.length === 0) return [];

  return data
    .map((record) => {
      const timestamp =
        typeof record.timestamp === 'string'
          ? parseISO(record.timestamp)
          : record.timestamp;

      return {
        date: format(timestamp, 'dd MMM'),
        timestamp,
        gmp: record.gmp,
        expectedListingPrice: record.expectedListingPrice,
      };
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Calculate growth percentage between two values
 *
 * @example
 * ```ts
 * calculateGrowth(100, 150); // Returns 50
 * calculateGrowth(150, 100); // Returns -33.33
 * ```
 */
export function calculateGrowth(oldValue: number | null, newValue: number | null): number | null {
  if (oldValue === null || newValue === null || oldValue === 0) return null;
  return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}

/**
 * Calculate year-over-year growth trends from financial data
 *
 * Returns growth percentages for each metric.
 *
 * @example
 * ```ts
 * const trends = calculateTrends({
 *   revenue_fy2022: 100,
 *   revenue_fy2023: 150,
 *   revenue_fy2024: 200,
 * });
 * // Returns: {
 * //   revenueGrowth_2023: 50,
 * //   revenueGrowth_2024: 33.33,
 * // }
 * ```
 */
export function calculateTrends(data: FinancialDataRaw | null | undefined): Record<string, number | null> {
  if (!data) return {};

  return {
    // Revenue growth
    revenueGrowth_2023: calculateGrowth(data.revenue_fy2022 ?? null, data.revenue_fy2023 ?? null),
    revenueGrowth_2024: calculateGrowth(data.revenue_fy2023 ?? null, data.revenue_fy2024 ?? null),

    // Profit growth
    profitGrowth_2023: calculateGrowth(data.profit_fy2022 ?? null, data.profit_fy2023 ?? null),
    profitGrowth_2024: calculateGrowth(data.profit_fy2023 ?? null, data.profit_fy2024 ?? null),

    // EBITDA growth
    ebitdaGrowth_2023: calculateGrowth(data.ebitda_fy2022 ?? null, data.ebitda_fy2023 ?? null),
    ebitdaGrowth_2024: calculateGrowth(data.ebitda_fy2023 ?? null, data.ebitda_fy2024 ?? null),

    // EPS growth
    epsGrowth_2023: calculateGrowth(data.eps_fy2022 ?? null, data.eps_fy2023 ?? null),
    epsGrowth_2024: calculateGrowth(data.eps_fy2023 ?? null, data.eps_fy2024 ?? null),
  };
}

/**
 * Format currency value in Indian Rupees (Crores)
 *
 * Converts values to crores and formats with proper locale.
 *
 * @example
 * ```ts
 * formatCurrency(10000); // Returns "₹100.00 Cr"
 * formatCurrency(1500); // Returns "₹15.00 Cr"
 * formatCurrency(null); // Returns "N/A"
 * ```
 */
export function formatCurrency(
  value: number | null | undefined,
  options?: {
    /** Show "Cr" suffix (default: true) */
    showSuffix?: boolean;
    /** Number of decimal places (default: 2) */
    decimals?: number;
    /** Convert to crores (default: true, assumes value in lakhs) */
    toCrores?: boolean;
  }
): string {
  const { showSuffix = true, decimals = 2, toCrores = true } = options || {};

  if (value === null || value === undefined) return 'N/A';

  // Convert lakhs to crores if needed
  const displayValue = toCrores ? value / 100 : value;

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(displayValue);

  return showSuffix ? `₹${formatted} Cr` : `₹${formatted}`;
}

/**
 * Format percentage value
 *
 * @example
 * ```ts
 * formatPercentage(45.678); // Returns "45.68%"
 * formatPercentage(45.678, 0); // Returns "46%"
 * formatPercentage(null); // Returns "N/A"
 * ```
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 2
): string {
  if (value === null || value === undefined) return 'N/A';

  return `${value.toFixed(decimals)}%`;
}

/**
 * Format large numbers with K/M/B suffixes
 *
 * @example
 * ```ts
 * formatNumber(1500); // Returns "1.5K"
 * formatNumber(1500000); // Returns "1.5M"
 * formatNumber(1500000000); // Returns "1.5B"
 * ```
 */
export function formatNumber(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) return 'N/A';

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(decimals)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(decimals)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(decimals)}K`;
  }
  return value.toFixed(decimals);
}

/**
 * Get color based on value and thresholds
 *
 * Returns appropriate color for positive/negative/neutral values.
 *
 * @example
 * ```ts
 * getColorByValue(50); // Returns '#10b981' (green)
 * getColorByValue(-20); // Returns '#ef4444' (red)
 * getColorByValue(0); // Returns '#6b7280' (gray)
 * ```
 */
export function getColorByValue(
  value: number | null | undefined,
  thresholds?: {
    positive?: number;
    negative?: number;
  }
): string {
  const { positive = 0, negative = 0 } = thresholds || {};

  if (value === null || value === undefined) return '#6b7280'; // gray-500
  if (value > positive) return '#10b981'; // green-500
  if (value < negative) return '#ef4444'; // red-500
  return '#6b7280'; // gray-500
}

/**
 * Format date for display
 *
 * @example
 * ```ts
 * formatDate(new Date('2024-01-15')); // Returns "15 Jan 2024"
 * formatDate('2024-01-15', 'dd MMM'); // Returns "15 Jan"
 * ```
 */
export function formatDate(
  date: Date | string | null | undefined,
  dateFormat: string = 'dd MMM yyyy'
): string {
  if (!date) return 'N/A';

  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    return format(dateObj, dateFormat);
  } catch {
    return 'Invalid Date';
  }
}

/**
 * Get latest value from time-series data
 *
 * @example
 * ```ts
 * const subscriptions = [...]; // sorted by timestamp
 * const latest = getLatestValue(subscriptions, 'subscriptionOverall');
 * ```
 */
export function getLatestValue<T extends Record<string, any>>(
  data: T[],
  key: keyof T
): T[keyof T] | null {
  if (!data || data.length === 0) return null;
  return data[data.length - 1][key];
}

/**
 * Calculate average of values in array
 *
 * @example
 * ```ts
 * calculateAverage([10, 20, 30]); // Returns 20
 * calculateAverage([10, null, 30]); // Returns 20 (ignores null)
 * ```
 */
export function calculateAverage(values: (number | null)[]): number | null {
  const validValues = values.filter((v): v is number => v !== null && !isNaN(v));
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
}

/**
 * Group data by key
 *
 * @example
 * ```ts
 * const grouped = groupBy(ipos, 'status');
 * // Returns: { OPEN: [...], CLOSED: [...], LISTED: [...] }
 * ```
 */
export function groupBy<T extends Record<string, any>>(
  data: T[],
  key: keyof T
): Record<string, T[]> {
  return data.reduce((acc, item) => {
    const groupKey = String(item[key]);
    if (!acc[groupKey]) {
      acc[groupKey] = [];
    }
    acc[groupKey].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
