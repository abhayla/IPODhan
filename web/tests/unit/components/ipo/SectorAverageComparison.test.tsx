/**
 * Unit Tests: SectorAverageComparison Component
 *
 * Tests for the sector average comparison component (Story 6.3)
 * Coverage: Badge display, above/below average logic, percentage formatting
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectorAverageComparison } from '@/components/ipo/SectorAverageComparison';

describe('SectorAverageComparison', () => {
  describe('Sector Average Display', () => {
    it('displays sector name and average gain', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      expect(
        screen.getByText(/Technology sector average listing gain:/)
      ).toBeInTheDocument();
      expect(screen.getByText('+10.00%')).toBeInTheDocument();
    });

    it('formats sector average percentage correctly', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={12.5}
          sector="Healthcare"
        />
      );

      expect(screen.getByText('+12.50%')).toBeInTheDocument();
    });

    it('displays negative sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={-3.0}
          sectorAverageGain={-5.0}
          sector="Finance"
        />
      );

      expect(screen.getByText('-5.00%')).toBeInTheDocument();
    });
  });

  describe('Above Average Badge', () => {
    it('displays "Above average" badge when listing gain > sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      expect(screen.getByText('Above average')).toBeInTheDocument();
    });

    it('displays green badge for above average', () => {
      const { container } = render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      const badge = screen.getByText('Above average').closest('span');
      expect(badge).toHaveClass('bg-green-100');
      expect(badge).toHaveClass('text-green-700');
      expect(badge).toHaveClass('border-green-500');
    });

    it('shows above average when gains are equal (edge case)', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={10.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      // When equal, should show "Below average" based on logic (not strictly above)
      expect(screen.getByText('Below average')).toBeInTheDocument();
    });
  });

  describe('Below Average Badge', () => {
    it('displays "Below average" badge when listing gain <= sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={8.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      expect(screen.getByText('Below average')).toBeInTheDocument();
    });

    it('displays red badge for below average', () => {
      const { container } = render(
        <SectorAverageComparison
          listingGainPercent={8.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      const badge = screen.getByText('Below average').closest('span');
      expect(badge).toHaveClass('bg-red-100');
      expect(badge).toHaveClass('text-red-700');
      expect(badge).toHaveClass('border-red-500');
    });
  });

  describe('Comparison Logic', () => {
    it('correctly identifies above average with positive gains', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={20.0}
          sectorAverageGain={15.0}
          sector="Technology"
        />
      );

      expect(screen.getByText('Above average')).toBeInTheDocument();
    });

    it('correctly identifies above average with negative gains', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={-3.0}
          sectorAverageGain={-5.0}
          sector="Finance"
        />
      );

      // -3% is better than -5%, so it's above average
      expect(screen.getByText('Above average')).toBeInTheDocument();
    });

    it('correctly identifies below average with positive gains', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={8.0}
          sectorAverageGain={12.0}
          sector="Healthcare"
        />
      );

      expect(screen.getByText('Below average')).toBeInTheDocument();
    });

    it('correctly identifies below average with negative gains', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={-8.0}
          sectorAverageGain={-3.0}
          sector="Real Estate"
        />
      );

      // -8% is worse than -3%, so it's below average
      expect(screen.getByText('Below average')).toBeInTheDocument();
    });
  });

  describe('Percentage Formatting', () => {
    it('formats positive percentages with + sign', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={12.5}
          sector="Technology"
        />
      );

      expect(screen.getByText('+12.50%')).toBeInTheDocument();
    });

    it('formats negative percentages with - sign', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={-3.0}
          sectorAverageGain={-5.0}
          sector="Finance"
        />
      );

      expect(screen.getByText('-5.00%')).toBeInTheDocument();
    });

    it('formats percentages with 2 decimal places', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={15.123}
          sectorAverageGain={12.567}
          sector="Technology"
        />
      );

      expect(screen.getByText('+12.57%')).toBeInTheDocument();
    });

    it('handles zero sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={5.0}
          sectorAverageGain={0}
          sector="Consumer Goods"
        />
      );

      expect(screen.getByText('0.00%')).toBeInTheDocument();
    });
  });

  describe('Different Sectors', () => {
    const sectors = [
      'Technology',
      'Healthcare',
      'Finance',
      'Real Estate',
      'Consumer Goods',
      'Energy',
      'Utilities',
    ];

    sectors.forEach((sector) => {
      it(`displays correctly for ${sector} sector`, () => {
        render(
          <SectorAverageComparison
            listingGainPercent={15.0}
            sectorAverageGain={10.0}
            sector={sector}
          />
        );

        expect(
          screen.getByText(new RegExp(`${sector} sector average listing gain:`))
        ).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles very large sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={50.0}
          sectorAverageGain={100.0}
          sector="Technology"
        />
      );

      expect(screen.getByText('+100.00%')).toBeInTheDocument();
      expect(screen.getByText('Below average')).toBeInTheDocument();
    });

    it('handles very small differences', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={10.01}
          sectorAverageGain={10.0}
          sector="Finance"
        />
      );

      expect(screen.getByText('Above average')).toBeInTheDocument();
    });

    it('handles zero listing gain with positive sector average', () => {
      render(
        <SectorAverageComparison
          listingGainPercent={0}
          sectorAverageGain={5.0}
          sector="Healthcare"
        />
      );

      expect(screen.getByText('+5.00%')).toBeInTheDocument();
      expect(screen.getByText('Below average')).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('renders with responsive flex layout', () => {
      const { container } = render(
        <SectorAverageComparison
          listingGainPercent={15.0}
          sectorAverageGain={10.0}
          sector="Technology"
        />
      );

      // Check for responsive classes
      const flexContainer = container.querySelector('.sm\\:flex-row');
      expect(flexContainer).toBeInTheDocument();
    });
  });
});
