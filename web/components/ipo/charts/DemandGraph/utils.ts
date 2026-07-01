/**
 * Utility functions for IPO Demand Graph data transformation
 *
 * Handles price bucket processing, normalization, and summary statistics
 */

import type { IPODemandRecord, DemandChartData, DemandSummary } from './types';

/**
 * Transform raw demand records into chart-ready format
 *
 * @param records - Raw demand records from database
 * @param exchange - Filter by exchange ('NSE' | 'BSE' | 'BOTH')
 * @param topN - Limit to top N buckets by demand (0 = all buckets)
 * @returns Processed chart data sorted by price (descending)
 */
export function transformDemandData(
  records: IPODemandRecord[],
  exchange: 'NSE' | 'BSE' | 'BOTH' = 'BOTH',
  topN: number = 0
): DemandChartData[] {
  if (!records || records.length === 0) {
    return [];
  }

  // Filter by exchange
  const filtered = records.filter((r) => {
    if (exchange === 'BOTH') return true;
    return r.exchange === exchange;
  });

  if (filtered.length === 0) {
    return [];
  }

  // Find max demand for normalization
  const maxDemand = Math.max(...filtered.map((r) => r.cumulativeQuantity));

  // Transform to chart format
  let chartData: DemandChartData[] = filtered.map((record) => ({
    priceLabel: record.isCutOff
      ? 'Cut-Off'
      : `₹${record.pricePoint?.toFixed(0) || '0'}`,
    pricePoint: record.pricePoint,
    cumulativeQuantity: record.cumulativeQuantity,
    demandIntensity: maxDemand > 0 ? (record.cumulativeQuantity / maxDemand) * 100 : 0,
    isCutOff: record.isCutOff,
    exchange: record.exchange,
  }));

  // Sort by price (descending) - Cut-Off goes first
  chartData.sort((a, b) => {
    if (a.isCutOff) return -1;
    if (b.isCutOff) return 1;
    return (b.pricePoint || 0) - (a.pricePoint || 0);
  });

  // Limit to top N if specified
  if (topN > 0 && chartData.length > topN) {
    chartData = chartData.slice(0, topN);
  }

  return chartData;
}

/**
 * Calculate summary statistics from demand records
 *
 * @param records - Raw demand records
 * @param exchange - Filter by exchange
 * @returns Summary statistics
 */
export function calculateDemandSummary(
  records: IPODemandRecord[],
  exchange: 'NSE' | 'BSE' | 'BOTH' = 'BOTH'
): DemandSummary {
  const filtered = records.filter((r) => {
    if (exchange === 'BOTH') return true;
    return r.exchange === exchange;
  });

  if (filtered.length === 0) {
    return {
      totalBuckets: 0,
      maxDemand: 0,
      cutOffDemand: null,
      mostDemandedPrice: null,
      avgDemandPerBucket: 0,
    };
  }

  const cutOffRecord = filtered.find((r) => r.isCutOff);
  const priceRecords = filtered.filter((r) => !r.isCutOff);

  const maxDemandRecord = priceRecords.reduce((max, r) =>
    r.cumulativeQuantity > max.cumulativeQuantity ? r : max
  , priceRecords[0]);

  const totalDemand = filtered.reduce((sum, r) => sum + r.cumulativeQuantity, 0);

  return {
    totalBuckets: filtered.length,
    maxDemand: maxDemandRecord?.cumulativeQuantity || 0,
    cutOffDemand: cutOffRecord?.cumulativeQuantity || null,
    mostDemandedPrice: maxDemandRecord?.pricePoint || null,
    avgDemandPerBucket: filtered.length > 0 ? totalDemand / filtered.length : 0,
  };
}

/**
 * Format large numbers with K/L/Cr suffixes
 *
 * @param value - Number to format
 * @returns Formatted string (e.g., "12.5 Cr")
 */
export function formatDemandQuantity(value: number): string {
  if (value >= 10000000) {
    // 1 Crore
    return `${(value / 10000000).toFixed(2)} Cr`;
  } else if (value >= 100000) {
    // 1 Lakh
    return `${(value / 100000).toFixed(2)} L`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} K`;
  }
  return value.toFixed(0);
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
 * Get color based on demand intensity
 *
 * @param intensity - Demand intensity (0-100)
 * @returns Tailwind color class
 */
export function getDemandColor(intensity: number): string {
  if (intensity >= 80) return 'var(--chart-1)'; // High demand - primary blue
  if (intensity >= 60) return 'var(--chart-2)'; // Medium-high - green
  if (intensity >= 40) return 'var(--chart-3)'; // Medium - yellow
  if (intensity >= 20) return 'var(--chart-4)'; // Low-medium - orange
  return 'var(--chart-5)'; // Low - red
}

/**
 * Validate demand records for required fields
 *
 * @param records - Records to validate
 * @returns True if valid, false otherwise
 */
export function validateDemandRecords(records: IPODemandRecord[]): boolean {
  if (!records || records.length === 0) return false;

  return records.every(
    (r) =>
      r.id &&
      r.ipoId &&
      (r.pricePoint !== null || r.isCutOff) &&
      typeof r.cumulativeQuantity === 'number' &&
      r.exchange
  );
}
