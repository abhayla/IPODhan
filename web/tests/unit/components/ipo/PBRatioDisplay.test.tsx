/**
 * PBRatioDisplay Component Unit Tests
 * Story 4.10: Enhanced Financial Metrics Display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PBRatioDisplay } from '@/components/ipo/PBRatioDisplay';

describe('PBRatioDisplay Component', () => {
  describe('with valid P/B Ratio', () => {
    it('displays P/B ratio with 2 decimal places', () => {
      render(<PBRatioDisplay pbRatio={1.85} />);
      expect(screen.getByText('1.85')).toBeInTheDocument();
      expect(screen.getByText('P/B Ratio:')).toBeInTheDocument();
    });

    it('formats string values correctly', () => {
      render(<PBRatioDisplay pbRatio="3.456" />);
      expect(screen.getByText('3.46')).toBeInTheDocument();
    });

    it('rounds to 2 decimal places', () => {
      render(<PBRatioDisplay pbRatio={2.999} />);
      expect(screen.getByText('3.00')).toBeInTheDocument();
    });

    it('displays info tooltip icon', () => {
      const { container } = render(<PBRatioDisplay pbRatio={2.5} />);
      const infoIcon = container.querySelector('svg');
      expect(infoIcon).toBeInTheDocument();
    });
  });

  describe('color coding logic', () => {
    it('applies green color for ratio < 2.0 (attractive valuation)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={1.5} />);
      const valueElement = screen.getByText('1.50');
      expect(valueElement).toHaveClass('text-green-600');
    });

    it('applies yellow color for ratio 2.0-4.0 (fair valuation)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={3.0} />);
      const valueElement = screen.getByText('3.00');
      expect(valueElement).toHaveClass('text-yellow-600');
    });

    it('applies red color for ratio > 4.0 (premium valuation)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={5.5} />);
      const valueElement = screen.getByText('5.50');
      expect(valueElement).toHaveClass('text-red-600');
    });

    it('correctly handles boundary value 2.0 (yellow)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={2.0} />);
      const valueElement = screen.getByText('2.00');
      expect(valueElement).toHaveClass('text-yellow-600');
    });

    it('correctly handles boundary value 4.0 (yellow)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={4.0} />);
      const valueElement = screen.getByText('4.00');
      expect(valueElement).toHaveClass('text-yellow-600');
    });

    it('correctly handles value just above 4.0 (red)', () => {
      const { container } = render(<PBRatioDisplay pbRatio={4.01} />);
      const valueElement = screen.getByText('4.01');
      expect(valueElement).toHaveClass('text-red-600');
    });
  });

  describe('null/undefined handling', () => {
    it('displays "N/A" for null P/B ratio', () => {
      render(<PBRatioDisplay pbRatio={null} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
      expect(screen.getByText('P/B Ratio:')).toBeInTheDocument();
    });

    it('displays "N/A" for undefined P/B ratio', () => {
      render(<PBRatioDisplay pbRatio={null} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('applies muted text color for N/A state', () => {
      const { container } = render(<PBRatioDisplay pbRatio={null} />);
      const naText = screen.getByText('N/A');
      expect(naText).toHaveClass('text-muted-foreground');
    });

    it('displays explanatory tooltip for N/A state', () => {
      const { container } = render(<PBRatioDisplay pbRatio={null} />);
      const infoIcon = container.querySelector('svg');
      expect(infoIcon).toBeInTheDocument();
    });
  });

  describe('custom styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <PBRatioDisplay pbRatio={2.5} className="custom-class" />
      );
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('custom-class');
    });

    it('applies font-semibold to value', () => {
      render(<PBRatioDisplay pbRatio={2.5} />);
      const valueElement = screen.getByText('2.50');
      expect(valueElement).toHaveClass('font-semibold');
    });
  });

  describe('edge cases', () => {
    it('handles zero P/B ratio (green)', () => {
      render(<PBRatioDisplay pbRatio={0} />);
      expect(screen.getByText('0.00')).toBeInTheDocument();
      const valueElement = screen.getByText('0.00');
      expect(valueElement).toHaveClass('text-green-600');
    });

    it('handles very high P/B ratio', () => {
      render(<PBRatioDisplay pbRatio={99.99} />);
      expect(screen.getByText('99.99')).toBeInTheDocument();
      const valueElement = screen.getByText('99.99');
      expect(valueElement).toHaveClass('text-red-600');
    });

    it('handles decimal string with extra precision', () => {
      render(<PBRatioDisplay pbRatio="1.23456789" />);
      expect(screen.getByText('1.23')).toBeInTheDocument();
    });
  });
});
