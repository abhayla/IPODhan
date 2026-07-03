/**
 * Unit Tests for UpcomingIPOTable Component
 *
 * Tests rendering, status text logic, date formatting,
 * navigation links, empty states, and accessibility
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpcomingIPOTable } from '@/components/home/UpcomingIPOTable';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';

// ==================== MOCK DATA ====================

const mockMainboardUpcomingIPO: HomeIPOTableData = {
  id: 'mb-upcoming-1',
  companyName: 'Mainboard Upcoming Company',
  slug: 'mainboard-upcoming-company',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-10-15',
  closeDate: '2025-10-18',
  issuePrice: 300,
  issueSize: '1500',
  listingDate: null,
  status: 'UPCOMING',
};

const mockSMEUpcomingIPO: HomeIPOTableData = {
  id: 'sme-upcoming-1',
  companyName: 'SME Upcoming Company',
  slug: 'sme-upcoming-company',
  segment: 'SME' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-10-20',
  closeDate: '2025-10-22',
  issuePrice: 80,
  issueSize: '200',
  listingDate: null,
  status: 'UPCOMING',
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

describe('UpcomingIPOTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== RENDERING TESTS ====================

  describe('Rendering', () => {
    it('should render table with title and data', () => {
      render(
        <UpcomingIPOTable
          title="Upcoming Mainboard IPOs (Filed with SEBI)"
          ipos={[mockMainboardUpcomingIPO, mockSMEUpcomingIPO]}
          moreLink="/dashboard?category=mainboard&status=upcoming"
          moreLinkText="More Upcoming Mainline IPO..."
          isLoading={false}
        />
      );

      // AC#1: Components render correctly with proper data
      expect(screen.getByText('Upcoming Mainboard IPOs (Filed with SEBI)')).toBeInTheDocument();
      expect(screen.getByText('Mainboard Upcoming Company')).toBeInTheDocument();
      expect(screen.getByText('SME Upcoming Company')).toBeInTheDocument();
    });

    it('should render all three column headers', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Company Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('should render company names as clickable links', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const link = screen.getByRole('link', { name: 'Mainboard Upcoming Company' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/ipos/mainboard-upcoming-company');
    });

    it('should render "More..." link with correct href', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard?category=mainboard&status=upcoming"
          moreLinkText="More Upcoming Mainline IPO..."
          isLoading={false}
        />
      );

      // AC#4: "More..." links navigate to dashboard with correct filters
      const moreLink = screen.getByRole('link', { name: /More Upcoming Mainline IPO.../i });
      expect(moreLink).toBeInTheDocument();
      expect(moreLink).toHaveAttribute('href', '/dashboard?category=mainboard&status=upcoming');
    });
  });

  // ==================== STATUS TEXT TESTS ====================

  describe('Status Text Logic', () => {
    it('should display "Filed with SEBI" for MAINBOARD IPOs', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#1: Status text logic works correctly
      expect(screen.getByText('Filed with SEBI')).toBeInTheDocument();
    });

    it('should display "Filed with Exchange" for SME IPOs', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockSMEUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#1: Status text logic works correctly
      expect(screen.getByText('Filed with Exchange')).toBeInTheDocument();
    });

    it('should display correct status for mixed categories', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO, mockSMEUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Filed with SEBI')).toBeInTheDocument();
      expect(screen.getByText('Filed with Exchange')).toBeInTheDocument();
    });
  });

  // ==================== DATE FORMATTING TESTS ====================

  describe('Date Formatting', () => {
    it('should format dates as "dd MMM"', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[
            {
              ...mockMainboardUpcomingIPO,
              openDate: '2025-10-27',
            },
          ]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('27 Oct')).toBeInTheDocument();
    });

    it('should display "N/A" for null dates', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockIPOWithNullDates]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const cells = screen.getAllByText('N/A');
      expect(cells.length).toBeGreaterThanOrEqual(1); // Date column
    });

    it('should format different months correctly', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[
            {
              ...mockMainboardUpcomingIPO,
              id: 'test-1',
              openDate: '2025-03-15',
            },
            {
              ...mockMainboardUpcomingIPO,
              id: 'test-2',
              openDate: '2025-12-25',
            },
          ]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('15 Mar')).toBeInTheDocument();
      expect(screen.getByText('25 Dec')).toBeInTheDocument();
    });
  });

  // ==================== LOADING STATE TESTS ====================

  describe('Loading State', () => {
    it('should render skeleton when isLoading is true', () => {
      const { container } = render(
        <UpcomingIPOTable
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
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={true}
        />
      );

      expect(screen.queryByText('Mainboard Upcoming Company')).not.toBeInTheDocument();
    });
  });

  // ==================== EMPTY STATE TESTS ====================

  describe('Empty State', () => {
    it('should display "No IPOs available" when ipos array is empty', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#8: Empty states handled gracefully
      expect(screen.getByText('Nothing filed yet')).toBeInTheDocument();
    });

    it('should still render title when empty', () => {
      render(
        <UpcomingIPOTable
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
        <UpcomingIPOTable
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
        <UpcomingIPOTable
          title="Upcoming Mainboard IPOs (Filed with SEBI)"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#7: Tables have proper ARIA labels
      const table = screen.getByRole('table', { name: 'Upcoming Mainboard IPOs (Filed with SEBI)' });
      expect(table).toBeInTheDocument();
    });

    it('should have proper table header scopes', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#7: Semantic markup with scope="col"
      const headers = container.querySelectorAll('th[scope="col"]');
      expect(headers.length).toBe(3); // Company Name, Status, Date
    });

    it('should have semantic table structure', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Company Name Status Date/i })).toBeInTheDocument();
    });
  });

  // ==================== RESPONSIVE DESIGN TESTS ====================

  describe('Responsive Design', () => {
    it('should apply responsive text classes', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // AC#3: Responsive design with text-sm md:text-base
      const companyLink = screen.getByRole('link', { name: 'Mainboard Upcoming Company' });
      expect(companyLink.className).toMatch(/text-sm md:text-base/);
    });

    it('should apply responsive heading classes', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
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
    it('should render multiple upcoming IPOs correctly', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO, mockSMEUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Mainboard Upcoming Company')).toBeInTheDocument();
      expect(screen.getByText('SME Upcoming Company')).toBeInTheDocument();
    });

    it('should handle 10+ IPOs in table', () => {
      const manyIPOs = Array.from({ length: 10 }, (_, i) => ({
        ...mockMainboardUpcomingIPO,
        id: `ipo-${i}`,
        companyName: `Company ${i}`,
        slug: `company-${i}`,
      }));

      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={manyIPOs}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('Company 0')).toBeInTheDocument();
      expect(screen.getByText('Company 9')).toBeInTheDocument();
    });
  });

  // ==================== HOVER STATE TESTS ====================

  describe('Hover States', () => {
    it('should apply hover class to table rows', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const tableRow = container.querySelector('tbody tr');
      expect(tableRow).toHaveClass('hover:bg-muted/50');
    });
  });

  // ==================== EDGE CASES ====================

  describe('Edge Cases', () => {
    it('should handle invalid date strings gracefully', () => {
      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[
            {
              ...mockMainboardUpcomingIPO,
              openDate: 'invalid-date',
            },
          ]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('should handle very long company names', () => {
      const longNameIPO = {
        ...mockMainboardUpcomingIPO,
        companyName: 'Very Long Company Name That Should Still Display Properly Without Breaking Layout',
      };

      render(
        <UpcomingIPOTable
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
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
        />
      );

      expect(screen.getByText('Mainboard Upcoming Company')).toBeInTheDocument();
    });

    it('should handle mixed category types correctly', () => {
      // Component keys status text off `segment` (not the old `category` field);
      // a non-MAINBOARD segment renders "Filed with Exchange".
      const unknownCategoryIPO = {
        ...mockMainboardUpcomingIPO,
        segment: 'UNKNOWN' as never,
      };

      render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[unknownCategoryIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      // Should default to "Filed with Exchange" for non-MAINBOARD
      expect(screen.getByText('Filed with Exchange')).toBeInTheDocument();
    });
  });

  // ==================== STYLING TESTS ====================

  describe('Styling', () => {
    it('should apply muted text color to status column', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const statusCell = screen.getByText('Filed with SEBI').closest('td');
      expect(statusCell).toHaveClass('text-muted-foreground');
    });

    it('should have proper spacing between title and table', () => {
      const { container } = render(
        <UpcomingIPOTable
          title="Test Table"
          ipos={[mockMainboardUpcomingIPO]}
          moreLink="/dashboard"
          moreLinkText="More..."
          isLoading={false}
        />
      );

      const wrapper = container.querySelector('.space-y-4');
      expect(wrapper).toBeInTheDocument();
    });
  });
});
