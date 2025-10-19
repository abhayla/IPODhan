/**
 * Unit Tests for IPOListTable Component
 *
 * Tests rendering, color-coding logic, date formatting,
 * navigation links, empty states, and accessibility
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOListTable } from '@/components/home/IPOListTable';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';

// ==================== MOCK DATA ====================

const mockOpenIPO: HomeIPOTableData = {
  id: 'open-1',
  companyName: 'Currently Open IPO',
  slug: 'currently-open-ipo',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Started 1 day ago
  closeDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Closes in 5 days (not closing soon)
  issuePrice: 100,
  issueSize: '500',
  listingDate: null,
  status: 'OPEN',
};

const mockClosingSoonIPO: HomeIPOTableData = {
  id: 'closing-soon-1',
  companyName: 'Closing Soon IPO',
  slug: 'closing-soon-ipo',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Started 3 days ago
  closeDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Closes in 1 day
  issuePrice: 200,
  issueSize: '1000',
  listingDate: null,
  status: 'OPEN',
};

const mockClosedIPO: HomeIPOTableData = {
  id: 'closed-1',
  companyName: 'Recently Closed IPO',
  slug: 'recently-closed-ipo',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Started 20 days ago
  closeDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Closed 10 days ago
  issuePrice: 150,
  issueSize: '750',
  listingDate: null,
  status: 'CLOSED',
};

const mockIPOWithNullDates: HomeIPOTableData = {
  id: 'null-dates-1',
  companyName: 'IPO with Null Dates',
  slug: 'ipo-null-dates',
  segment: 'SME' as const,
  offeringType: 'IPO' as const,
  openDate: null,
  closeDate: null,
  issuePrice: null,
  issueSize: null,
  listingDate: null,
  status: 'UPCOMING',
};

// ==================== TEST SUITES ====================

describe('IPOListTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== RENDERING TESTS ====================

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

      // AC#1: Components render correctly
      expect(screen.getByText('IPO 2025 List (Mainboard)')).toBeInTheDocument();
      expect(screen.getByText('Currently Open IPO')).toBeInTheDocument();
      expect(screen.getByText('Recently Closed IPO')).toBeInTheDocument();
    });

    it('should render all three column headers', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Issuer Company')).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Close')).toBeInTheDocument();
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

      // AC#4: "More..." links navigate to dashboard with correct filters
      const moreLink = screen.getByRole('link', { name: /More Mainline IPO.../i });
      expect(moreLink).toBeInTheDocument();
      expect(moreLink).toHaveAttribute('href', '/dashboard?category=mainboard');
    });
  });

  // ==================== COLOR-CODING TESTS ====================

  describe('Color-Coding Logic', () => {
    it('should apply green styling for currently open IPOs', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#2: Color-coding works based on date logic (green for open)
      const tableRow = container.querySelector('tbody tr');
      expect(tableRow).toHaveClass('bg-green-50');
      expect(tableRow).toHaveClass('border-green-500');
    });

    it('should apply yellow styling for IPOs closing within 2 days', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockClosingSoonIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#2: Color-coding works based on date logic (yellow for closing soon)
      const tableRow = container.querySelector('tbody tr');
      expect(tableRow).toHaveClass('bg-yellow-50');
      expect(tableRow).toHaveClass('border-yellow-500');
    });

    it('should apply default styling for closed IPOs', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockClosedIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#2: Color-coding works based on date logic (white/default for closed)
      const tableRow = container.querySelector('tbody tr');
      expect(tableRow).not.toHaveClass('bg-green-50');
      expect(tableRow).not.toHaveClass('bg-yellow-50');
      expect(tableRow).toHaveClass('hover:bg-muted/50');
    });

    it('should handle IPOs with null dates gracefully', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockIPOWithNullDates]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const tableRow = container.querySelector('tbody tr');
      expect(tableRow).toHaveClass('hover:bg-muted/50');
    });
  });

  // ==================== DATE FORMATTING TESTS ====================

  describe('Date Formatting', () => {
    it('should format dates as "dd MMM"', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[
            {
              ...mockOpenIPO,
              openDate: '2025-10-15',
              closeDate: '2025-10-18',
            },
          ]}
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
      expect(cells.length).toBeGreaterThanOrEqual(2); // Open and Close columns
    });
  });

  // ==================== LOADING STATE TESTS ====================

  describe('Loading State', () => {
    it('should render skeleton when isLoading is true', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={true}
        />
      );

      // AC#6: Loading states display properly
      expect(screen.getByText('Test Table')).toBeInTheDocument();

      // Check for skeleton rows
      const skeletonRows = container.querySelectorAll('tbody tr');
      expect(skeletonRows.length).toBe(5); // IPOTableSkeleton shows 5 rows
    });

    it('should not render data when loading', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={true}
        />
      );

      expect(screen.queryByText('Currently Open IPO')).not.toBeInTheDocument();
    });
  });

  // ==================== EMPTY STATE TESTS ====================

  describe('Empty State', () => {
    it('should display "No IPOs available" when ipos array is empty', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#8: Empty states handled gracefully
      expect(screen.getByText('No IPOs available')).toBeInTheDocument();
    });

    it('should still render title when empty', () => {
      render(
        <IPOListTable
          title="Empty Table"
          ipos={[]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Empty Table')).toBeInTheDocument();
    });

    it('should not render "More..." link when empty', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.queryByText('More...')).not.toBeInTheDocument();
    });
  });

  // ==================== ACCESSIBILITY TESTS ====================

  describe('Accessibility', () => {
    it('should have proper ARIA label on table', () => {
      render(
        <IPOListTable
          title="IPO 2025 List (Mainboard)"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#7: Tables have proper ARIA labels
      const table = screen.getByRole('table', { name: 'IPO 2025 List (Mainboard)' });
      expect(table).toBeInTheDocument();
    });

    it('should have proper table header scopes', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#7: Semantic markup with scope="col"
      const headers = container.querySelectorAll('th[scope="col"]');
      expect(headers.length).toBe(3); // Issuer Company, Open, Close
    });

    it('should have semantic table structure', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Issuer Company Open Close/i })).toBeInTheDocument();
    });
  });

  // ==================== RESPONSIVE DESIGN TESTS ====================

  describe('Responsive Design', () => {
    it('should apply responsive text classes', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#3: Responsive design with text-sm md:text-base
      const companyLink = screen.getByRole('link', { name: 'Currently Open IPO' });
      expect(companyLink.className).toMatch(/text-sm md:text-base/);
    });

    it('should apply responsive heading classes', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const heading = screen.getByText('Test Table');
      expect(heading.className).toMatch(/text-xl md:text-2xl/);
    });
  });

  // ==================== MULTIPLE IPOS TESTS ====================

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

      expect(screen.getByText('Currently Open IPO')).toBeInTheDocument();
      expect(screen.getByText('Closing Soon IPO')).toBeInTheDocument();
      expect(screen.getByText('Recently Closed IPO')).toBeInTheDocument();
    });

    it('should apply different colors to different IPOs', () => {
      const { container } = render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO, mockClosingSoonIPO, mockClosedIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveClass('bg-green-50'); // Open
      expect(rows[1]).toHaveClass('bg-yellow-50'); // Closing soon
      expect(rows[2]).toHaveClass('hover:bg-muted/50'); // Closed
    });
  });

  // ==================== EDGE CASES ====================

  describe('Edge Cases', () => {
    it('should handle invalid date strings gracefully', () => {
      render(
        <IPOListTable
          title="Test Table"
          ipos={[
            {
              ...mockOpenIPO,
              openDate: 'invalid-date',
              closeDate: 'invalid-date',
            },
          ]}
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
        <IPOListTable
          title="Test Table"
          ipos={[longNameIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(
        screen.getByText('Very Long Company Name That Should Still Display Properly Without Breaking Layout')
      ).toBeInTheDocument();
    });

    it('should handle missing optional props with defaults', () => {
      // isLoading defaults to false
      render(
        <IPOListTable
          title="Test Table"
          ipos={[mockOpenIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
        />
      );

      expect(screen.getByText('Currently Open IPO')).toBeInTheDocument();
    });
  });
});
