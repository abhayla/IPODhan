/**
 * Unit Tests for IssueStructureSection Component (Story 4.11)
 * Tests the main container component for issue structure display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IssueStructureSection } from '@/components/ipo/IssueStructureSection';
import type { IpoDetails } from '@/lib/repositories/types';

const mockIpoDetails: IpoDetails = {
  id: 'test-id',
  ipoId: 'ipo-id',
  issueType: 'BOOK_BUILDING',
  freshIssue: '300',
  ofsIssue: '200',
  minInvestment: '15000',
  cutOffPrice: '250',
  registrarLink: 'https://www.kfintech.com/ipostatus',
  isin: 'INE123456789',
  faceValue: '10',
  basisOfAllotmentDate: null,
  initiationOfRefundsDate: null,
  creditOfSharesDate: null,
  leadManagers: ['ICICI Securities', 'Kotak Mahindra'],
  exchanges: ['NSE', 'BSE'],
  companyDescription: 'Test Company Description',
  dataSource: 'TEST',
  lastVerifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('IssueStructureSection', () => {
  describe('Section Rendering', () => {
    it('should render section header', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('Issue Structure')).toBeInTheDocument();
      expect(screen.getByText('Detailed breakdown of the IPO offering mechanics')).toBeInTheDocument();
    });

    it('should render all sub-components when data is available', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      // Check for Issue Type Badge
      expect(screen.getByText('Book Building')).toBeInTheDocument();

      // Check for chart title
      expect(screen.getByText('Fresh Issue vs OFS Breakdown')).toBeInTheDocument();

      // Check for minimum investment
      expect(screen.getByText('Minimum Investment')).toBeInTheDocument();

      // Check for registrar link
      expect(screen.getByText('Check Allotment Status')).toBeInTheDocument();
    });
  });

  describe('Issue Type Display', () => {
    it('should display BOOK_BUILDING issue type', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('Issue Type')).toBeInTheDocument();
      expect(screen.getByText('Book Building')).toBeInTheDocument();
    });

    it('should display FIXED_PRICE issue type', () => {
      const fixedPriceDetails = { ...mockIpoDetails, issueType: 'FIXED_PRICE' as const };
      render(<IssueStructureSection ipoDetails={fixedPriceDetails} />);

      expect(screen.getByText('Fixed Price')).toBeInTheDocument();
    });

    it('should display HYBRID issue type', () => {
      const hybridDetails = { ...mockIpoDetails, issueType: 'HYBRID' as const };
      render(<IssueStructureSection ipoDetails={hybridDetails} />);

      expect(screen.getByText('Hybrid')).toBeInTheDocument();
    });
  });

  describe('Cut-Off Price Display', () => {
    it('should display cut-off price for BOOK_BUILDING', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('Cut-Off Price')).toBeInTheDocument();
      expect(screen.getByText('₹250')).toBeInTheDocument();
      expect(screen.getByText('Bid at cut-off to get shares at the final discovered price')).toBeInTheDocument();
    });

    it('should NOT display cut-off price for FIXED_PRICE', () => {
      const fixedPriceDetails = {
        ...mockIpoDetails,
        issueType: 'FIXED_PRICE' as const,
        cutOffPrice: '250',
      };
      render(<IssueStructureSection ipoDetails={fixedPriceDetails} />);

      expect(screen.queryByText('Cut-Off Price')).not.toBeInTheDocument();
    });

    it('should NOT display cut-off price if null', () => {
      const noCutOffDetails = { ...mockIpoDetails, cutOffPrice: null };
      render(<IssueStructureSection ipoDetails={noCutOffDetails} />);

      expect(screen.queryByText('Cut-Off Price')).not.toBeInTheDocument();
    });
  });

  describe('Registrar Link Display', () => {
    it('should display registrar portal link with external icon', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      const link = screen.getByText('Check Allotment Status');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', 'https://www.kfintech.com/ipostatus');
      expect(link.closest('a')).toHaveAttribute('target', '_blank');
      expect(link.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should NOT display registrar link if null', () => {
      const noRegistrarDetails = { ...mockIpoDetails, registrarLink: null };
      render(<IssueStructureSection ipoDetails={noRegistrarDetails} />);

      expect(screen.queryByText('Check Allotment Status')).not.toBeInTheDocument();
      expect(screen.queryByText('Registrar Portal')).not.toBeInTheDocument();
    });

    it('should display helper text below registrar link', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText("Check your IPO application status on the registrar's website")).toBeInTheDocument();
    });
  });

  describe('Fresh Issue vs OFS Breakdown', () => {
    it('should render breakdown chart when both values exist', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('Fresh Issue vs OFS Breakdown')).toBeInTheDocument();
    });

    it('should render chart with only Fresh Issue', () => {
      const freshOnlyDetails = { ...mockIpoDetails, ofsIssue: '0' };
      render(<IssueStructureSection ipoDetails={freshOnlyDetails} />);

      expect(screen.getByText('Fresh Issue vs OFS Breakdown')).toBeInTheDocument();
    });

    it('should render chart with only OFS', () => {
      const ofsOnlyDetails = { ...mockIpoDetails, freshIssue: '0', ofsIssue: '500' };
      render(<IssueStructureSection ipoDetails={ofsOnlyDetails} />);

      expect(screen.getByText('Fresh Issue vs OFS Breakdown')).toBeInTheDocument();
    });

    it('should show message when no breakdown data available', () => {
      const noBreakdownDetails = { ...mockIpoDetails, freshIssue: null, ofsIssue: null };
      render(<IssueStructureSection ipoDetails={noBreakdownDetails} />);

      expect(screen.getByText('Detailed issue breakdown information is not yet available for this IPO')).toBeInTheDocument();
    });
  });

  describe('Null/Empty Data Handling', () => {
    it('should show empty state when ipoDetails is null', () => {
      render(<IssueStructureSection ipoDetails={null} />);

      expect(screen.getByText('Issue Structure')).toBeInTheDocument();
      expect(screen.getByText('Issue structure data not available')).toBeInTheDocument();
    });

    it('should show empty state when ipoDetails is undefined', () => {
      render(<IssueStructureSection ipoDetails={undefined} />);

      expect(screen.getByText('Issue structure data not available')).toBeInTheDocument();
    });

    it('should not render sub-components when data is null', () => {
      render(<IssueStructureSection ipoDetails={null} />);

      expect(screen.queryByText('Issue Type')).not.toBeInTheDocument();
      expect(screen.queryByText('Check Allotment Status')).not.toBeInTheDocument();
    });
  });

  describe('Responsive Layout', () => {
    it('should have grid layout for desktop (lg:grid-cols-2)', () => {
      const { container } = render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      const gridElement = container.querySelector('.grid');
      expect(gridElement).toHaveClass('lg:grid-cols-2');
    });

    it('should have single column layout for mobile (grid-cols-1)', () => {
      const { container } = render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      const gridElement = container.querySelector('.grid');
      expect(gridElement).toHaveClass('grid-cols-1');
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className to container', () => {
      const { container } = render(
        <IssueStructureSection ipoDetails={mockIpoDetails} className="custom-section" />
      );

      expect(container.firstChild).toHaveClass('custom-section');
    });

    it('should maintain base styling classes', () => {
      const { container } = render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(container.firstChild).toHaveClass('bg-white');
      expect(container.firstChild).toHaveClass('rounded-lg');
      expect(container.firstChild).toHaveClass('border');
    });
  });

  describe('Semantic Structure', () => {
    it('should use proper heading hierarchy', () => {
      const { container } = render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      const h2 = container.querySelector('h2');
      expect(h2).toHaveTextContent('Issue Structure');

      const h3Elements = container.querySelectorAll('h3');
      expect(h3Elements.length).toBeGreaterThan(0);
    });

    it('should have proper spacing between sections', () => {
      const { container } = render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      const spaceElements = container.querySelectorAll('.space-y-6');
      expect(spaceElements.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Child Components', () => {
    it('should pass correct props to IssueTypeBadge', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('Book Building')).toBeInTheDocument();
    });

    it('should pass correct props to MinimumInvestmentDisplay', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      expect(screen.getByText('₹15,000')).toBeInTheDocument();
    });

    it('should pass correct props to IssueBreakdownChart', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} />);

      // Chart component should receive freshIssue and ofsIssue
      expect(screen.getByText('Fresh Issue vs OFS Breakdown')).toBeInTheDocument();
    });
  });

  // W-88: the offer's three share legs (fresh / OFS / total) each have their
  // own ipo_valuation column, so the table shows all three and the
  // "not stored yet" footnote is gone.
  describe('Valuation table share legs (W-88)', () => {
    const valuation = {
      pricingEvent: 'PRICE_BAND_AD',
      priceFloor: '140',
      priceCap: '147',
      sharesAtFloor: '14880952',
      sharesAtCap: '14124293',
      freshSharesAtFloor: '14880952',
      freshSharesAtCap: '14124293',
      ofsShares: '11848340',
      totalSharesAtFloor: '26729292',
      totalSharesAtCap: '25972633',
      mcapAtFloor: null,
      mcapAtCap: null,
      peAtFloor: null,
      peAtCap: null,
      peNotAscertainableReason: null,
      ronwWeighted3y: null,
      faceValueMultipleFloor: null,
      faceValueMultipleCap: null,
    };

    it('shows the fresh, offer-for-sale and total share legs with their values', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} valuation={valuation} />);

      expect(screen.getByText('Fresh issue shares')).toBeInTheDocument();
      expect(screen.getByText('Offer for sale shares')).toBeInTheDocument();
      expect(screen.getByText('Total offer shares')).toBeInTheDocument();
      // Substance, not shape: the printed figures themselves.
      expect(screen.getByText('1,48,80,952')).toBeInTheDocument();
      expect(screen.getByText('1,41,24,293')).toBeInTheDocument();
      expect(screen.getAllByText('1,18,48,340')).toHaveLength(2);
      expect(screen.getByText('2,67,29,292')).toBeInTheDocument();
      expect(screen.getByText('2,59,72,633')).toBeInTheDocument();
    });

    it('no longer footnotes that the total offer share count is unstored', () => {
      render(<IssueStructureSection ipoDetails={mockIpoDetails} valuation={valuation} />);

      expect(screen.queryByText(/will be shown once stored/)).not.toBeInTheDocument();
    });

    it('falls back to shares_at_floor/at_cap for rows written before migration 0048', () => {
      const legacy = {
        ...valuation,
        freshSharesAtFloor: null,
        freshSharesAtCap: null,
        ofsShares: null,
        totalSharesAtFloor: null,
        totalSharesAtCap: null,
      };
      render(<IssueStructureSection ipoDetails={mockIpoDetails} valuation={legacy} />);

      expect(screen.getByText('Fresh issue shares')).toBeInTheDocument();
      expect(screen.getByText('1,48,80,952')).toBeInTheDocument();
      expect(screen.queryByText('Offer for sale shares')).not.toBeInTheDocument();
      expect(screen.queryByText('Total offer shares')).not.toBeInTheDocument();
    });
  });
});
