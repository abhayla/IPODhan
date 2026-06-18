/**
 * Unit Tests for HomeIPOTablesSection Component
 *
 * Tests rendering of all four tables, grid layout,
 * loading states, and proper data passing
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeIPOTablesSection } from '@/components/home/HomeIPOTablesSection';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';

// ==================== MOCK DATA ====================

const mockMainboardIPO: HomeIPOTableData = {
  id: 'mb-1',
  companyName: 'Mainboard Company',
  slug: 'mainboard-company',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-10-15',
  closeDate: '2025-10-18',
  issuePrice: 100,
  issueSize: '500',
  listingDate: null,
  status: 'OPEN',
};

const mockSMEIPO: HomeIPOTableData = {
  id: 'sme-1',
  companyName: 'SME Company',
  slug: 'sme-company',
  segment: 'SME' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-10-20',
  closeDate: '2025-10-22',
  issuePrice: 50,
  issueSize: '100',
  listingDate: null,
  status: 'OPEN',
};

const mockUpcomingMainboardIPO: HomeIPOTableData = {
  id: 'mb-up-1',
  companyName: 'Upcoming Mainboard Company',
  slug: 'upcoming-mainboard-company',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-11-01',
  closeDate: '2025-11-04',
  issuePrice: 300,
  issueSize: '1500',
  listingDate: null,
  status: 'UPCOMING',
};

const mockUpcomingSMEIPO: HomeIPOTableData = {
  id: 'sme-up-1',
  companyName: 'Upcoming SME Company',
  slug: 'upcoming-sme-company',
  segment: 'SME' as const,
  offeringType: 'IPO' as const,
  openDate: '2025-11-05',
  closeDate: '2025-11-07',
  issuePrice: 80,
  issueSize: '200',
  listingDate: null,
  status: 'UPCOMING',
};

// ==================== TEST SUITES ====================

const currentYear = new Date().getFullYear();

describe('HomeIPOTablesSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== RENDERING TESTS ====================

  describe('Rendering', () => {
    it('should render section heading "IPO 2025 Listings"', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      expect(screen.getByText(`IPO ${currentYear} Listings`)).toBeInTheDocument();
    });

    it('should render all four table titles', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#1: Four distinct table components render correctly
      expect(screen.getByText(`IPO ${currentYear} List (Mainboard)`)).toBeInTheDocument();
      expect(screen.getByText(`SME IPO ${currentYear} List`)).toBeInTheDocument();
      expect(screen.getByText('Upcoming Mainboard IPOs (Filed with SEBI)')).toBeInTheDocument();
      expect(screen.getByText('Upcoming SME IPOs (Filed with BSE/NSE)')).toBeInTheDocument();
    });

    it('should render all IPO data in respective tables', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#1: Components render correctly with proper data
      expect(screen.getByText('Mainboard Company')).toBeInTheDocument();
      expect(screen.getByText('SME Company')).toBeInTheDocument();
      expect(screen.getByText('Upcoming Mainboard Company')).toBeInTheDocument();
      expect(screen.getByText('Upcoming SME Company')).toBeInTheDocument();
    });

    it('should render all four "More..." links', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      expect(screen.getByRole('link', { name: /More Mainline IPO.../i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /More SME IPO.../i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /More Upcoming Mainline IPO.../i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /More Upcoming SME IPO.../i })).toBeInTheDocument();
    });
  });

  // ==================== NAVIGATION LINKS TESTS ====================

  describe('Navigation Links', () => {
    it('should have correct href for Mainboard active IPOs link', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      // AC#4: "More..." links navigate to dashboard with correct filters
      const link = screen.getByRole('link', { name: /More Mainline IPO.../i });
      expect(link).toHaveAttribute('href', '/dashboard?category=mainboard');
    });

    it('should have correct href for SME active IPOs link', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      const link = screen.getByRole('link', { name: /More SME IPO.../i });
      expect(link).toHaveAttribute('href', '/dashboard?category=sme');
    });

    it('should have correct href for Mainboard upcoming IPOs link', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      const link = screen.getByRole('link', { name: /More Upcoming Mainline IPO.../i });
      expect(link).toHaveAttribute('href', '/dashboard?category=mainboard&status=upcoming');
    });

    it('should have correct href for SME upcoming IPOs link', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      const link = screen.getByRole('link', { name: /More Upcoming SME IPO.../i });
      expect(link).toHaveAttribute('href', '/dashboard?category=sme&status=upcoming');
    });
  });

  // ==================== GRID LAYOUT TESTS ====================

  describe('Grid Layout', () => {
    it('should apply 2x2 grid layout classes', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#3: Responsive grid layout
      const gridContainer = container.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2');
      expect(gridContainer).toBeInTheDocument();
    });

    it('should have proper gap spacing between tables', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      const gridContainer = container.querySelector('.gap-8');
      expect(gridContainer).toBeInTheDocument();
    });
  });

  // ==================== LOADING STATE TESTS ====================

  describe('Loading State', () => {
    it('should show skeletons for all four tables when loading', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={true}
        />
      );

      // AC#6: Loading states display properly
      // Each skeleton has 5 rows, so 4 tables x 5 rows = 20 rows total
      const skeletonRows = container.querySelectorAll('tbody tr');
      expect(skeletonRows.length).toBe(20);
    });

    it('should show table titles even when loading', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={true}
        />
      );

      expect(screen.getByText(`IPO ${currentYear} List (Mainboard)`)).toBeInTheDocument();
      expect(screen.getByText(`SME IPO ${currentYear} List`)).toBeInTheDocument();
      expect(screen.getByText('Upcoming Mainboard IPOs (Filed with SEBI)')).toBeInTheDocument();
      expect(screen.getByText('Upcoming SME IPOs (Filed with BSE/NSE)')).toBeInTheDocument();
    });

    it('should not show actual data when loading', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={true}
        />
      );

      expect(screen.queryByText('Mainboard Company')).not.toBeInTheDocument();
      expect(screen.queryByText('SME Company')).not.toBeInTheDocument();
    });
  });

  // ==================== EMPTY STATE TESTS ====================

  describe('Empty State', () => {
    it('should show "No IPOs available" for empty mainboard table', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#8: Empty states handled gracefully
      // Should have at least one "No IPOs available" message
      const emptyMessages = screen.getAllByText('No IPOs available');
      expect(emptyMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle all tables being empty', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      const emptyMessages = screen.getAllByText('No IPOs available');
      expect(emptyMessages.length).toBe(4); // One for each table
    });

    it('should still show table titles when empty', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      expect(screen.getByText(`IPO ${currentYear} List (Mainboard)`)).toBeInTheDocument();
      expect(screen.getByText(`SME IPO ${currentYear} List`)).toBeInTheDocument();
    });
  });

  // ==================== ACCESSIBILITY TESTS ====================

  describe('Accessibility', () => {
    it('should have proper ARIA label on section', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#7: Proper ARIA labels and semantic markup
      const section = container.querySelector(`section[aria-label="IPO ${currentYear} Listings"]`);
      expect(section).toBeInTheDocument();
    });

    it('should have semantic heading hierarchy', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      const mainHeading = screen.getByRole('heading', { name: `IPO ${currentYear} Listings`, level: 1 });
      expect(mainHeading).toBeInTheDocument();

      const tableHeadings = screen.getAllByRole('heading', { level: 2 });
      expect(tableHeadings.length).toBe(4); // One for each table
    });

    it('should have all four tables accessible by role', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      const tables = screen.getAllByRole('table');
      expect(tables.length).toBe(4);
    });
  });

  // ==================== RESPONSIVE DESIGN TESTS ====================

  describe('Responsive Design', () => {
    it('should apply responsive heading classes', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      // AC#3: Responsive design
      const heading = screen.getByText(`IPO ${currentYear} Listings`);
      expect(heading.className).toMatch(/text-2xl md:text-3xl/);
    });

    it('should have responsive padding', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      const section = container.querySelector('section');
      expect(section).toHaveClass('px-4');
      expect(section).toHaveClass('py-8');
    });
  });

  // ==================== MULTIPLE IPOS TESTS ====================

  describe('Multiple IPOs per Table', () => {
    it('should handle multiple IPOs in each table', () => {
      const mainboardIPOs = [
        mockMainboardIPO,
        { ...mockMainboardIPO, id: 'mb-2', companyName: 'Second Mainboard', slug: 'second-mainboard' },
      ];

      const smeIPOs = [
        mockSMEIPO,
        { ...mockSMEIPO, id: 'sme-2', companyName: 'Second SME', slug: 'second-sme' },
      ];

      render(
        <HomeIPOTablesSection
          mainboardIPOs={mainboardIPOs}
          smeIPOs={smeIPOs}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={false}
        />
      );

      expect(screen.getByText('Mainboard Company')).toBeInTheDocument();
      expect(screen.getByText('Second Mainboard')).toBeInTheDocument();
      expect(screen.getByText('SME Company')).toBeInTheDocument();
      expect(screen.getByText('Second SME')).toBeInTheDocument();
    });
  });

  // ==================== INTEGRATION TESTS ====================

  describe('Integration', () => {
    it('should pass isLoading prop to all child tables', () => {
      const { container } = render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
          isLoading={true}
        />
      );

      // All tables should show skeletons
      const skeletonRows = container.querySelectorAll('tbody tr');
      expect(skeletonRows.length).toBe(20); // 4 tables x 5 skeleton rows
    });

    it('should handle mixed states (some tables with data, some empty)', () => {
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[]}
          isLoading={false}
        />
      );

      // Tables with data should show IPOs
      expect(screen.getByText('Mainboard Company')).toBeInTheDocument();
      expect(screen.getByText('Upcoming Mainboard Company')).toBeInTheDocument();

      // Empty tables should show empty state
      const emptyMessages = screen.getAllByText('No IPOs available');
      expect(emptyMessages.length).toBe(2); // SME tables are empty
    });
  });

  // ==================== EDGE CASES ====================

  describe('Edge Cases', () => {
    it('should handle missing optional isLoading prop with default', () => {
      // isLoading should default to false
      render(
        <HomeIPOTablesSection
          mainboardIPOs={[mockMainboardIPO]}
          smeIPOs={[mockSMEIPO]}
          upcomingMainboardIPOs={[mockUpcomingMainboardIPO]}
          upcomingSMEIPOs={[mockUpcomingSMEIPO]}
        />
      );

      expect(screen.getByText('Mainboard Company')).toBeInTheDocument();
    });

    it('should handle 10 IPOs in each table', () => {
      const tenIPOs = Array.from({ length: 10 }, (_, i) => ({
        ...mockMainboardIPO,
        id: `ipo-${i}`,
        companyName: `Company ${i}`,
        slug: `company-${i}`,
      }));

      render(
        <HomeIPOTablesSection
          mainboardIPOs={tenIPOs}
          smeIPOs={tenIPOs}
          upcomingMainboardIPOs={tenIPOs}
          upcomingSMEIPOs={tenIPOs}
          isLoading={false}
        />
      );

      // Should render all companies
      expect(screen.getAllByText(/Company \d/).length).toBeGreaterThanOrEqual(10);
    });
  });
});
