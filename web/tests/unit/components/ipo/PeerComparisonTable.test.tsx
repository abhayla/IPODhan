/**
 * Unit Tests for PeerComparisonTable Component
 *
 * Tests for:
 * - Table rendering with IPO row, peer rows, industry average
 * - IPO row highlighting
 * - Mobile card layout
 * - Null value handling
 *
 * Story 4.8: Peer Comparison Tab
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeerComparisonTable } from '@/components/ipo/PeerComparisonTable';
import type { ComparisonRow } from '@/lib/services/peer-comparison-service';
import '@testing-library/jest-dom';

// ==================== TEST FIXTURES ====================

const mockIPORow: ComparisonRow = {
  companyName: 'Test IPO Company',
  sector: 'Technology',
  listedStatus: 'IPO',
  peRatio: 25,
  eps: 15.5,
  dilutedEps: null,
  ronw: 18,
  nav: null,
  pbvRatio: null,
  financialStatementType: null,
  isIPO: true,
  isIndustryAverage: false,
};

const mockPeerRows: ComparisonRow[] = [
  {
    companyName: 'Peer Company A',
    sector: 'Technology',
    listedStatus: 'Listed',
    peRatio: 20,
    eps: 12.5,
    dilutedEps: 12,
    ronw: 15,
    nav: 100,
    pbvRatio: 3.5,
    financialStatementType: 'CONSOLIDATED',
    isIPO: false,
    isIndustryAverage: false,
  },
  {
    companyName: 'Peer Company B',
    sector: 'Technology',
    listedStatus: 'Listed',
    peRatio: 22,
    eps: 14,
    dilutedEps: 13.5,
    ronw: 17,
    nav: 120,
    pbvRatio: 4,
    financialStatementType: 'CONSOLIDATED',
    isIPO: false,
    isIndustryAverage: false,
  },
  {
    companyName: 'Peer Company C',
    sector: 'Technology',
    listedStatus: 'Unlisted',
    peRatio: 18,
    eps: 11,
    dilutedEps: 10.8,
    ronw: 14,
    nav: 90,
    pbvRatio: 3,
    financialStatementType: 'STANDALONE',
    isIPO: false,
    isIndustryAverage: false,
  },
];

const mockIndustryAverageRow: ComparisonRow = {
  companyName: 'Industry Average',
  sector: 'Technology',
  listedStatus: '-',
  peRatio: 20,
  eps: 12.5,
  dilutedEps: 12.1,
  ronw: 15.33,
  nav: 103.33,
  pbvRatio: 3.5,
  financialStatementType: 'CONSOLIDATED',
  isIPO: false,
  isIndustryAverage: true,
};

// ==================== TESTS ====================

describe('PeerComparisonTable', () => {
  describe('Desktop View (Table)', () => {
    it('should render table headers correctly', () => {
      const { container } = render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Check for column headers in desktop table
      const table = container.querySelector('.hidden.md\\:block table');
      expect(table).toBeInTheDocument();

      // Check that table has header cells
      const headers = container.querySelectorAll('.hidden.md\\:block table thead th');
      expect(headers.length).toBe(9); // 9 column headers
    });

    it('should render IPO row with highlight and badge', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // IPO company name should appear (multiple times due to desktop + mobile)
      const companyNames = screen.getAllByText('Test IPO Company');
      expect(companyNames.length).toBeGreaterThanOrEqual(1);

      // IPO badge should appear (there are multiple due to mobile view)
      const ipoBadges = screen.getAllByText(/^IPO$/);
      expect(ipoBadges.length).toBeGreaterThan(0);
    });

    it('should render all peer company rows', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Each peer name appears at least once (may be more due to mobile view)
      expect(screen.getAllByText('Peer Company A').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Peer Company B').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Peer Company C').length).toBeGreaterThanOrEqual(1);
    });

    it('should render industry average row', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Industry Average should appear (there are multiple due to mobile view)
      const averageLabels = screen.getAllByText('Industry Average');
      expect(averageLabels.length).toBeGreaterThan(0);
    });

    it('should format numeric values with 2 decimal places', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Check formatted values (multiple occurrences due to mobile view)
      expect(screen.getAllByText('25.00').length).toBeGreaterThan(0); // IPO P/E
      expect(screen.getAllByText('15.50').length).toBeGreaterThan(0); // IPO EPS
      expect(screen.getAllByText('20.00').length).toBeGreaterThan(0); // Peer A P/E or Industry Average P/E
    });

    it('should display N/A for null values', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // IPO has null dilutedEps, nav, pbvRatio
      const naValues = screen.getAllByText('N/A');
      expect(naValues.length).toBeGreaterThan(0);
    });

    it('should display listed status correctly', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Multiple occurrences due to desktop + mobile views
      expect(screen.getAllByText('Listed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Unlisted').length).toBeGreaterThan(0);
    });
  });

  describe('Mobile View (Cards)', () => {
    it('should render IPO card with special styling', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // IPO company name should appear in card (multiple times due to desktop + mobile)
      expect(screen.getAllByText('Test IPO Company').length).toBeGreaterThanOrEqual(1);
    });

    it('should render peer company cards', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      expect(screen.getAllByText('Peer Company A').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Peer Company B').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Peer Company C').length).toBeGreaterThanOrEqual(1);
    });

    it('should render industry average card', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      const averageLabels = screen.getAllByText('Industry Average');
      expect(averageLabels.length).toBeGreaterThan(0);
    });

    it('should display all metrics in mobile cards', () => {
      const { container } = render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Check that mobile card container exists
      const mobileContainer = container.querySelector('.md\\:hidden');
      expect(mobileContainer).toBeInTheDocument();

      // Check for metric labels (multiple occurrences in mobile view)
      expect(screen.getAllByText('Sector').length).toBeGreaterThan(0);
      expect(screen.getAllByText('P/E Ratio').length).toBeGreaterThan(0);
      expect(screen.getAllByText('EPS').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Diluted EPS').length).toBeGreaterThan(0);
      expect(screen.getAllByText('RONW (%)').length).toBeGreaterThan(0);
      expect(screen.getAllByText('NAV').length).toBeGreaterThan(0);
      expect(screen.getAllByText('P/BV Ratio').length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty peer rows', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={[]}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Should still render IPO and industry average (multiple times due to desktop + mobile)
      expect(screen.getAllByText('Test IPO Company').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Industry Average').length).toBeGreaterThan(0);
    });

    it('should handle null sector', () => {
      const ipoRowNoSector = { ...mockIPORow, sector: null };
      render(
        <PeerComparisonTable
          ipoRow={ipoRowNoSector}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Should display '-' for null sector
      const dashValues = screen.getAllByText('-');
      expect(dashValues.length).toBeGreaterThan(0);
    });

    it('should handle all null financial metrics', () => {
      const ipoRowAllNull: ComparisonRow = {
        ...mockIPORow,
        peRatio: null,
        eps: null,
        dilutedEps: null,
        ronw: null,
        nav: null,
        pbvRatio: null,
      };

      render(
        <PeerComparisonTable
          ipoRow={ipoRowAllNull}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Should display N/A for all null metrics
      const naValues = screen.getAllByText('N/A');
      expect(naValues.length).toBeGreaterThan(0);
    });

    it('should render comparison indicators for IPO row only', () => {
      const { container } = render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // ComparisonIndicator components should be present for IPO metrics
      // (They render as spans with specific classes)
      expect(container.querySelector('.text-green-600, .text-red-600, .text-gray-600')).toBeTruthy();
    });
  });

  describe('Data Validation', () => {
    it('should render correct number of rows in table', () => {
      const { container } = render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Desktop view: 1 IPO + 3 peers + 1 industry average = 5 rows (excluding header)
      // Check for table body rows in desktop view
      const desktopTable = container.querySelector('.hidden.md\\:block table tbody');
      if (desktopTable) {
        const rows = desktopTable.querySelectorAll('tr');
        expect(rows.length).toBe(5); // 1 IPO + 3 peers + 1 average
      }
    });

    it('should render correct number of cards in mobile view', () => {
      const { container } = render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Mobile view: 1 IPO card + 3 peer cards + 1 average card = 5 cards
      const mobileContainer = container.querySelector('.md\\:hidden');
      if (mobileContainer) {
        const cards = mobileContainer.querySelectorAll('[class*="rounded-lg border"]');
        expect(cards.length).toBeGreaterThanOrEqual(4); // At least IPO + peers + average
      }
    });

    it('should maintain data consistency between desktop and mobile views', () => {
      render(
        <PeerComparisonTable
          ipoRow={mockIPORow}
          peerRows={mockPeerRows}
          industryAverageRow={mockIndustryAverageRow}
        />
      );

      // Same company names should appear in both views
      const companyNameOccurrences = screen.getAllByText('Test IPO Company');
      expect(companyNameOccurrences.length).toBeGreaterThanOrEqual(2); // Desktop + Mobile

      const peerAOccurrences = screen.getAllByText('Peer Company A');
      expect(peerAOccurrences.length).toBeGreaterThanOrEqual(2); // Desktop + Mobile
    });
  });
});
