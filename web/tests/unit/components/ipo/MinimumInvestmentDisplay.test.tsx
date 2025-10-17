/**
 * Unit Tests for MinimumInvestmentDisplay Component (Story 4.11)
 * Tests minimum investment display with high investment warnings
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MinimumInvestmentDisplay } from '@/components/ipo/MinimumInvestmentDisplay';

describe('MinimumInvestmentDisplay', () => {
  describe('Normal Investment Display', () => {
    it('should display formatted amount with rupee symbol', () => {
      render(<MinimumInvestmentDisplay minInvestment="15000" />);

      expect(screen.getByText('Minimum Investment')).toBeInTheDocument();
      expect(screen.getByText('₹15,000')).toBeInTheDocument();
    });

    it('should show "Accessible" badge for normal investments', () => {
      render(<MinimumInvestmentDisplay minInvestment="20000" />);

      expect(screen.getByText('Accessible')).toBeInTheDocument();
      // Check for green styling
      const badge = screen.getByText('Accessible').parentElement;
      expect(badge).toHaveClass('bg-green-50');
      expect(badge).toHaveClass('border-green-200');
    });

    it('should handle numeric values', () => {
      render(<MinimumInvestmentDisplay minInvestment={25000} />);

      expect(screen.getByText('₹25,000')).toBeInTheDocument();
      expect(screen.getByText('Accessible')).toBeInTheDocument();
    });
  });

  describe('High Investment Warning', () => {
    it('should show "High Investment" badge for amounts > ₹50,000', () => {
      render(<MinimumInvestmentDisplay minInvestment="75000" />);

      expect(screen.getByText('High Investment')).toBeInTheDocument();
      expect(screen.queryByText('Accessible')).not.toBeInTheDocument();
    });

    it('should display warning with amber styling for high investments', () => {
      render(<MinimumInvestmentDisplay minInvestment="100000" />);

      const badge = screen.getByText('High Investment').parentElement;
      expect(badge).toHaveClass('bg-amber-50');
      expect(badge).toHaveClass('border-amber-200');
    });

    it('should show AlertTriangle icon for high investments', () => {
      const { container } = render(<MinimumInvestmentDisplay minInvestment="60000" />);

      // Check for Lucide icon class
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass('text-amber-600');
    });

    it('should exactly identify ₹50,001 as high investment', () => {
      render(<MinimumInvestmentDisplay minInvestment="50001" />);

      expect(screen.getByText('High Investment')).toBeInTheDocument();
    });

    it('should identify ₹50,000 as accessible (not high)', () => {
      render(<MinimumInvestmentDisplay minInvestment="50000" />);

      expect(screen.getByText('Accessible')).toBeInTheDocument();
      expect(screen.queryByText('High Investment')).not.toBeInTheDocument();
    });
  });

  describe('Number Formatting', () => {
    it('should format large numbers with commas (Indian format)', () => {
      render(<MinimumInvestmentDisplay minInvestment="150000" />);

      expect(screen.getByText('₹1,50,000')).toBeInTheDocument();
    });

    it('should format very large numbers correctly', () => {
      render(<MinimumInvestmentDisplay minInvestment="2000000" />);

      expect(screen.getByText('₹20,00,000')).toBeInTheDocument();
    });

    it('should handle decimal values', () => {
      render(<MinimumInvestmentDisplay minInvestment="14500.50" />);

      expect(screen.getByText('₹14,500.5')).toBeInTheDocument();
    });
  });

  describe('Null/Undefined Handling', () => {
    it('should show "Not Available" when minInvestment is null', () => {
      render(<MinimumInvestmentDisplay minInvestment={null} />);

      expect(screen.getByText('Not Available')).toBeInTheDocument();
      expect(screen.queryByText('Minimum Investment')).not.toBeInTheDocument();
    });

    it('should show "Not Available" when minInvestment is undefined', () => {
      render(<MinimumInvestmentDisplay minInvestment={undefined} />);

      expect(screen.getByText('Not Available')).toBeInTheDocument();
    });

    it('should not show badges when data is not available', () => {
      render(<MinimumInvestmentDisplay minInvestment={null} />);

      expect(screen.queryByText('Accessible')).not.toBeInTheDocument();
      expect(screen.queryByText('High Investment')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero value', () => {
      render(<MinimumInvestmentDisplay minInvestment="0" />);

      expect(screen.getByText('₹0')).toBeInTheDocument();
      expect(screen.getByText('Accessible')).toBeInTheDocument();
    });

    it('should handle negative values (edge case)', () => {
      render(<MinimumInvestmentDisplay minInvestment="-1000" />);

      expect(screen.getByText('₹-1,000')).toBeInTheDocument();
    });

    it('should handle string with spaces', () => {
      render(<MinimumInvestmentDisplay minInvestment=" 30000 " />);

      expect(screen.getByText('₹30,000')).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <MinimumInvestmentDisplay minInvestment="15000" className="custom-style" />
      );

      expect(container.firstChild).toHaveClass('custom-style');
    });
  });

  describe('Semantic Structure', () => {
    it('should have proper heading hierarchy', () => {
      render(<MinimumInvestmentDisplay minInvestment="15000" />);

      expect(screen.getByText('Minimum Investment')).toBeInTheDocument();
      expect(screen.getByText('₹15,000')).toBeInTheDocument();
    });

    it('should center-align text', () => {
      const { container } = render(<MinimumInvestmentDisplay minInvestment="15000" />);

      expect(container.firstChild).toHaveClass('text-center');
    });
  });
});
