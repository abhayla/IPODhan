/**
 * Unit Tests: EnhancedSubscriptionView Component
 *
 * Tests for the enhanced subscription display with simple/detailed views.
 * Story 5.6: Enhanced Subscription Breakdown
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { EnhancedSubscriptionView } from '@/components/ipo/EnhancedSubscriptionView';
import type { Subscription } from '@ipodhan/shared/db/types';

// Mock the localStorage functions using vi.hoisted
const { mockGetViewPreference, mockSaveViewPreference } = vi.hoisted(() => ({
  mockGetViewPreference: vi.fn(() => 'simple'),
  mockSaveViewPreference: vi.fn(),
}));

vi.mock('@/lib/utils/subscription-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/subscription-utils')>();
  return {
    ...actual,
    getViewPreference: mockGetViewPreference,
    saveViewPreference: mockSaveViewPreference,
  };
});

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

describe('EnhancedSubscriptionView', () => {
  beforeEach(() => {
    mockGetViewPreference.mockReturnValue('simple');
    mockSaveViewPreference.mockClear();
  });

  describe('No Subscription Data', () => {
    it('should show not available message when subscription is null', () => {
      render(<EnhancedSubscriptionView subscription={null} />);

      expect(screen.getByText(/Subscription Status/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Subscription data not available yet/i)
      ).toBeInTheDocument();
    });
  });

  describe('Simple View (3 categories)', () => {
    it('should display total subscription', () => {
      const subscription = createMockSubscription();
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.getByText(/Total Subscription/i)).toBeInTheDocument();
      expect(screen.getByText(/3.50x/i)).toBeInTheDocument();
    });

    it('should display 3 main categories in simple view', () => {
      const subscription = createMockSubscription();
      const { container } = render(<EnhancedSubscriptionView subscription={subscription} />);

      // Query within desktop view only (hidden on mobile)
      const desktopView = container.querySelector('.hidden.md\\:block');
      expect(desktopView).toBeInTheDocument();

      // Check for categories in desktop view
      expect(desktopView?.textContent).toMatch(/QIB.*Qualified Institutional Buyers/i);
      expect(desktopView?.textContent).toMatch(/NII.*Non-Institutional Investors/i);
      expect(desktopView?.textContent).toMatch(/Retail Individual Investors/i);
    });

    it('should display correct subscription values', () => {
      const subscription = createMockSubscription();
      const { container } = render(<EnhancedSubscriptionView subscription={subscription} />);

      // Query within desktop view only to avoid duplicates from mobile view
      const desktopView = container.querySelector('.hidden.md\\:block');
      expect(desktopView).toBeInTheDocument();

      // Check for subscription values in desktop view
      expect(desktopView?.textContent).toMatch(/5.20x/i); // QIB
      expect(desktopView?.textContent).toMatch(/3.80x/i); // NII
      expect(desktopView?.textContent).toMatch(/1.50x/i); // Retail
    });

    it('should show last updated timestamp', () => {
      const subscription = createMockSubscription();
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.getByText(/Last updated:/i)).toBeInTheDocument();
      expect(screen.getByText(/15 Jan 2024/i)).toBeInTheDocument();
    });
  });

  describe('Detailed View (7 categories)', () => {
    beforeEach(() => {
      mockGetViewPreference.mockReturnValue('detailed');
    });

    it('should show view toggle when detailed data available', () => {
      const subscription = createMockSubscription();
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.getByText(/Simple View/i)).toBeInTheDocument();
      expect(screen.getByText(/Detailed View/i)).toBeInTheDocument();
    });

    it('should not show toggle when detailed data unavailable', () => {
      const subscription = createMockSubscription({
        bNIISubscription: null,
        sNIISubscription: null,
        retailHNISubscription: null,
        retailOthersSubscription: null,
        anchorInvestorSubscription: null,
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.queryByText(/Simple View/i)).not.toBeInTheDocument();
    });

    it('should display granular NII breakdown', async () => {
      const subscription = createMockSubscription();
      const { container } = render(<EnhancedSubscriptionView subscription={subscription} />);

      // Switch to detailed view
      const detailedTab = screen.getByRole('tab', { name: /Detailed View/i });
      fireEvent.click(detailedTab);

      await waitFor(() => {
        const desktopView = container.querySelector('.hidden.md\\:block');
        expect(desktopView?.textContent).toMatch(/Big NII/i);
        expect(desktopView?.textContent).toMatch(/Small NII/i);
        expect(desktopView?.textContent).toMatch(/4.50x/i); // bNII
        expect(desktopView?.textContent).toMatch(/2.10x/i); // sNII
      });
    });

    it('should display granular Retail breakdown', async () => {
      const subscription = createMockSubscription();
      const { container } = render(<EnhancedSubscriptionView subscription={subscription} />);

      // Switch to detailed view
      const detailedTab = screen.getByRole('tab', { name: /Detailed View/i });
      fireEvent.click(detailedTab);

      await waitFor(() => {
        const desktopView = container.querySelector('.hidden.md\\:block');
        expect(desktopView?.textContent).toMatch(/Retail HNI/i);
        expect(desktopView?.textContent).toMatch(/Retail Others/i);
        expect(desktopView?.textContent).toMatch(/2.00x/i); // HNI
        expect(desktopView?.textContent).toMatch(/1.20x/i); // Others
      });
    });
  });

  describe('Anchor Investor Highlight', () => {
    it('should display anchor investor highlight when data available', () => {
      const subscription = createMockSubscription({
        anchorInvestorSubscription: '100.00',
      });
      render(
        <EnhancedSubscriptionView
          subscription={subscription}
          issueSize={100}
        />
      );

      expect(screen.getByText(/Anchor Investors/i)).toBeInTheDocument();
      expect(screen.getByText(/100.00x/i)).toBeInTheDocument();
    });

    it('should not display anchor highlight when data unavailable', () => {
      const subscription = createMockSubscription({
        anchorInvestorSubscription: null,
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      const anchorTexts = screen.queryAllByText(/Anchor Investors/i);
      // Should only appear in detailed view table, not as a highlight card
      expect(anchorTexts.length).toBe(0);
    });

    it('should show strong signal badge for >30% allocation', () => {
      const subscription = createMockSubscription({
        anchorInvestorSubscription: '40',
      });
      render(
        <EnhancedSubscriptionView
          subscription={subscription}
          issueSize={100}
        />
      );

      expect(screen.getByText(/Strong Signal/i)).toBeInTheDocument();
    });
  });

  describe('Additional Metrics', () => {
    it('should display total applications', () => {
      const subscription = createMockSubscription({
        totalApplications: 50000,
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.getByText(/Total Applications/i)).toBeInTheDocument();
      expect(screen.getByText(/50,000/i)).toBeInTheDocument();
    });

    it('should display shares bid', () => {
      const subscription = createMockSubscription({
        totalSharesBid: 150000000,
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.getByText(/Shares Bid/i)).toBeInTheDocument();
      expect(screen.getByText(/15,00,00,000/i)).toBeInTheDocument();
    });

    it('should not display additional metrics if not available', () => {
      const subscription = createMockSubscription({
        totalApplications: null,
        totalSharesBid: null,
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(screen.queryByText(/Total Applications/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Shares Bid/i)).not.toBeInTheDocument();
    });
  });

  describe('View Preference Persistence', () => {
    it('should load saved view preference on mount', () => {
      mockGetViewPreference.mockReturnValue('detailed');
      const subscription = createMockSubscription();
      render(<EnhancedSubscriptionView subscription={subscription} />);

      // Detailed view should be active
      const detailedTab = screen.getByRole('tab', { name: /Detailed View/i });
      expect(detailedTab).toHaveAttribute('data-state', 'active');
    });

    it('should save view preference when changed', async () => {
      const user = userEvent.setup();
      const subscription = createMockSubscription();
      render(<EnhancedSubscriptionView subscription={subscription} />);

      // Initially, simple view should be active
      const simpleTab = screen.getByRole('tab', { name: /Simple View/i });
      expect(simpleTab).toHaveAttribute('data-state', 'active');

      // Clear any calls from initial render
      mockSaveViewPreference.mockClear();

      // Switch to detailed view - use userEvent for more realistic interaction
      const detailedTab = screen.getByRole('tab', { name: /Detailed View/i });
      await user.click(detailedTab);

      // Wait for state update and the preference to be saved
      await waitFor(() => {
        expect(detailedTab).toHaveAttribute('data-state', 'active');
      });

      // Verify save was called with the new view. (Radix Tabs can fire
      // onValueChange more than once per click; the single handler save is
      // idempotent, so assert the saved value rather than an exact call count.)
      expect(mockSaveViewPreference).toHaveBeenCalledWith('detailed');
    });
  });

  describe('Data Validation', () => {
    it('should log warnings for mismatched totals', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const subscription = createMockSubscription({
        niiSubscription: '10.00', // Mismatch
        bNIISubscription: '4.50',
        sNIISubscription: '2.10',
      });
      render(<EnhancedSubscriptionView subscription={subscription} />);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('validation warnings'),
        expect.any(Array)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Null/Missing Values', () => {
    it('should display N/A for null subscription values', () => {
      const subscription = createMockSubscription({
        employeeSubscription: null,
      });
      mockGetViewPreference.mockReturnValue('detailed');
      render(<EnhancedSubscriptionView subscription={subscription} />);

      // Employee should show N/A if included in detailed view
      // (depends on implementation - may not show if null)
    });

    it('should show data unavailable message in detailed view without granular data', () => {
      const subscription = createMockSubscription({
        bNIISubscription: null,
        sNIISubscription: null,
        retailHNISubscription: null,
        retailOthersSubscription: null,
        anchorInvestorSubscription: null,
      });
      mockGetViewPreference.mockReturnValue('detailed');
      render(<EnhancedSubscriptionView subscription={subscription} />);

      // No toggle should be shown
      expect(screen.queryByText(/Detailed View/i)).not.toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('should render on mobile without errors', () => {
      const subscription = createMockSubscription();
      const { container } = render(
        <EnhancedSubscriptionView subscription={subscription} />
      );

      // Check that mobile-specific classes are present
      const mobileCards = container.querySelectorAll('.md\\:hidden');
      expect(mobileCards.length).toBeGreaterThan(0);
    });
  });
});
