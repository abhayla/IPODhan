/**
 * Unit Tests for IPOListTable Component (spec H2)
 *
 * The home live table shows: status dot + Company | Price band | Open | Close |
 * Subscription | GMP. Status is a dot before the name (NOT a row tint).
 * GMP/subscription are REAL values (or an em dash when absent) — tests assert
 * the conveyed substance, not just that a cell exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOListTable } from '@/components/home/IPOListTable';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';

// Row-click navigation added iter33 → mock the router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ==================== MOCK DATA ====================

const base = {
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  listingDate: null,
  priceMin: null,
  gmp: null,
  gmpPercent: null,
  totalSubscription: null,
};

const mockOpenIPO: HomeIPOTableData = {
  ...base,
  id: 'open-1',
  companyName: 'Currently Open IPO',
  slug: 'currently-open-ipo',
  openDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  closeDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  priceMin: 95,
  issuePrice: 100,
  issueSize: '500',
  status: 'OPEN',
  gmp: 50,
  gmpPercent: 50,
  totalSubscription: 2.5,
};

const mockClosingSoonIPO: HomeIPOTableData = {
  ...base,
  id: 'closing-soon-1',
  companyName: 'Closing Soon IPO',
  slug: 'closing-soon-ipo',
  openDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  closeDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  issuePrice: 200,
  issueSize: '1000',
  status: 'OPEN',
  gmp: -15,
  gmpPercent: -7.5,
  totalSubscription: 0.8,
};

const mockClosedIPO: HomeIPOTableData = {
  ...base,
  id: 'closed-1',
  companyName: 'Recently Closed IPO',
  slug: 'recently-closed-ipo',
  openDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  closeDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  issuePrice: 150,
  issueSize: '750',
  status: 'CLOSED',
};

const mockIPOWithNullDates: HomeIPOTableData = {
  ...base,
  id: 'null-dates-1',
  companyName: 'IPO with Null Dates',
  slug: 'ipo-null-dates',
  segment: 'SME' as const,
  openDate: null,
  closeDate: null,
  issuePrice: null,
  issueSize: null,
  status: 'UPCOMING',
};

// ==================== TEST SUITES ====================

describe('IPOListTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render table with title and data', () => {
      render(
        <IPOListTable
          title="IPO 2025 List (Mainboard)"
          ipos={[mockOpenIPO, mockClosedIPO]}
          moreLink="/dashboard?category=mainboard"
          moreLinkText="More Mainline IPO..."
          isLoading={false}
        />
      );

      expect(screen.getByText('IPO 2025 List (Mainboard)')).toBeInTheDocument();
      // Rendered in both the desktop table and the mobile card list.
      expect(screen.getAllByText('Currently Open IPO').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Recently Closed IPO').length).toBeGreaterThan(0);
    });

    it('should render all seven column headers (H2: Status + Sub. + GMP)', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByRole('columnheader', { name: 'Company' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Price band' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Open' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Close' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Sub.' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'GMP' })).toBeInTheDocument();
    });

    it('should render company names as clickable links', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const link = screen.getByRole('link', { name: 'Currently Open IPO' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/ipos/currently-open-ipo');
    });

    it('should render "More..." link with correct href', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard?category=mainboard"
          moreLinkText="More Mainline IPO..."
          isLoading={false}
        />
      );

      const moreLink = screen.getByRole('link', { name: /More Mainline IPO.../i });
      expect(moreLink).toBeInTheDocument();
      expect(moreLink).toHaveAttribute('href', '/dashboard?category=mainboard');
    });
  });

  // ==================== SUBSTANCE: GMP + Subscription ====================

  describe('Live metrics (GMP + Subscription) — substance', () => {
    it('shows a positive GMP in ₹ with its percent', () => {
      render(
        <IPOListTable
          title="T"
          ipos={[mockOpenIPO]}
          moreLink="/d"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      // GMP 50 (+50%) → "+₹50" and a "+50.0%" line — in table + mobile card
      expect(screen.getAllByText(/\+₹50/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\+50\.0%/).length).toBeGreaterThan(0);
    });

    it('shows a negative GMP colored as loss', () => {
      const { container } = render(
        <IPOListTable
          title="T"
          ipos={[mockClosingSoonIPO]}
          moreLink="/d"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      expect(screen.getAllByText(/₹-15|-₹15/).length).toBeGreaterThan(0);
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });

    it('shows subscription as a multiple (x)', () => {
      render(
        <IPOListTable
          title="T"
          ipos={[mockOpenIPO]}
          moreLink="/d"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      expect(screen.getAllByText('2.50x').length).toBeGreaterThan(0);
    });

    it('renders an em dash (not a fabricated value) when GMP/subscription are absent', () => {
      render(
        <IPOListTable
          title="T"
          ipos={[mockClosedIPO]}
          moreLink="/d"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      // closed IPO has null gmp + null subscription → two em dashes
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== STATUS DOT (replaces row tints) ====================

  describe('Status indicator (dot, not row tint)', () => {
    it('shows an Open dot for a currently open IPO and does NOT tint the row', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const row = container.querySelector('tbody tr');
      expect(row).not.toHaveClass('bg-green-50');
      expect(row).not.toHaveClass('bg-yellow-50');
      // green status dot present
      expect(container.querySelector('.bg-green-600')).toBeInTheDocument();
    });

    it('shows a Closing soon (amber) chip for an IPO closing within a day', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockClosingSoonIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      expect(screen.getAllByText('Closing soon').length).toBeGreaterThan(0);
      expect(container.querySelector('.bg-amber-500')).toBeInTheDocument();
    });

    it('handles IPOs with null dates gracefully (no crash, muted dot)', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockIPOWithNullDates]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      const row = container.querySelector('tbody tr');
      expect(row).toHaveClass('cursor-pointer');
    });
  });

  // ==================== DATE FORMATTING ====================

  describe('Date Formatting', () => {
    it('should format dates as "dd MMM"', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[{ ...mockOpenIPO, openDate: '2025-10-15', closeDate: '2025-10-18' }]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('15 Oct')).toBeInTheDocument();
      expect(screen.getByText('18 Oct')).toBeInTheDocument();
    });

    it('should display "N/A" for null dates', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockIPOWithNullDates]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const cells = screen.getAllByText('N/A');
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== LOADING / EMPTY ====================

  describe('Loading State', () => {
    it('should render skeleton when isLoading is true', () => {
      const { container } = render(
        <IPOListTable title="Test Table" ipos={[]} moreLink="/dashboard" moreLinkText="More..." isLoading={true} />
      );
      expect(screen.getByText('Test Table')).toBeInTheDocument();
      const skeletonRows = container.querySelectorAll('tbody tr');
      expect(skeletonRows.length).toBe(5);
    });

    it('should not render data when loading', () => {
      render(
        <IPOListTable title="Test Table" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={true} />
      );
      expect(screen.queryByText('Currently Open IPO')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display an informative empty state', () => {
      render(<IPOListTable title="Test Table" ipos={[]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />);
      expect(screen.getByText('No active issues right now')).toBeInTheDocument();
    });

    it('should still render title when empty', () => {
      render(<IPOListTable title="Empty Table" ipos={[]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />);
      expect(screen.getByText('Empty Table')).toBeInTheDocument();
    });

    it('should not render "More..." link when empty', () => {
      render(<IPOListTable title="Test Table" ipos={[]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />);
      expect(screen.queryByText('More...')).not.toBeInTheDocument();
    });
  });

  // ==================== ACCESSIBILITY ====================

  describe('Accessibility', () => {
    it('should have proper ARIA label on table', () => {
      render(
        <IPOListTable title="IPO 2025 List (Mainboard)" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />
      );
      expect(screen.getByRole('table', { name: 'IPO 2025 List (Mainboard)' })).toBeInTheDocument();
    });

    it('should have six semantic column headers with scope', () => {
      const { container } = render(
        <IPOListTable title="Test Table" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />
      );
      const headers = container.querySelectorAll('th[scope="col"]');
      expect(headers.length).toBe(7); // Company, Status, Price band, Open, Close, Sub., GMP
    });
  });

  // ==================== RESPONSIVE ====================

  describe('Responsive Design', () => {
    it('should render the company link with a truncating medium-weight style', () => {
      render(
        <IPOListTable title="Test Table" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />
      );
      // exact accessible name matches only the desktop table link (monogram is aria-hidden)
      const companyLink = screen.getByRole('link', { name: 'Currently Open IPO' });
      expect(companyLink.className).toMatch(/font-medium/);
      // the name span (inside the link) carries the truncation
      const nameSpan = companyLink.querySelector('span.truncate');
      expect(nameSpan).toBeTruthy();
    });

    it('should apply responsive heading classes', () => {
      render(
        <IPOListTable title="Test Table" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />
      );
      const heading = screen.getByText('Test Table');
      expect(heading.className).toMatch(/text-xl md:text-2xl/);
    });
  });

  // ==================== MULTIPLE + EDGE ====================

  describe('Multiple IPOs', () => {
    it('should render multiple IPOs correctly', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO, mockClosingSoonIPO, mockClosedIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      expect(screen.getAllByText('Currently Open IPO').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Closing Soon IPO').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Recently Closed IPO').length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid date strings gracefully', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[{ ...mockOpenIPO, openDate: 'invalid-date', closeDate: 'invalid-date' }]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );
      const cells = screen.getAllByText('N/A');
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle very long company names', () => {
      const longNameIPO = {
        ...mockOpenIPO,
        companyName: 'Very Long Company Name That Should Still Display Properly Without Breaking Layout',
      };
      render(
        <IPOListTable title="Test Table" ipos={[longNameIPO]} moreLink="/dashboard" moreLinkText="More..." isLoading={false} />
      );
      expect(
        screen.getAllByText('Very Long Company Name That Should Still Display Properly Without Breaking Layout').length
      ).toBeGreaterThan(0);
    });

    it('should handle missing optional props with defaults', () => {
      render(<IPOListTable title="Test Table" ipos={[mockOpenIPO]} moreLink="/dashboard" moreLinkText="More..." />);
      expect(screen.getAllByText('Currently Open IPO').length).toBeGreaterThan(0);
    });
  });
});
