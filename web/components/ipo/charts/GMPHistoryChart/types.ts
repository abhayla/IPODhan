/**
 * Type definitions for Enhanced GMP History Chart component
 *
 * Displays 30-day GMP trend with confidence bands, moving averages,
 * and comparison with expected listing price.
 * Data sourced from gmp_records table.
 */

/**
 * Raw GMP record from database
 */
export interface GMPRecordDB {
  id: string;
  ipoId: string;
  timestamp: Date;
  gmp: number; // Grey market premium in INR
  expectedListingPrice: number | null;
  subjectRate: number | null;
  kostakRate: number | null;
  saudaDetails: string | null;
  source: string;
}

/**
 * Processed GMP data point for chart visualization
 */
export interface GMPChartPoint {
  date: string; // Formatted date (e.g., "15 Oct")
  timestamp: Date; // Original timestamp
  gmp: number; // Actual GMP value
  gmpUpper: number; // Illustrative +10% range (NOT a statistical confidence band)
  gmpLower: number; // Illustrative -10% range (NOT a statistical confidence band)
  movingAvg7: number | null; // 7-day moving average
  expectedListingPrice: number | null; // Expected listing price
  volatility: number; // Daily volatility %
}

/**
 * GMP trend analysis
 */
export interface GMPTrendAnalysis {
  trend: 'upward' | 'downward' | 'stable'; // Overall trend direction
  volatility: 'high' | 'medium' | 'low'; // Volatility classification
  avgGMP: number; // Average GMP over period
  minGMP: number; // Minimum GMP
  maxGMP: number; // Maximum GMP
  latestGMP: number; // Most recent GMP
  changePercent: number; // % change from first to last
  avgVolatility: number; // Average daily volatility %
}

/**
 * Component props
 */
export interface GMPHistoryChartProps {
  /**
   * GMP records from database (up to 30 days)
   */
  gmpRecords: GMPRecordDB[];

  /**
   * Company name for chart title
   */
  companyName: string;

  /**
   * Price range max for context
   */
  priceRangeMax: number | null;

  /**
   * Number of days to display
   * @default 30
   */
  daysToShow?: number;

  /**
   * Whether to expand chart by default
   * @default false
   */
  defaultExpanded?: boolean;

  /**
   * Show advanced features (confidence bands, moving average)
   * @default true
   */
  showAdvanced?: boolean;

  /**
   * Show comparison with expected listing price
   * @default true
   */
  showListingPrice?: boolean;
}

/**
 * Confidence band configuration
 */
export interface ConfidenceBandConfig {
  enabled: boolean;
  percentage: number; // ±10% default
  color: string; // Fill color
  opacity: number; // 0-1
}

/**
 * Moving average configuration
 */
export interface MovingAverageConfig {
  enabled: boolean;
  window: number; // 7 days default
  color: string;
  strokeWidth: number;
}
