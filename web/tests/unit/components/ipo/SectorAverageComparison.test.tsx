/**
 * Unit Tests for SectorAverageComparison Component
 *
 * Tests:
 * - Renders "Above Average" badge when IPO outperforms sector
 * - Renders "Below Average" badge when IPO underperforms sector
 * - Shows sector name and average percentage
 * - Displays performance difference
 * - Returns null when sector average is unavailable
 * - Handles edge cases (equal performance)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectorAverageComparison } from '@/components/ipo/SectorAverageComparison';

describe('SectorAverageComparison', () => {
  it('renders "Above Average" badge when IPO outperforms sector', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={35.5}
        sectorAverage={25.0}
        sector="Technology"
      />
    );

    expect(screen.getByText('Above Average')).toBeInTheDocument();
    expect(screen.getByText(/Technology/i)).toBeInTheDocument();
    expect(screen.getByText(/sector average/i)).toBeInTheDocument();
    expect(screen.getByText(/\+25.0%/)).toBeInTheDocument();
    expect(screen.getByText(/10.5%/)).toBeInTheDocument();
    expect(screen.getByText(/better/i)).toBeInTheDocument();
  });

  it('renders "Below Average" badge when IPO underperforms sector', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={15.0}
        sectorAverage={30.0}
        sector="Finance"
      />
    );

    expect(screen.getByText('Below Average')).toBeInTheDocument();
    expect(screen.getByText(/Finance/i)).toBeInTheDocument();
    expect(screen.getByText(/sector average/i)).toBeInTheDocument();
    expect(screen.getByText(/\+30.0%/)).toBeInTheDocument();
    expect(screen.getByText(/15.0%/)).toBeInTheDocument();
    expect(screen.getByText(/worse/i)).toBeInTheDocument();
  });

  it('handles equal performance (at average)', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={20.0}
        sectorAverage={20.0}
        sector="Healthcare"
      />
    );

    // Equal is treated as "Above Average" (>=)
    expect(screen.getByText('Above Average')).toBeInTheDocument();
    expect(screen.getByText(/0.0%/)).toBeInTheDocument();
    expect(screen.getByText(/better/i)).toBeInTheDocument();
  });

  it('returns null when sector average is null', () => {
    const { container } = render(
      <SectorAverageComparison
        listingGainPercent={25.0}
        sectorAverage={null}
        sector="Technology"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('handles negative IPO performance vs positive sector average', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={-10.0}
        sectorAverage={15.0}
        sector="Retail"
      />
    );

    expect(screen.getByText('Below Average')).toBeInTheDocument();
    expect(screen.getByText(/25.0%/)).toBeInTheDocument();
    expect(screen.getByText(/worse/i)).toBeInTheDocument();
  });

  it('handles positive IPO performance vs negative sector average', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={5.0}
        sectorAverage={-10.0}
        sector="Energy"
      />
    );

    expect(screen.getByText('Above Average')).toBeInTheDocument();
    expect(screen.getByText(/sector average/i)).toBeInTheDocument();
    expect(screen.getByText(/-10.0%/)).toBeInTheDocument();
    expect(screen.getByText(/15.0%/)).toBeInTheDocument();
    expect(screen.getByText(/better/i)).toBeInTheDocument();
  });

  it('applies green styling for above average performance', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={40.0}
        sectorAverage={25.0}
        sector="Technology"
      />
    );

    const badge = screen.getByText('Above Average');
    expect(badge.parentElement).toHaveClass('text-green-700');
    expect(badge.parentElement).toHaveClass('bg-green-100');
    expect(badge.parentElement).toHaveClass('border-green-500');
  });

  it('applies red styling for below average performance', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={10.0}
        sectorAverage={25.0}
        sector="Technology"
      />
    );

    const badge = screen.getByText('Below Average');
    expect(badge.parentElement).toHaveClass('text-red-700');
    expect(badge.parentElement).toHaveClass('bg-red-100');
    expect(badge.parentElement).toHaveClass('border-red-500');
  });

  it('applies custom className', () => {
    const { container } = render(
      <SectorAverageComparison
        listingGainPercent={30.0}
        sectorAverage={20.0}
        sector="Technology"
        className="custom-wrapper"
      />
    );

    expect(container.firstChild).toHaveClass('custom-wrapper');
  });

  it('formats difference to one decimal place', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={25.678}
        sectorAverage={20.123}
        sector="Technology"
      />
    );

    expect(screen.getByText(/5.6%/)).toBeInTheDocument();
    expect(screen.getByText(/better/i)).toBeInTheDocument();
  });

  it('formats sector average to one decimal place', () => {
    render(
      <SectorAverageComparison
        listingGainPercent={30.0}
        sectorAverage={24.567}
        sector="Technology"
      />
    );

    expect(screen.getByText(/sector average/i)).toBeInTheDocument();
    expect(screen.getByText(/\+24.6%/)).toBeInTheDocument();
  });
});
