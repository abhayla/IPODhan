/**
 * Subscription Utilities
 *
 * Utilities for subscription data validation, formatting, and calculations.
 * Story 5.6: Enhanced Subscription Breakdown
 */

import type { Subscription } from '@ipodhan/shared/db/types';

/**
 * Validation result for subscription data
 */
export interface SubscriptionValidationResult {
  valid: boolean;
  warnings: string[];
}

/**
 * Category descriptions for tooltips
 */
export const CATEGORY_DESCRIPTIONS = {
  qib: 'Qualified Institutional Buyers - Mutual funds, insurance companies, banks, and other institutional investors',
  bNII:
    'Big NII - Non-institutional investors with individual bids of ₹10 lakh or more',
  sNII:
    'Small NII - Non-institutional investors with individual bids below ₹10 lakh',
  retailHNI:
    'Retail High Net Worth - Retail investors with higher investment amounts in the retail category',
  retailOthers:
    'Other Retail Investors - Individual retail investors with standard bid amounts',
  anchor:
    'Anchor Investors - Institutional investors who subscribe before the IPO opens to the public, signaling strong confidence in the issue',
  employee:
    'Employee Reservation - Special quota reserved for company employees to apply at a discounted price',
} as const;

/**
 * View mode for subscription display
 */
export type SubscriptionViewMode = 'simple' | 'detailed';

/**
 * LocalStorage key for view preference
 */
export const SUBSCRIPTION_VIEW_STORAGE_KEY = 'ipo-subscription-view-preference';

/**
 * Validate subscription totals
 * Checks if granular breakdowns match their parent totals
 */
export function validateSubscriptionTotals(
  sub: Subscription
): SubscriptionValidationResult {
  const warnings: string[] = [];
  const tolerance = 0.01; // Allow rounding differences

  // Convert string values to numbers if needed
  const toNum = (val: string | number | null): number => {
    if (val === null) return 0;
    return typeof val === 'string' ? parseFloat(val) : val;
  };

  // Check NII breakdown (bNII + sNII should equal NII)
  // Only validate if we have the parent total (nii)
  const bNII = toNum(sub.bNIISubscription);
  const sNII = toNum(sub.sNIISubscription);
  const nii = toNum(sub.niiSubscription);

  // Only validate if parent total exists and at least one child value exists
  if (nii > 0 && (bNII > 0 || sNII > 0)) {
    const niiSum = bNII + sNII;
    const niiDiff = Math.abs(niiSum - nii);
    if (niiDiff > tolerance) {
      warnings.push(
        `NII breakdown mismatch: bNII (${bNII.toFixed(2)}) + sNII (${sNII.toFixed(2)}) = ${niiSum.toFixed(2)}, but NII total is ${nii.toFixed(2)}`
      );
    }
  }

  // Check Retail breakdown (HNI + Others should equal Retail)
  // Only validate if we have the parent total (retail)
  const retailHNI = toNum(sub.retailHNISubscription);
  const retailOthers = toNum(sub.retailOthersSubscription);
  const retail = toNum(sub.retailSubscription);

  // Only validate if parent total exists and at least one child value exists
  if (retail > 0 && (retailHNI > 0 || retailOthers > 0)) {
    const retailSum = retailHNI + retailOthers;
    const retailDiff = Math.abs(retailSum - retail);
    if (retailDiff > tolerance) {
      warnings.push(
        `Retail breakdown mismatch: HNI (${retailHNI.toFixed(2)}) + Others (${retailOthers.toFixed(2)}) = ${retailSum.toFixed(2)}, but Retail total is ${retail.toFixed(2)}`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Check if detailed subscription data is available
 */
export function hasDetailedSubscriptionData(sub: Subscription): boolean {
  // Consider detailed data available if at least one granular field has a value
  const toNum = (val: string | number | null): number => {
    if (val === null) return 0;
    return typeof val === 'string' ? parseFloat(val) : val;
  };

  return (
    toNum(sub.bNIISubscription) > 0 ||
    toNum(sub.sNIISubscription) > 0 ||
    toNum(sub.retailHNISubscription) > 0 ||
    toNum(sub.retailOthersSubscription) > 0 ||
    toNum(sub.anchorInvestorSubscription) > 0
  );
}

/**
 * Format subscription value for display
 */
export function formatSubscriptionValue(
  value: string | number | null
): string {
  if (value === null || value === undefined) return 'N/A';
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return 'N/A';
  return numValue.toFixed(2);
}

/**
 * Get color class for subscription value
 */
export function getSubscriptionColor(
  value: string | number | null
): {
  bar: string;
  text: string;
  bg: string;
} {
  if (value === null || value === undefined) {
    return {
      bar: 'bg-gray-300',
      text: 'text-gray-600',
      bg: 'bg-gray-100',
    };
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  if (numValue >= 1) {
    return {
      bar: 'bg-green-500',
      text: 'text-green-600',
      bg: 'bg-green-100',
    };
  }

  if (numValue >= 0.5) {
    return {
      bar: 'bg-yellow-500',
      text: 'text-yellow-600',
      bg: 'bg-yellow-100',
    };
  }

  return {
    bar: 'bg-red-500',
    text: 'text-red-600',
    bg: 'bg-red-100',
  };
}

/**
 * Calculate progress bar width percentage
 */
export function getSubscriptionBarWidth(
  value: string | number | null,
  maxValue: number = 10
): string {
  if (value === null || value === undefined) return '0%';

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue) || numValue <= 0) return '0%';

  // Cap at 100% for display
  const percentage = Math.min((numValue / Math.max(numValue, maxValue)) * 100, 100);
  return `${percentage}%`;
}

/**
 * Calculate anchor investor allocation percentage
 */
export function calculateAnchorAllocationPercentage(
  anchorSubscription: string | number | null,
  issueSize: string | number | null
): number | null {
  if (!anchorSubscription || !issueSize) return null;

  const anchorNum =
    typeof anchorSubscription === 'string'
      ? parseFloat(anchorSubscription)
      : anchorSubscription;
  const issueNum =
    typeof issueSize === 'string' ? parseFloat(issueSize) : issueSize;

  if (isNaN(anchorNum) || isNaN(issueNum) || issueNum === 0) return null;

  // Assuming anchorSubscription represents the amount in crores
  return (anchorNum / issueNum) * 100;
}

/**
 * Check if anchor allocation is strong (>30% of issue)
 */
export function isStrongAnchorAllocation(percentage: number | null): boolean {
  return percentage !== null && percentage > 30;
}

/**
 * Save view preference to localStorage
 */
export function saveViewPreference(view: SubscriptionViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SUBSCRIPTION_VIEW_STORAGE_KEY, view);
  } catch (error) {
    console.warn('Failed to save subscription view preference:', error);
  }
}

/**
 * Get view preference from localStorage
 */
export function getViewPreference(): SubscriptionViewMode {
  if (typeof window === 'undefined') return 'simple';
  try {
    const stored = localStorage.getItem(SUBSCRIPTION_VIEW_STORAGE_KEY);
    return (stored as SubscriptionViewMode) || 'simple';
  } catch (error) {
    console.warn('Failed to retrieve subscription view preference:', error);
    return 'simple';
  }
}
