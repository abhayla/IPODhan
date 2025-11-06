/**
 * SubscriptionDashboard Utilities
 *
 * Data transformation and calculation utilities for subscription visualizations
 */

import { format, parseISO } from 'date-fns';
import type { SubscriptionDataRaw } from '@/lib/utils/chart-data';
import type {
  CategorySubscription,
  SubscriptionTimePoint,
  SubscriptionStats,
  SubscriptionHeatmapPoint,
} from './types';

/**
 * Null-safe timestamp parser
 * Returns null for invalid timestamps instead of creating fallback dates
 *
 * @param ts - Timestamp value (Date, string, or null/undefined)
 * @returns Parsed Date or null if invalid
 */
function parseTimestamp(ts: Date | string | null | undefined): Date | null {
  if (!ts) return null;

  try {
    if (ts instanceof Date) {
      return isNaN(ts.getTime()) ? null : ts;
    }
    const parsed = parseISO(ts as string);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (error) {
    console.error('[parseTimestamp] Invalid timestamp:', ts, error);
    return null;
  }
}

/**
 * Transform raw subscription data to time-series points
 */
export function transformToTimeSeriesData(
  subscriptions: SubscriptionDataRaw[]
): SubscriptionTimePoint[] {
  if (!subscriptions || subscriptions.length === 0) {
    return [];
  }

  // Filter out records with invalid timestamps
  const validSubscriptions = subscriptions.filter(sub => {
    const date = parseTimestamp(sub.timestamp);
    return date !== null;
  });

  if (validSubscriptions.length === 0) {
    return [];
  }

  // Sort by date (oldest first)
  const sorted = [...validSubscriptions].sort((a, b) => {
    const dateA = parseTimestamp(a.timestamp)!;
    const dateB = parseTimestamp(b.timestamp)!;
    return dateA.getTime() - dateB.getTime();
  });

  return sorted.map((sub) => {
    const date = parseTimestamp(sub.timestamp)!;

    return {
      date,
      dateLabel: format(date, 'MMM dd'),
      totalSubscription: sub.totalSubscription ? Number(sub.totalSubscription) : 0,
      qibSubscription: sub.qibSubscription ? Number(sub.qibSubscription) : null,
      niiSubscription: sub.niiSubscription ? Number(sub.niiSubscription) : null,
      retailSubscription: sub.retailSubscription ? Number(sub.retailSubscription) : null,
      employeeSubscription: sub.employeeSubscription
        ? Number(sub.employeeSubscription)
        : null,
      shareholderSubscription: sub.shareholderSubscription
        ? Number(sub.shareholderSubscription)
        : null,
    };
  });
}

/**
 * Calculate subscription statistics
 */
export function calculateSubscriptionStats(
  subscriptions: SubscriptionDataRaw[],
  latest: SubscriptionDataRaw | null
): SubscriptionStats {
  if (!latest && (!subscriptions || subscriptions.length === 0)) {
    return {
      total: 0,
      qib: null,
      nii: null,
      retail: null,
      employee: null,
      shareholder: null,
      totalApplications: null,
      peakSubscription: 0,
      peakDate: null,
      averageDaily: 0,
    };
  }

  const latestData = latest || subscriptions[subscriptions.length - 1];

  // Find peak subscription
  let peakSubscription = 0;
  let peakDate: Date | null = null;

  subscriptions.forEach((sub) => {
    const total = sub.totalSubscription ? Number(sub.totalSubscription) : 0;
    if (total > peakSubscription) {
      peakSubscription = total;
      peakDate = parseTimestamp(sub.timestamp);
    }
  });

  // Calculate average daily subscription
  const validSubscriptions = subscriptions.filter(
    (sub) => sub.totalSubscription && Number(sub.totalSubscription) > 0
  );
  const averageDaily =
    validSubscriptions.length > 0
      ? validSubscriptions.reduce(
          (sum, sub) => sum + Number(sub.totalSubscription || 0),
          0
        ) / validSubscriptions.length
      : 0;

  return {
    total: latestData.totalSubscription ? Number(latestData.totalSubscription) : 0,
    qib: latestData.qibSubscription ? Number(latestData.qibSubscription) : null,
    nii: latestData.niiSubscription ? Number(latestData.niiSubscription) : null,
    retail: latestData.retailSubscription
      ? Number(latestData.retailSubscription)
      : null,
    employee: latestData.employeeSubscription
      ? Number(latestData.employeeSubscription)
      : null,
    shareholder: latestData.shareholderSubscription
      ? Number(latestData.shareholderSubscription)
      : null,
    totalApplications: latestData.totalApplications
      ? Number(latestData.totalApplications)
      : null,
    peakSubscription,
    peakDate,
    averageDaily,
  };
}

/**
 * Get category breakdown for latest subscription
 */
export function getCategoryBreakdown(
  latest: SubscriptionDataRaw | null,
  stats: SubscriptionStats
): CategorySubscription[] {
  if (!latest) {
    return [];
  }

  const categories: CategorySubscription[] = [];

  // QIB (Qualified Institutional Buyers)
  if (stats.qib !== null) {
    categories.push({
      category: 'QIB',
      subscription: stats.qib,
      applications: latest.qibApplications ? Number(latest.qibApplications) : null,
      sharesOffered: latest.qibSharesOffered
        ? Number(latest.qibSharesOffered)
        : null,
      label: 'QIB',
      color: 'hsl(var(--chart-1))', // Blue
    });
  }

  // NII (Non-Institutional Investors)
  if (stats.nii !== null) {
    categories.push({
      category: 'NII',
      subscription: stats.nii,
      applications: latest.niiApplications ? Number(latest.niiApplications) : null,
      sharesOffered: latest.niiSharesOffered
        ? Number(latest.niiSharesOffered)
        : null,
      label: 'NII',
      color: 'hsl(var(--chart-2))', // Green
    });
  }

  // Retail Individual Investors
  if (stats.retail !== null) {
    categories.push({
      category: 'Retail',
      subscription: stats.retail,
      applications: latest.retailApplications
        ? Number(latest.retailApplications)
        : null,
      sharesOffered: latest.retailSharesOffered
        ? Number(latest.retailSharesOffered)
        : null,
      label: 'Retail',
      color: 'hsl(var(--chart-3))', // Orange
    });
  }

  // Employee (if available)
  if (stats.employee !== null && stats.employee > 0) {
    categories.push({
      category: 'Employee',
      subscription: stats.employee,
      applications: null,
      sharesOffered: latest.employeeSharesOffered
        ? Number(latest.employeeSharesOffered)
        : null,
      label: 'Employee',
      color: 'hsl(var(--chart-4))', // Purple
    });
  }

  // Shareholder (if available)
  if (stats.shareholder !== null && stats.shareholder > 0) {
    categories.push({
      category: 'Shareholder',
      subscription: stats.shareholder,
      applications: null,
      sharesOffered: latest.shareholderSharesOffered
        ? Number(latest.shareholderSharesOffered)
        : null,
      label: 'Shareholder',
      color: 'hsl(var(--chart-5))', // Pink
    });
  }

  return categories.sort((a, b) => b.subscription - a.subscription);
}

/**
 * Transform subscription data to heatmap format
 */
export function transformToHeatmapData(
  subscriptions: SubscriptionDataRaw[]
): SubscriptionHeatmapPoint[] {
  if (!subscriptions || subscriptions.length === 0) {
    return [];
  }

  // Filter out records with invalid timestamps
  const validSubscriptions = subscriptions.filter(sub => {
    const date = parseTimestamp(sub.timestamp);
    return date !== null;
  });

  if (validSubscriptions.length === 0) {
    return [];
  }

  // Sort by date (oldest first)
  const sorted = [...validSubscriptions].sort((a, b) => {
    const dateA = parseTimestamp(a.timestamp)!;
    const dateB = parseTimestamp(b.timestamp)!;
    return dateA.getTime() - dateB.getTime();
  });

  // Find max subscription for normalization
  const maxSubscription = Math.max(
    ...sorted.map((sub) => Number(sub.totalSubscription || 0))
  );

  return sorted.map((sub, index) => {
    const date = parseTimestamp(sub.timestamp)!;
    const subscription = sub.totalSubscription ? Number(sub.totalSubscription) : 0;

    return {
      date,
      dateLabel: format(date, 'MMM dd'),
      intensity: maxSubscription > 0 ? (subscription / maxSubscription) * 100 : 0,
      subscription,
      dayOfBidding: index + 1,
    };
  });
}

/**
 * Get category subscription trend (last 7 days)
 */
export function getCategoryTrend(
  subscriptions: SubscriptionDataRaw[],
  category: 'qib' | 'nii' | 'retail' | 'employee' | 'shareholder'
): { date: Date; value: number }[] {
  if (!subscriptions || subscriptions.length === 0) {
    return [];
  }

  // Get last 7 data points
  const last7 = subscriptions.slice(-7);

  return last7
    .map((sub) => {
      const date = parseTimestamp(sub.timestamp);
      if (!date) return null;

      let value = 0;

      switch (category) {
        case 'qib':
          value = sub.qibSubscription ? Number(sub.qibSubscription) : 0;
          break;
        case 'nii':
          value = sub.niiSubscription ? Number(sub.niiSubscription) : 0;
          break;
        case 'retail':
          value = sub.retailSubscription ? Number(sub.retailSubscription) : 0;
          break;
        case 'employee':
          value = sub.employeeSubscription ? Number(sub.employeeSubscription) : 0;
          break;
        case 'shareholder':
          value = sub.shareholderSubscription
            ? Number(sub.shareholderSubscription)
            : 0;
          break;
      }

      return { date, value };
    })
    .filter((point): point is { date: Date; value: number } => point !== null && point.value > 0);
}

/**
 * Format subscription number for display
 */
export function formatSubscription(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  if (value === 0) {
    return '0x';
  }

  if (value < 1) {
    return `${value.toFixed(2)}x`;
  }

  if (value < 10) {
    return `${value.toFixed(1)}x`;
  }

  return `${Math.round(value)}x`;
}

/**
 * Format large numbers (applications, shares)
 */
export function formatLargeNumber(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  if (value >= 10000000) {
    // 1 Crore+
    return `${(value / 10000000).toFixed(2)} Cr`;
  }

  if (value >= 100000) {
    // 1 Lakh+
    return `${(value / 100000).toFixed(2)} L`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }

  return value.toLocaleString();
}

/**
 * Check if subscription data is sufficient for visualization
 */
export function hasMinimumSubscriptionData(
  subscriptions: SubscriptionDataRaw[]
): boolean {
  if (!subscriptions || subscriptions.length === 0) {
    return false;
  }

  // Check if at least one subscription has valid data
  return subscriptions.some(
    (sub) => sub.totalSubscription && Number(sub.totalSubscription) > 0
  );
}

/**
 * Calculate subscription data completeness (0-100%)
 */
export function calculateSubscriptionCompleteness(
  subscriptions: SubscriptionDataRaw[]
): number {
  if (!subscriptions || subscriptions.length === 0) {
    return 0;
  }

  const fieldWeights = {
    totalSubscription: 30,
    qibSubscription: 15,
    niiSubscription: 15,
    retailSubscription: 15,
    totalApplications: 10,
    qibApplications: 5,
    niiApplications: 5,
    retailApplications: 5,
  };

  let totalWeight = 0;
  let availableWeight = 0;

  const latest = subscriptions[subscriptions.length - 1];

  Object.entries(fieldWeights).forEach(([field, weight]) => {
    totalWeight += weight;
    if (latest[field as keyof SubscriptionDataRaw] !== null) {
      availableWeight += weight;
    }
  });

  return Math.round((availableWeight / totalWeight) * 100);
}
