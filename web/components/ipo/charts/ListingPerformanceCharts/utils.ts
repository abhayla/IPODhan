/**
 * ListingPerformanceCharts Utilities
 *
 * Data transformation and calculation utilities for listing performance visualizations
 */

import { format, parseISO, differenceInDays, subDays, subMonths, subYears } from 'date-fns';
import type {
  StockPricePoint,
  PerformancePeriod,
  SectorComparison,
  ListingDayStats,
  ListingPerformanceData,
} from './types';

/**
 * Generate mock historical price data
 * NOTE: In production, this would fetch real stock price data from API
 */
export function generateHistoricalPriceData(
  listingDate: Date,
  issuePrice: number,
  listingPrice: number,
  currentPrice: number | null
): StockPricePoint[] {
  const data: StockPricePoint[] = [];
  const today = new Date();
  const daysSinceListing = differenceInDays(today, listingDate);

  // If not listed yet or less than 2 days, return empty
  if (daysSinceListing < 1) {
    return [];
  }

  // Generate data points (simplified simulation)
  // In production, this would be replaced with actual API data
  const dataPoints = Math.min(daysSinceListing, 365); // Max 1 year of data
  const priceRange = currentPrice ? currentPrice - listingPrice : 0;

  for (let i = 0; i <= dataPoints; i++) {
    const date = subDays(today, dataPoints - i);

    // Simulate price movement with some randomness
    const progress = i / dataPoints;
    const randomFactor = (Math.random() - 0.5) * 0.1; // ±10% randomness
    const trend = priceRange * progress;
    const price = listingPrice + trend + (listingPrice * randomFactor);

    data.push({
      date,
      dateLabel: format(date, 'MMM dd'),
      price: Math.max(price, issuePrice * 0.5), // Floor at 50% of issue price
      volume: Math.floor(Math.random() * 1000000) + 100000, // Random volume
    });
  }

  return data;
}

/**
 * Calculate performance periods
 */
export function calculatePerformancePeriods(
  priceData: StockPricePoint[],
  currentPrice: number | null,
  listingPrice: number
): PerformancePeriod[] {
  if (!currentPrice || priceData.length === 0) {
    return [];
  }

  const periods: PerformancePeriod[] = [];
  const today = new Date();

  // Helper to find price on specific date
  const getPriceOnDate = (daysAgo: number): number | null => {
    const targetDate = subDays(today, daysAgo);
    const point = priceData.find(
      (p) => format(p.date, 'yyyy-MM-dd') === format(targetDate, 'yyyy-MM-dd')
    );
    return point ? point.price : null;
  };

  // 1 Day
  const price1D = getPriceOnDate(1);
  if (price1D) {
    const gain = ((currentPrice - price1D) / price1D) * 100;
    periods.push({
      period: '1D',
      label: '1 Day',
      gainPercent: gain,
      absoluteGain: currentPrice - price1D,
    });
  }

  // 1 Week
  const price1W = getPriceOnDate(7);
  if (price1W) {
    const gain = ((currentPrice - price1W) / price1W) * 100;
    periods.push({
      period: '1W',
      label: '1 Week',
      gainPercent: gain,
      absoluteGain: currentPrice - price1W,
    });
  }

  // 1 Month
  const price1M = getPriceOnDate(30);
  if (price1M) {
    const gain = ((currentPrice - price1M) / price1M) * 100;
    periods.push({
      period: '1M',
      label: '1 Month',
      gainPercent: gain,
      absoluteGain: currentPrice - price1M,
    });
  }

  // 3 Months
  const price3M = getPriceOnDate(90);
  if (price3M) {
    const gain = ((currentPrice - price3M) / price3M) * 100;
    periods.push({
      period: '3M',
      label: '3 Months',
      gainPercent: gain,
      absoluteGain: currentPrice - price3M,
    });
  }

  // 6 Months
  const price6M = getPriceOnDate(180);
  if (price6M) {
    const gain = ((currentPrice - price6M) / price6M) * 100;
    periods.push({
      period: '6M',
      label: '6 Months',
      gainPercent: gain,
      absoluteGain: currentPrice - price6M,
    });
  }

  // 1 Year
  const price1Y = getPriceOnDate(365);
  if (price1Y) {
    const gain = ((currentPrice - price1Y) / price1Y) * 100;
    periods.push({
      period: '1Y',
      label: '1 Year',
      gainPercent: gain,
      absoluteGain: currentPrice - price1Y,
    });
  }

  // All Time (since listing)
  const gain = ((currentPrice - listingPrice) / listingPrice) * 100;
  periods.push({
    period: 'All',
    label: 'Since Listing',
    gainPercent: gain,
    absoluteGain: currentPrice - listingPrice,
  });

  return periods;
}

/**
 * Calculate sector comparison
 */
export function calculateSectorComparison(
  listingGainPercent: number,
  sectorAverageGain: number | null,
  sector: string | null
): SectorComparison | null {
  if (!sectorAverageGain || !sector) {
    return null;
  }

  const difference = listingGainPercent - sectorAverageGain;
  const outperformance = difference > 0;

  return {
    sector,
    ipoGain: listingGainPercent,
    sectorAverage: sectorAverageGain,
    difference,
    outperformance,
  };
}

/**
 * Calculate listing day statistics
 * NOTE: In production, this would use actual intraday trading data
 */
export function calculateListingDayStats(
  issuePrice: number,
  listingPrice: number,
  listingGainPercent: number
): ListingDayStats {
  // Simulate listing day volatility (in production, use real data)
  const volatilityFactor = 0.05; // ±5% typical listing day volatility

  const openPrice = listingPrice;
  const highPrice = listingPrice * (1 + volatilityFactor);
  const lowPrice = listingPrice * (1 - volatilityFactor / 2);
  const closePrice = listingPrice;

  return {
    openPrice,
    highPrice,
    lowPrice,
    closePrice,
    volume: null, // Would come from API
    gainPercent: listingGainPercent,
    volatility: ((highPrice - lowPrice) / openPrice) * 100,
  };
}

/**
 * Format currency (Indian Rupees)
 */
export function formatCurrency(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format percentage with sign
 */
export function formatPercent(value: number | null, includeSign: boolean = true): string {
  if (value === null) {
    return 'N/A';
  }

  const sign = includeSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format large numbers (Market Cap, Volume)
 */
export function formatLargeNumber(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  if (value >= 10000000000) {
    // 1000 Crore+
    return `₹${(value / 10000000000).toFixed(2)} K Cr`;
  }

  if (value >= 10000000) {
    // 1 Crore+
    return `₹${(value / 10000000).toFixed(2)} Cr`;
  }

  if (value >= 100000) {
    // 1 Lakh+
    return `₹${(value / 100000).toFixed(2)} L`;
  }

  return `₹${value.toLocaleString('en-IN')}`;
}

/**
 * Get gain color class
 */
export function getGainColorClass(gain: number | null): string {
  if (gain === null) {
    return 'text-muted-foreground';
  }

  if (gain > 0) {
    return 'text-green-600 dark:text-green-500';
  }

  if (gain < 0) {
    return 'text-red-600 dark:text-red-500';
  }

  return 'text-muted-foreground';
}

/**
 * Get gain background color class
 */
export function getGainBgClass(gain: number | null): string {
  if (gain === null) {
    return 'bg-muted';
  }

  if (gain > 0) {
    return 'bg-green-100 dark:bg-green-950';
  }

  if (gain < 0) {
    return 'bg-red-100 dark:bg-red-950';
  }

  return 'bg-muted';
}

/**
 * Get performance rating
 */
export function getPerformanceRating(gainPercent: number): {
  label: string;
  color: string;
  icon: string;
} {
  if (gainPercent >= 50) {
    return { label: 'Exceptional', color: 'text-green-600', icon: '🚀' };
  }
  if (gainPercent >= 20) {
    return { label: 'Strong', color: 'text-green-600', icon: '📈' };
  }
  if (gainPercent >= 0) {
    return { label: 'Positive', color: 'text-green-600', icon: '✓' };
  }
  if (gainPercent >= -20) {
    return { label: 'Negative', color: 'text-red-600', icon: '↓' };
  }
  return { label: 'Poor', color: 'text-red-600', icon: '⚠️' };
}

/**
 * Check if listing performance data is sufficient
 */
export function hasMinimumListingData(
  listingPerformance: ListingPerformanceData | null
): boolean {
  if (!listingPerformance) {
    return false;
  }

  return (
    listingPerformance.issuePrice > 0 &&
    listingPerformance.listingPrice > 0 &&
    listingPerformance.listingGainPercent !== null
  );
}
