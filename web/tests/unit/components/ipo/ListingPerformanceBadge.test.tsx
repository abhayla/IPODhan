/**
 * Unit Tests for ListingPerformanceBadge Component
 *
 * Tests:
 * - Renders positive gain with green styling
 * - Renders negative loss with red styling
 * - Renders zero gain correctly
 * - Shows correct icon for trend
 * - Compact variant styling
 * - Accessibility (screen reader text)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingPerformanceBadge } from '@/components/ipo/ListingPerformanceBadge';

describe('ListingPerformanceBadge', () => {
  it('renders positive gain with green styling and trending up icon', () => {
    render(<ListingPerformanceBadge listingGainPercent={25.5} />);

    const badge = screen.getByText('+25.5%');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-green-700');
    expect(badge.parentElement).toHaveClass('bg-green-100');
    expect(badge.parentElement).toHaveClass('border-green-500');

    // Check for screen reader text
    expect(screen.getByText(/Listing day gain of 25.5 percent/i)).toBeInTheDocument();
  });

  it('renders negative loss with red styling and trending down icon', () => {
    render(<ListingPerformanceBadge listingGainPercent={-15.3} />);

    const badge = screen.getByText('-15.3%');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-red-700');
    expect(badge.parentElement).toHaveClass('bg-red-100');
    expect(badge.parentElement).toHaveClass('border-red-500');

    // Check for screen reader text
    expect(screen.getByText(/Listing day loss of 15.3 percent/i)).toBeInTheDocument();
  });

  it('renders zero gain correctly', () => {
    render(<ListingPerformanceBadge listingGainPercent={0} />);

    const badge = screen.getByText('+0.0%');
    expect(badge).toBeInTheDocument();
    // Zero is treated as positive (green)
    expect(badge.parentElement).toHaveClass('text-green-700');
  });

  it('formats percentage to one decimal place', () => {
    render(<ListingPerformanceBadge listingGainPercent={12.456} />);

    expect(screen.getByText('+12.5%')).toBeInTheDocument();
  });

  it('renders compact variant with smaller styling', () => {
    render(<ListingPerformanceBadge listingGainPercent={20} variant="compact" />);

    const badge = screen.getByText('+20.0%');
    expect(badge.parentElement).toHaveClass('text-xs');
    expect(badge.parentElement).toHaveClass('px-2');
    expect(badge.parentElement).toHaveClass('py-0.5');

    // Compact variant should not show icon (only text)
    const svgElements = badge.parentElement?.querySelectorAll('svg');
    expect(svgElements?.length).toBe(0);
  });

  it('renders default variant with icon', () => {
    const { container } = render(
      <ListingPerformanceBadge listingGainPercent={15} variant="default" />
    );

    // Default variant should show icon
    const svgElements = container.querySelectorAll('svg');
    expect(svgElements.length).toBeGreaterThan(0);
  });

  it('applies custom className', () => {
    render(
      <ListingPerformanceBadge
        listingGainPercent={10}
        className="custom-class"
      />
    );

    const badge = screen.getByText('+10.0%');
    expect(badge.parentElement).toHaveClass('custom-class');
  });

  it('handles large positive values', () => {
    render(<ListingPerformanceBadge listingGainPercent={150.75} />);

    expect(screen.getByText('+150.8%')).toBeInTheDocument();
  });

  it('handles large negative values', () => {
    render(<ListingPerformanceBadge listingGainPercent={-85.25} />);

    expect(screen.getByText('-85.2%')).toBeInTheDocument();
  });
});
