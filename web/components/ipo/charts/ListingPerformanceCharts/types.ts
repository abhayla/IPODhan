/**
 * ListingPerformanceCharts Types
 *
 * Type definitions for post-listing stock performance visualization components
 */

/**
 * Listing performance data from database
 */
export interface ListingPerformanceData {
  issuePrice: number;
  listingPrice: number;
  listingGainPercent: number;
  currentPrice?: number | null;
  currentGainPercent?: number | null;
  weekHigh52?: number | null;
  weekLow52?: number | null;
  marketCap?: number | null;
  volume?: number | null;
}

/**
 * Historical stock price data point
 */
export interface StockPricePoint {
  date: Date;
  dateLabel: string;
  price: number;
  volume?: number | null;
  dayChange?: number | null;
}

/**
 * Performance period metrics
 */
export interface PerformancePeriod {
  period: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'All';
  label: string;
  gainPercent: number | null;
  absoluteGain: number | null;
}

/**
 * Sector comparison data
 */
export interface SectorComparison {
  sector: string;
  ipoGain: number;
  sectorAverage: number;
  difference: number;
  outperformance: boolean;
}

/**
 * Listing day statistics
 */
export interface ListingDayStats {
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number | null;
  gainPercent: number;
  volatility: number; // (high - low) / open * 100
}

/**
 * Props for ListingPerformanceCharts
 */
export interface ListingPerformanceChartsProps {
  /** Listing performance data */
  listingPerformance: ListingPerformanceData;
  /** Issue price for baseline */
  issuePrice: number;
  /** Company name for title */
  companyName: string;
  /** Sector for comparison */
  sector?: string | null;
  /** Listing date */
  listingDate?: Date | null;
  /** Custom className */
  className?: string;
  /** Show advanced view (default: false) */
  showAdvanced?: boolean;
  /** Default expanded state (default: true) */
  defaultExpanded?: boolean;
}

/**
 * Props for StockPriceChart
 */
export interface StockPriceChartProps {
  /** Historical price data */
  priceData: StockPricePoint[];
  /** Issue price for reference line */
  issuePrice: number;
  /** Current price */
  currentPrice: number | null;
  /** Performance periods */
  periods: PerformancePeriod[];
  /** 52-week high/low */
  weekHigh52?: number | null;
  weekLow52?: number | null;
  className?: string;
}

/**
 * Props for ListingGainsChart
 */
export interface ListingGainsChartProps {
  /** Issue price */
  issuePrice: number;
  /** Listing price */
  listingPrice: number;
  /** Listing gain percentage */
  listingGainPercent: number;
  /** Current price */
  currentPrice?: number | null;
  /** Current gain percentage */
  currentGainPercent?: number | null;
  /** Listing day stats */
  listingDayStats?: ListingDayStats | null;
  className?: string;
}

/**
 * Props for SectorComparisonChart
 */
export interface SectorComparisonChartProps {
  /** Sector comparison data */
  comparison: SectorComparison;
  /** Additional comparison metrics */
  additionalMetrics?: {
    label: string;
    value: number;
    format: 'percent' | 'number' | 'currency';
  }[];
  className?: string;
}
