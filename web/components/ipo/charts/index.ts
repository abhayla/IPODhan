/**
 * Chart Components - Barrel Export
 *
 * Centralized exports for all chart components and utilities.
 * Import any chart component from this file for convenience.
 *
 * @example
 * ```ts
 * import { LineChartBase, ChartContainer, transformFinancialData } from '@/components/ipo/charts';
 * ```
 */

// Base Chart Components
export { LineChartBase, type LineChartBaseProps, type LineConfig } from './base/LineChartBase';
export { AreaChartBase, type AreaChartBaseProps, type AreaConfig } from './base/AreaChartBase';
export { BarChartBase, type BarChartBaseProps, type BarConfig } from './base/BarChartBase';
export { PieChartBase, type PieChartBaseProps, type PieDataItem } from './base/PieChartBase';
export {
  ComposedChartBase,
  type ComposedChartBaseProps,
  type ChartSeriesConfig,
  type YAxisConfig,
} from './base/ComposedChartBase';
export { TimelineBase, type TimelineBaseProps, type TimelineMilestone } from './base/TimelineBase';
export {
  GaugeChartBase,
  type GaugeChartBaseProps,
  type GaugeColorRange,
} from './base/GaugeChartBase';

// Chart Container & UI Components
export {
  ChartContainer,
  ChartSkeleton,
  ChartEmptyState,
  ChartErrorState,
  type ChartContainerProps,
} from './ChartContainer';

// Data Transformation Utilities (re-export from lib/utils)
export {
  transformFinancialData,
  transformSubscriptionData,
  transformGMPData,
  calculateGrowth,
  calculateTrends,
  formatCurrency,
  formatPercentage,
  formatNumber,
  formatDate,
  getColorByValue,
  getLatestValue,
  calculateAverage,
  groupBy,
  type FinancialDataRaw,
  type SubscriptionDataRaw,
  type GMPRecordRaw,
  type FinancialChartData,
  type SubscriptionChartData,
  type GMPChartData,
} from '@/lib/utils/chart-data';

// Financial Performance Charts (Phase 3)
export { default as FinancialPerformanceCharts } from './FinancialPerformanceCharts';
export type {
  FinancialPerformanceChartsProps,
  FinancialDataFromDB,
  FinancialChartDataWithMargins,
  IndustryBenchmarks,
  PeerData,
  FinancialRatioItem,
} from './FinancialPerformanceCharts/types';

// Subscription Dashboard (Phase 3)
export { SubscriptionDashboard } from './SubscriptionDashboard';
export type {
  SubscriptionDashboardProps,
  CategorySubscription,
  SubscriptionTimePoint,
  SubscriptionStats,
  SubscriptionHeatmapPoint,
} from './SubscriptionDashboard/types';

// Listing Performance Charts (Phase 3)
export { ListingPerformanceCharts } from './ListingPerformanceCharts';
export type {
  ListingPerformanceChartsProps,
  ListingPerformanceData,
  StockPricePoint,
  PerformancePeriod,
  SectorComparison,
  ListingDayStats,
} from './ListingPerformanceCharts/types';

// Demand Graph (Phase 3)
export { DemandGraph } from './DemandGraph';
export type {
  DemandGraphProps,
  IPODemandRecord,
  DemandChartData,
  DemandSummary,
} from './DemandGraph/types';

// Enhanced GMP History Chart (Phase 3)
export { GMPHistoryChart } from './GMPHistoryChart';
export type {
  GMPHistoryChartProps,
  GMPRecordDB,
  GMPChartPoint,
  GMPTrendAnalysis,
  ConfidenceBandConfig,
  MovingAverageConfig,
} from './GMPHistoryChart/types';
