/**
 * Utility functions for Enhanced GMP History Chart
 *
 * Handles moving average calculations, confidence bands, trend analysis,
 * and volatility computations.
 */

import { format, parseISO } from 'date-fns';
import type { GMPRecordDB, GMPChartPoint, GMPTrendAnalysis } from './types';

/**
 * Null-safe timestamp parser
 * Returns null for invalid timestamps instead of creating fallback dates
 */
function parseTimestamp(ts: Date | string | null | undefined): Date | null {
  if (!ts) return null;

  try {
    if (ts instanceof Date) {
      return isNaN(ts.getTime()) ? null : ts;
    }
    const parsed = typeof ts === 'string' ? parseISO(ts) : new Date(ts);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (error) {
    console.error('[GMPHistoryChart] Invalid timestamp:', ts, error);
    return null;
  }
}

/**
 * Transform raw GMP records into chart-ready format with analytics
 *
 * @param records - Raw GMP records from database
 * @param daysToShow - Number of days to display (default: 30)
 * @returns Processed chart data sorted by date (ascending)
 */
export function transformGMPData(
  records: GMPRecordDB[],
  daysToShow: number = 30
): GMPChartPoint[] {
  if (!records || records.length === 0) {
    return [];
  }

  // Filter out records with invalid timestamps
  const validRecords = records.filter(record => {
    const date = parseTimestamp(record.timestamp);
    return date !== null;
  });

  if (validRecords.length === 0) {
    return [];
  }

  // Sort by timestamp (ascending - oldest first)
  const sorted = [...validRecords].sort((a, b) => {
    const dateA = parseTimestamp(a.timestamp)!;
    const dateB = parseTimestamp(b.timestamp)!;
    return dateA.getTime() - dateB.getTime();
  });

  // Take last N days
  const limited = sorted.slice(-daysToShow);

  // Calculate moving averages and confidence bands
  const chartData: GMPChartPoint[] = limited.map((record, index) => {
    const timestamp = parseTimestamp(record.timestamp)!;
    const gmp = record.gmp;
    const movingAvg7 = calculateMovingAverage(limited, index, 7);
    const volatility = calculateVolatility(limited, index);

    return {
      date: format(timestamp, 'dd MMM'),
      timestamp,
      gmp,
      gmpUpper: gmp * 1.1, // illustrative +10% range — NOT a statistical confidence band
      gmpLower: gmp * 0.9, // illustrative -10% range — NOT a statistical confidence band
      movingAvg7,
      expectedListingPrice: record.expectedListingPrice,
      volatility,
    };
  });

  return chartData;
}

/**
 * Calculate simple moving average for a given window
 *
 * @param records - All records
 * @param currentIndex - Current record index
 * @param window - Window size in days
 * @returns Moving average value or null if insufficient data
 */
export function calculateMovingAverage(
  records: GMPRecordDB[],
  currentIndex: number,
  window: number
): number | null {
  if (currentIndex < window - 1) {
    return null; // Not enough data for moving average
  }

  const start = Math.max(0, currentIndex - window + 1);
  const windowRecords = records.slice(start, currentIndex + 1);
  const sum = windowRecords.reduce((acc, r) => acc + r.gmp, 0);

  return sum / windowRecords.length;
}

/**
 * Calculate daily volatility (% change from previous day)
 *
 * @param records - All records
 * @param currentIndex - Current record index
 * @returns Volatility percentage
 */
export function calculateVolatility(
  records: GMPRecordDB[],
  currentIndex: number
): number {
  if (currentIndex === 0) {
    return 0;
  }

  const current = records[currentIndex].gmp;
  const previous = records[currentIndex - 1].gmp;

  if (previous === 0) return 0;

  return ((current - previous) / previous) * 100;
}

/**
 * Analyze GMP trend over the entire period
 *
 * @param records - GMP records
 * @returns Trend analysis summary
 */
export function analyzeGMPTrend(records: GMPRecordDB[]): GMPTrendAnalysis {
  if (!records || records.length === 0) {
    return {
      trend: 'stable',
      volatility: 'low',
      avgGMP: 0,
      minGMP: 0,
      maxGMP: 0,
      latestGMP: 0,
      changePercent: 0,
      avgVolatility: 0,
    };
  }

  const sorted = [...records].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const gmpValues = sorted.map((r) => r.gmp);
  const minGMP = Math.min(...gmpValues);
  const maxGMP = Math.max(...gmpValues);
  const avgGMP = gmpValues.reduce((sum, val) => sum + val, 0) / gmpValues.length;
  const latestGMP = sorted[sorted.length - 1].gmp;
  const firstGMP = sorted[0].gmp;
  const changePercent = firstGMP !== 0 ? ((latestGMP - firstGMP) / firstGMP) * 100 : 0;

  // Calculate average volatility
  const volatilities: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const vol = calculateVolatility(sorted, i);
    volatilities.push(Math.abs(vol));
  }
  const avgVolatility = volatilities.length > 0
    ? volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length
    : 0;

  // Determine trend
  let trend: 'upward' | 'downward' | 'stable';
  if (changePercent > 5) {
    trend = 'upward';
  } else if (changePercent < -5) {
    trend = 'downward';
  } else {
    trend = 'stable';
  }

  // Determine volatility classification
  let volatility: 'high' | 'medium' | 'low';
  if (avgVolatility > 10) {
    volatility = 'high';
  } else if (avgVolatility > 5) {
    volatility = 'medium';
  } else {
    volatility = 'low';
  }

  return {
    trend,
    volatility,
    avgGMP,
    minGMP,
    maxGMP,
    latestGMP,
    changePercent,
    avgVolatility,
  };
}

/**
 * Format currency in INR
 *
 * @param value - Amount in rupees
 * @returns Formatted currency string
 */
export function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format percentage value
 *
 * @param value - Percentage value
 * @param decimals - Number of decimal places
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

/**
 * Get trend icon and color
 *
 * @param trend - Trend direction
 * @returns Object with icon name and color class
 */
export function getTrendIndicator(trend: 'upward' | 'downward' | 'stable'): {
  icon: string;
  color: string;
} {
  switch (trend) {
    case 'upward':
      return { icon: '↗', color: 'text-green-600' };
    case 'downward':
      return { icon: '↘', color: 'text-red-600' };
    default:
      return { icon: '→', color: 'text-gray-600' };
  }
}

/**
 * Get volatility indicator
 *
 * @param volatility - Volatility classification
 * @returns Object with label and color class
 */
export function getVolatilityIndicator(volatility: 'high' | 'medium' | 'low'): {
  label: string;
  color: string;
} {
  switch (volatility) {
    case 'high':
      return { label: 'High Volatility', color: 'text-red-600' };
    case 'medium':
      return { label: 'Moderate Volatility', color: 'text-yellow-600' };
    default:
      return { label: 'Low Volatility', color: 'text-green-600' };
  }
}

/**
 * Validate GMP records for required fields
 *
 * @param records - Records to validate
 * @returns True if valid, false otherwise
 */
export function validateGMPRecords(records: GMPRecordDB[]): boolean {
  if (!records || records.length === 0) return false;

  return records.every(
    (r) =>
      r.id &&
      r.ipoId &&
      r.timestamp &&
      typeof r.gmp === 'number' &&
      r.source
  );
}
