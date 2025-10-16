/**
 * Unit Tests: ListingPerformanceBadge Component
 *
 * Tests for the listing performance badge component (Story 6.3)
 * Coverage: Badge rendering, color coding, icon display, size variants
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingPerformanceBadge } from '@/components/ipo/ListingPerformanceBadge';

describe('ListingPerformanceBadge', () => {
  describe('Rendering', () => {
    it('renders with positive gain (+13.3%)', () => {
      render(<ListingPerformanceBadge listingGainPercent={13.33} />);

      // Check if badge displays correct percentage
      expect(screen.getByText('+13.33%')).toBeInTheDocument();
    });

    it('renders with negative loss (-5.2%)', () => {
      render(<ListingPerformanceBadge listingGainPercent={-5.2} />);

      // Check if badge displays correct percentage
      expect(screen.getByText('-5.20%')).toBeInTheDocument();
    });

    it('does not render if listingGainPercent is null', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={null as unknown as number} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('does not render if listingGainPercent is undefined', () => {
      const { container } = render(
        <ListingPerformanceBadge
          listingGainPercent={undefined as unknown as number}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Color Coding', () => {
    it('displays green color for positive gains', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} />
      );

      const badge = container.querySelector('span[data-slot="badge"]');
      expect(badge).toHaveClass('bg-green-100');
      expect(badge).toHaveClass('text-green-700');
      expect(badge).toHaveClass('border-green-500');
    });

    it('displays red color for negative losses', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={-5.2} />
      );

      const badge = container.querySelector('span[data-slot="badge"]');
      expect(badge).toHaveClass('bg-red-100');
      expect(badge).toHaveClass('text-red-700');
      expect(badge).toHaveClass('border-red-500');
    });
  });

  describe('Icon Display', () => {
    it('displays TrendingUp icon for positive gains', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} showIcon={true} />
      );

      // Check for SVG icon presence
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('displays TrendingDown icon for negative losses', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={-5.2} showIcon={true} />
      );

      // Check for SVG icon presence
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('does not display icon when showIcon is false', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} showIcon={false} />
      );

      const icon = container.querySelector('svg');
      expect(icon).not.toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    it('renders small size variant', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} size="small" />
      );

      const badge = container.querySelector('span[data-slot="badge"]');
      expect(badge).toHaveClass('text-sm');
    });

    it('renders medium size variant (default)', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} />
      );

      const badge = container.querySelector('span[data-slot="badge"]');
      expect(badge).toHaveClass('text-base');
    });

    it('renders large size variant', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} size="large" />
      );

      const badge = container.querySelector('span[data-slot="badge"]');
      expect(badge).toHaveClass('text-2xl');
    });
  });

  describe('Percentage Formatting', () => {
    it('formats percentage with 2 decimal places', () => {
      render(<ListingPerformanceBadge listingGainPercent={13.3} />);

      expect(screen.getByText('+13.30%')).toBeInTheDocument();
    });

    it('adds + sign for positive gains', () => {
      render(<ListingPerformanceBadge listingGainPercent={13.33} />);

      const text = screen.getByText('+13.33%');
      expect(text).toBeInTheDocument();
      expect(text.textContent).toContain('+');
    });

    it('does not add + sign for negative losses', () => {
      render(<ListingPerformanceBadge listingGainPercent={-5.2} />);

      const text = screen.getByText('-5.20%');
      expect(text).toBeInTheDocument();
      expect(text.textContent).not.toContain('+-'); // Should not have double sign
    });

    it('handles zero gain correctly', () => {
      render(<ListingPerformanceBadge listingGainPercent={0} />);

      // Zero is technically not positive, so it should have red styling
      expect(screen.getByText('0.00%')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has aria-hidden on icon', () => {
      const { container } = render(
        <ListingPerformanceBadge listingGainPercent={13.33} showIcon={true} />
      );

      const icon = container.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
