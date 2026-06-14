/**
 * SubscriptionDashboard Types
 *
 * Type definitions for subscription tracking visualization components
 */

import type { SubscriptionDataRaw } from '@/lib/utils/chart-data';

/**
 * Subscription category breakdown
 */
export interface CategorySubscription {
  category: 'QIB' | 'NII' | 'Retail' | 'Employee' | 'Shareholder';
  subscription: number;
  applications: number | null;
  sharesOffered: number | null;
  label: string;
  color: string;
}

/**
 * Time-series subscription data point
 */
export interface SubscriptionTimePoint {
  date: Date;
  dateLabel: string;
  totalSubscription: number;
  qibSubscription: number | null;
  niiSubscription: number | null;
  retailSubscription: number | null;
  employeeSubscription: number | null;
  shareholderSubscription: number | null;
}

/**
 * Subscription statistics
 */
export interface SubscriptionStats {
  total: number;
  qib: number | null;
  nii: number | null;
  retail: number | null;
  employee: number | null;
  shareholder: number | null;
  totalApplications: number | null;
  peakSubscription: number;
  peakDate: Date | null;
  averageDaily: number;
}

/**
 * Subscription heatmap data point
 */
export interface SubscriptionHeatmapPoint {
  date: Date;
  dateLabel: string;
  intensity: number; // 0-100 (normalized subscription)
  subscription: number;
  dayOfBidding: number; // Day 1, 2, 3...
}

/**
 * Props for SubscriptionDashboard
 */
export interface SubscriptionDashboardProps {
  /** Historical subscription data */
  subscriptions: SubscriptionDataRaw[];
  /** Latest subscription value */
  latestSubscription: SubscriptionDataRaw | null;
  /** Company name for title */
  companyName: string;
  /** IPO close date for context */
  closeDate: Date | null;
  /** IPO lifecycle status (UPCOMING/OPEN/CLOSED/LISTED) — drives status-aware empty-state copy */
  status?: string;
  /** Custom className */
  className?: string;
  /** Show advanced view (default: false) */
  showAdvanced?: boolean;
  /** Default expanded state (default: true) */
  defaultExpanded?: boolean;
}

/**
 * Props for OverallSubscriptionChart
 */
export interface OverallSubscriptionChartProps {
  data: SubscriptionTimePoint[];
  stats: SubscriptionStats;
  closeDate: Date | null;
  className?: string;
}

/**
 * Props for CategoryBreakdownChart
 */
export interface CategoryBreakdownChartProps {
  categories: CategorySubscription[];
  stats: SubscriptionStats;
  className?: string;
}

/**
 * Props for SubscriptionHeatmap
 */
export interface SubscriptionHeatmapProps {
  data: SubscriptionHeatmapPoint[];
  className?: string;
}

/**
 * Props for InvestorCategoryCards
 */
export interface InvestorCategoryCardsProps {
  categories: CategorySubscription[];
  subscriptions: SubscriptionDataRaw[];
  className?: string;
}
