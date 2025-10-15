/**
 * StockSymbol Component Unit Tests
 * Story 4.9: Stock Symbol & ISIN Display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockSymbol } from '@/components/ipo/StockSymbol';

describe('StockSymbol Component', () => {
  describe('with valid symbol', () => {
    it('renders symbol with NSE exchange', () => {
      render(<StockSymbol symbol="RELIANCE" exchange="NSE" />);
      expect(screen.getByText('RELIANCE (NSE)')).toBeInTheDocument();
    });

    it('renders symbol with BSE exchange', () => {
      render(<StockSymbol symbol="TCS" exchange="BSE" />);
      expect(screen.getByText('TCS (BSE)')).toBeInTheDocument();
    });

    it('renders symbol with BOTH exchanges', () => {
      render(<StockSymbol symbol="INFY" exchange="BOTH" />);
      expect(screen.getByText('INFY (NSE/BSE)')).toBeInTheDocument();
    });

    it('applies monospace font class', () => {
      const { container } = render(<StockSymbol symbol="RELIANCE" />);
      const badge = container.querySelector('.font-mono');
      expect(badge).toBeInTheDocument();
    });

    it('applies correct size classes', () => {
      const { rerender, container } = render(
        <StockSymbol symbol="RELIANCE" size="sm" />
      );
      expect(container.querySelector('.text-xs')).toBeInTheDocument();

      rerender(<StockSymbol symbol="RELIANCE" size="md" />);
      expect(container.querySelector('.text-sm')).toBeInTheDocument();

      rerender(<StockSymbol symbol="RELIANCE" size="lg" />);
      expect(container.querySelector('.text-base')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <StockSymbol symbol="RELIANCE" className="custom-class" />
      );
      const badge = container.querySelector('.custom-class');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('with null/undefined symbol', () => {
    it('renders "TBD" for null symbol', () => {
      render(<StockSymbol symbol={null} />);
      expect(screen.getByText('TBD')).toBeInTheDocument();
    });

    it('renders "TBD" for undefined symbol', () => {
      render(<StockSymbol symbol={undefined} />);
      expect(screen.getByText('TBD')).toBeInTheDocument();
    });

    it('applies muted text color for TBD', () => {
      const { container } = render(<StockSymbol symbol={null} />);
      const badge = container.querySelector('.text-muted-foreground');
      expect(badge).toBeInTheDocument();
    });

    it('uses outline variant for TBD', () => {
      const { container } = render(<StockSymbol symbol={null} />);
      // Badge component with variant="outline" applies specific classes
      expect(container.querySelector('[class*="border"]')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('renders as accessible badge element', () => {
      const { container } = render(<StockSymbol symbol="RELIANCE" />);
      const badge = container.firstChild;
      expect(badge).toHaveClass('inline-flex'); // Badge component class
    });
  });
});
