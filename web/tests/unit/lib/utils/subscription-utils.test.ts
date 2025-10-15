/**
 * Unit Tests: Subscription Utilities
 *
 * Tests for subscription validation, formatting, and helper functions.
 * Story 5.6: Enhanced Subscription Breakdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateSubscriptionTotals,
  hasDetailedSubscriptionData,
  formatSubscriptionValue,
  getSubscriptionColor,
  getSubscriptionBarWidth,
  calculateAnchorAllocationPercentage,
  isStrongAnchorAllocation,
  saveViewPreference,
  getViewPreference,
  CATEGORY_DESCRIPTIONS,
  SUBSCRIPTION_VIEW_STORAGE_KEY,
} from '@/lib/utils/subscription-utils';
import type { Subscription } from '@ipodhan/shared/db/types';

// Mock subscription data
const createMockSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'test-sub-id',
  ipoId: 'test-ipo-id',
  timestamp: new Date('2024-01-15T10:00:00Z'),
  qibSubscription: '5.20',
  niiSubscription: '3.80',
  retailSubscription: '1.50',
  totalSubscription: '3.50',
  employeeSubscription: '0.80',
  othersSubscription: '0.00',
  anchorInvestorSubscription: '100.00',
  retailHNISubscription: '2.00',
  retailOthersSubscription: '1.20',
  bNIISubscription: '4.50',
  sNIISubscription: '2.10',
  totalApplications: 50000,
  totalSharesBid: 150000000,
  sharesOffered: 50000000,
  ...overrides,
});

describe('validateSubscriptionTotals', () => {
  it('should return valid for matching NII breakdown', () => {
    const sub = createMockSubscription({
      niiSubscription: '6.60',
      bNIISubscription: '4.50',
      sNIISubscription: '2.10',
      // Clear retail values to isolate NII validation
      retailSubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return valid for matching Retail breakdown', () => {
    const sub = createMockSubscription({
      retailSubscription: '3.20',
      retailHNISubscription: '2.00',
      retailOthersSubscription: '1.20',
      // Clear NII values to isolate Retail validation
      niiSubscription: null,
      bNIISubscription: null,
      sNIISubscription: null,
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should detect NII breakdown mismatch', () => {
    const sub = createMockSubscription({
      niiSubscription: '10.00',
      bNIISubscription: '4.50',
      sNIISubscription: '2.10',
      // Clear retail values to isolate NII validation
      retailSubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NII breakdown mismatch');
  });

  it('should detect Retail breakdown mismatch', () => {
    const sub = createMockSubscription({
      retailSubscription: '10.00',
      retailHNISubscription: '2.00',
      retailOthersSubscription: '1.20',
      // Clear NII values to isolate Retail validation
      niiSubscription: null,
      bNIISubscription: null,
      sNIISubscription: null,
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Retail breakdown mismatch');
  });

  it('should tolerate small rounding differences', () => {
    const sub = createMockSubscription({
      niiSubscription: '6.61',
      bNIISubscription: '4.50',
      sNIISubscription: '2.10',
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(false); // 0.01 difference should still be flagged
  });

  it('should handle null values gracefully', () => {
    const sub = createMockSubscription({
      niiSubscription: null,
      bNIISubscription: null,
      sNIISubscription: null,
      retailSubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
    });

    const result = validateSubscriptionTotals(sub);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('hasDetailedSubscriptionData', () => {
  it('should return true when granular data exists', () => {
    const sub = createMockSubscription();
    expect(hasDetailedSubscriptionData(sub)).toBe(true);
  });

  it('should return false when no granular data exists', () => {
    const sub = createMockSubscription({
      bNIISubscription: null,
      sNIISubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
      anchorInvestorSubscription: null,
    });

    expect(hasDetailedSubscriptionData(sub)).toBe(false);
  });

  it('should return true if at least one granular field has value', () => {
    const sub = createMockSubscription({
      bNIISubscription: '4.50',
      sNIISubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
      anchorInvestorSubscription: null,
    });

    expect(hasDetailedSubscriptionData(sub)).toBe(true);
  });
});

describe('formatSubscriptionValue', () => {
  it('should format numeric values to 2 decimal places', () => {
    expect(formatSubscriptionValue(5.2)).toBe('5.20');
    expect(formatSubscriptionValue(1.567)).toBe('1.57');
  });

  it('should format string values to 2 decimal places', () => {
    expect(formatSubscriptionValue('5.2')).toBe('5.20');
    expect(formatSubscriptionValue('1.567')).toBe('1.57');
  });

  it('should return N/A for null values', () => {
    expect(formatSubscriptionValue(null)).toBe('N/A');
  });

  it('should return N/A for invalid values', () => {
    expect(formatSubscriptionValue('invalid')).toBe('N/A');
  });
});

describe('getSubscriptionColor', () => {
  it('should return green for values >= 1', () => {
    const color = getSubscriptionColor(1.5);
    expect(color.bar).toBe('bg-green-500');
    expect(color.text).toBe('text-green-600');
    expect(color.bg).toBe('bg-green-100');
  });

  it('should return yellow for values between 0.5 and 1', () => {
    const color = getSubscriptionColor(0.75);
    expect(color.bar).toBe('bg-yellow-500');
    expect(color.text).toBe('text-yellow-600');
    expect(color.bg).toBe('bg-yellow-100');
  });

  it('should return red for values < 0.5', () => {
    const color = getSubscriptionColor(0.3);
    expect(color.bar).toBe('bg-red-500');
    expect(color.text).toBe('text-red-600');
    expect(color.bg).toBe('bg-red-100');
  });

  it('should return gray for null values', () => {
    const color = getSubscriptionColor(null);
    expect(color.bar).toBe('bg-gray-300');
    expect(color.text).toBe('text-gray-600');
    expect(color.bg).toBe('bg-gray-100');
  });

  it('should handle string values', () => {
    const color = getSubscriptionColor('2.5');
    expect(color.bar).toBe('bg-green-500');
  });
});

describe('getSubscriptionBarWidth', () => {
  it('should return 0% for null values', () => {
    expect(getSubscriptionBarWidth(null)).toBe('0%');
  });

  it('should return 0% for zero values', () => {
    expect(getSubscriptionBarWidth(0)).toBe('0%');
  });

  it('should cap width at 100%', () => {
    expect(getSubscriptionBarWidth(20, 10)).toBe('100%');
  });

  it('should calculate proportional width', () => {
    expect(getSubscriptionBarWidth(5, 10)).toBe('50%');
  });

  it('should handle string values', () => {
    expect(getSubscriptionBarWidth('5', 10)).toBe('50%');
  });
});

describe('calculateAnchorAllocationPercentage', () => {
  it('should calculate percentage correctly', () => {
    const percentage = calculateAnchorAllocationPercentage(30, 100);
    expect(percentage).toBe(30);
  });

  it('should return null for missing values', () => {
    expect(calculateAnchorAllocationPercentage(null, 100)).toBeNull();
    expect(calculateAnchorAllocationPercentage(30, null)).toBeNull();
    expect(calculateAnchorAllocationPercentage(null, null)).toBeNull();
  });

  it('should return null for zero issue size', () => {
    expect(calculateAnchorAllocationPercentage(30, 0)).toBeNull();
  });

  it('should handle string values', () => {
    const percentage = calculateAnchorAllocationPercentage('30', '100');
    expect(percentage).toBe(30);
  });
});

describe('isStrongAnchorAllocation', () => {
  it('should return true for allocation > 30%', () => {
    expect(isStrongAnchorAllocation(35)).toBe(true);
    expect(isStrongAnchorAllocation(50)).toBe(true);
  });

  it('should return false for allocation <= 30%', () => {
    expect(isStrongAnchorAllocation(30)).toBe(false);
    expect(isStrongAnchorAllocation(25)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isStrongAnchorAllocation(null)).toBe(false);
  });
});

describe('LocalStorage functions', () => {
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('saveViewPreference', () => {
    it('should save preference to localStorage', () => {
      saveViewPreference('detailed');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        SUBSCRIPTION_VIEW_STORAGE_KEY,
        'detailed'
      );
    });

    it('should handle errors gracefully', () => {
      vi.mocked(localStorage.setItem).mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => saveViewPreference('simple')).not.toThrow();
    });
  });

  describe('getViewPreference', () => {
    it('should return stored preference', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('detailed');
      expect(getViewPreference()).toBe('detailed');
    });

    it('should return simple as default', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      expect(getViewPreference()).toBe('simple');
    });

    it('should handle errors gracefully', () => {
      vi.mocked(localStorage.getItem).mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(getViewPreference()).toBe('simple');
    });
  });
});

describe('CATEGORY_DESCRIPTIONS', () => {
  it('should have descriptions for all categories', () => {
    expect(CATEGORY_DESCRIPTIONS.qib).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.bNII).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.sNII).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.retailHNI).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.retailOthers).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.anchor).toBeDefined();
    expect(CATEGORY_DESCRIPTIONS.employee).toBeDefined();
  });

  it('should have meaningful descriptions', () => {
    expect(CATEGORY_DESCRIPTIONS.qib.length).toBeGreaterThan(20);
    expect(CATEGORY_DESCRIPTIONS.anchor.length).toBeGreaterThan(20);
  });
});
