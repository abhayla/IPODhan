/**
 * TypeScript interfaces for Financial Performance Charts
 *
 * Defines types for financial data, chart data points, and component props.
 * All interfaces match the database schema (camelCase) from packages/shared/src/db/schema.ts
 */

/**
 * Financial data structure from database (camelCase)
 * Matches `financialData` table schema (lines 356-413)
 */
export interface FinancialDataFromDB {
  id: string;
  ipoId: string;

  // Revenue by fiscal year (in INR crores)
  revenueFy2022: string | null; // Drizzle returns numeric as string
  revenueFy2023: string | null;
  revenueFy2024: string | null;

  // Profit by fiscal year (in INR crores)
  profitFy2022: string | null;
  profitFy2023: string | null;
  profitFy2024: string | null;

  // EBITDA by fiscal year (in INR crores)
  ebitdaFy2022: string | null;
  ebitdaFy2023: string | null;
  ebitdaFy2024: string | null;

  // Total Income by fiscal year (in INR crores)
  totalIncomeFy2022: string | null;
  totalIncomeFy2023: string | null;
  totalIncomeFy2024: string | null;

  // Financial Ratios (for reference cards)
  peRatio: string | null; // P/E Ratio
  eps: string | null; // Earnings Per Share
  roe: string | null; // Return on Equity (percentage)
  debtToEquity: string | null; // Debt-to-Equity Ratio
  netWorth: string | null; // Net Worth (in INR crores)
  reservesAndSurplus: string | null; // Reserves and Surplus
  totalAssets: string | null; // Total Assets
  totalBorrowing: string | null; // Total Borrowing
  totalBorrowings: string | null; // Total Borrowings (duplicate field)

  // Additional ratios (Story 11.12)
  currentRatio: string | null; // Current Ratio
  quickRatio: string | null; // Quick Ratio
  inventoryTurnover: string | null; // Inventory Turnover Ratio
  ronw: string | null; // Return on Net Worth (percentage)
  marketCap: string | null; // Market Capitalization
  preIpoEps: string | null; // Pre-IPO EPS
  postIpoEps: string | null; // Post-IPO EPS

  // Promoter holding
  promoterHoldingPreIssue: string | null; // Pre-issue promoter holding %
  promoterHoldingPostIssue: string | null; // Post-issue promoter holding %
}

/**
 * Transformed financial data point with calculated margins
 * Used for chart rendering
 */
export interface FinancialChartDataWithMargins {
  /** Fiscal year label (e.g., "FY2022", "FY2023") */
  year: string;

  /** Revenue in crores */
  revenue: number | null;

  /** Profit in crores */
  profit: number | null;

  /** EBITDA in crores */
  ebitda: number | null;

  /** Total Income in crores */
  totalIncome: number | null;

  /** Profit Margin % = (Profit / Revenue) × 100 */
  profitMargin: number | null;

  /** EBITDA Margin % = (EBITDA / Revenue) × 100 */
  ebitdaMargin: number | null;

  /** Revenue Growth % (YoY) */
  revenueGrowth: number | null;

  /** Profit Growth % (YoY) */
  profitGrowth: number | null;

  /** EBITDA Growth % (YoY) */
  ebitdaGrowth: number | null;
}

/**
 * Industry benchmark data (optional)
 * Used for peer comparison
 */
export interface IndustryBenchmarks {
  /** Industry average P/E ratio */
  industryPe: number | null;

  /** Sector name for context */
  sectorName: string | null;
}

/**
 * Peer company data (optional)
 * Used for comparative analysis
 */
export interface PeerData {
  /** Company name */
  companyName: string;

  /** Peer company P/E ratio */
  peRatio: number | null;

  /** Peer company EPS */
  eps: number | null;

  /** Peer company Return on Net Worth % */
  ronw: number | null;
}

/**
 * Financial Ratios Grid Item
 * Used for displaying key ratios in card grid
 */
export interface FinancialRatioItem {
  /** Ratio label (e.g., "ROE", "Debt-to-Equity") */
  label: string;

  /** Ratio value (formatted) */
  value: string;

  /** Raw numeric value for trend calculation */
  rawValue: number | null;

  /** Trend indicator: "up" | "down" | "neutral" */
  trend: 'up' | 'down' | 'neutral';

  /** Trend percentage (optional) */
  trendPercentage: number | null;

  /** Description/help text */
  description: string;

  /** Unit (e.g., "%", "x", "₹ Cr") */
  unit: string;

  /** Color scheme: "green" | "red" | "blue" | "amber" */
  colorScheme: 'green' | 'red' | 'blue' | 'amber' | 'gray';
}

/**
 * Component Props: FinancialPerformanceCharts
 */
export interface FinancialPerformanceChartsProps {
  /** Financial data from database (primary source) */
  financialData: FinancialDataFromDB | null;

  /** Company name for display */
  companyName: string;

  /** IPO lifecycle status (UPCOMING/OPEN/CLOSED/LISTED) — drives status-aware empty-state copy */
  status?: string;

  /** Industry benchmark data (optional) */
  industryBenchmarks?: IndustryBenchmarks;

  /** Peer comparison data (optional) */
  peerData?: PeerData[];

  /** Initial expanded state (default: false) */
  defaultExpanded?: boolean;

  /** Show advanced charts (default: false) */
  showAdvanced?: boolean;
}

/**
 * Component Props: RevenueChart
 */
export interface RevenueChartProps {
  /** Transformed financial data with margins */
  data: FinancialChartDataWithMargins[];

  /** Company name for title */
  companyName: string;

  /** Chart height in pixels (default: 300) */
  height?: number;

  /** Show growth annotations (default: true) */
  showGrowth?: boolean;
}

/**
 * Component Props: ProfitabilityChart
 */
export interface ProfitabilityChartProps {
  /** Transformed financial data with margins */
  data: FinancialChartDataWithMargins[];

  /** Company name for title */
  companyName: string;

  /** Chart height in pixels (default: 300) */
  height?: number;

  /** Show margin line (default: true) */
  showMargin?: boolean;
}

/**
 * Component Props: EBITDAChart
 */
export interface EBITDAChartProps {
  /** Transformed financial data with margins */
  data: FinancialChartDataWithMargins[];

  /** Company name for title */
  companyName: string;

  /** Chart height in pixels (default: 300) */
  height?: number;

  /** Show margin indicators (default: true) */
  showMargin?: boolean;
}

/**
 * Component Props: FinancialRatiosGrid
 */
export interface FinancialRatiosGridProps {
  /** Financial data from database */
  financialData: FinancialDataFromDB;

  /** Industry benchmarks for comparison (optional) */
  industryBenchmarks?: IndustryBenchmarks;

  /** Show comparison with industry (default: false) */
  showComparison?: boolean;
}

/**
 * Data completeness result
 */
export interface DataCompletenessResult {
  /** Percentage of available data (0-100) */
  percentage: number;

  /** Number of fields with data */
  filledFields: number;

  /** Total number of fields checked */
  totalFields: number;

  /** Fields that are missing */
  missingFields: string[];
}

/**
 * Growth trend result
 */
export interface GrowthTrend {
  /** Metric name */
  metric: string;

  /** FY2023 growth % (vs FY2022) */
  growth2023: number | null;

  /** FY2024 growth % (vs FY2023) */
  growth2024: number | null;

  /** Average growth % */
  averageGrowth: number | null;

  /** Trend direction: "improving" | "declining" | "stable" */
  trend: 'improving' | 'declining' | 'stable';
}
