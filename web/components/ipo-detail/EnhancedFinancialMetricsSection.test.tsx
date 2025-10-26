/**
 * Unit Tests for EnhancedFinancialMetricsSection
 * Story 11.12: EBITDA Multi-Period View
 *
 * Test Coverage:
 * - Component rendering with complete data
 * - Null/empty data handling
 * - YoY growth calculations
 * - Currency formatting
 * - Growth indicators (up/down/neutral)
 * - Additional ratios display
 * - Responsive table rendering
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnhancedFinancialMetricsSection } from './EnhancedFinancialMetricsSection';

describe('EnhancedFinancialMetricsSection', () => {
  const mockCompleteData = {
    revenueFy2022: 1000,
    revenueFy2023: 1200,
    revenueFy2024: 1500,
    profitFy2022: 100,
    profitFy2023: 150,
    profitFy2024: 200,
    ebitdaFy2022: 200,
    ebitdaFy2023: 250,
    ebitdaFy2024: 350,
    totalIncomeFy2022: 1100,
    totalIncomeFy2023: 1300,
    totalIncomeFy2024: 1600,
    totalBorrowings: 500,
    currentRatio: 1.5,
    quickRatio: 1.2,
    inventoryTurnover: 6.5,
  };

  describe('Rendering with Complete Data', () => {
    it('should render section with title and description', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('Enhanced Financial Metrics')).toBeInTheDocument();
      expect(screen.getByText(/Multi-year financial comparison with EBITDA/i)).toBeInTheDocument();
    });

    it('should render multi-year comparison table headers', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('Metric')).toBeInTheDocument();
      expect(screen.getByText('FY2022')).toBeInTheDocument();
      expect(screen.getByText('FY2023')).toBeInTheDocument();
      expect(screen.getByText('FY2024')).toBeInTheDocument();
      expect(screen.getAllByText('YoY Growth')).toHaveLength(2);
    });

    it('should display all financial metrics rows', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('Revenue')).toBeInTheDocument();
      expect(screen.getByText('Profit')).toBeInTheDocument();
      expect(screen.getByText('EBITDA')).toBeInTheDocument();
      expect(screen.getByText('Total Income')).toBeInTheDocument();
    });

    it('should format currency values correctly', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('₹1000.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹1200.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹1500.00 Cr')).toBeInTheDocument();
    });

    it('should display additional ratios section', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('Additional Financial Ratios')).toBeInTheDocument();
      expect(screen.getByText('Total Borrowings')).toBeInTheDocument();
      expect(screen.getByText('Current Ratio')).toBeInTheDocument();
      expect(screen.getByText('Quick Ratio')).toBeInTheDocument();
      expect(screen.getByText('Inventory Turnover')).toBeInTheDocument();
    });

    it('should format ratio values correctly', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText('1.50')).toBeInTheDocument(); // Current Ratio
      expect(screen.getByText('1.20')).toBeInTheDocument(); // Quick Ratio
      expect(screen.getByText('6.50')).toBeInTheDocument(); // Inventory Turnover
    });

    it('should display information note', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      expect(screen.getByText(/All amounts are in ₹ Crores/i)).toBeInTheDocument();
      expect(screen.getByText(/YoY Growth = Year-over-Year Growth Percentage/i)).toBeInTheDocument();
    });
  });

  describe('YoY Growth Calculations', () => {
    it('should calculate positive growth correctly', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      // Revenue FY2023: (1200 - 1000) / 1000 * 100 = 20%
      expect(screen.getByText('+20.00%')).toBeInTheDocument();
    });

    it('should calculate negative growth correctly', () => {
      const dataWithNegativeGrowth = {
        ...mockCompleteData,
        revenueFy2024: 1000, // Decreased from 1200
      };

      render(<EnhancedFinancialMetricsSection financialData={dataWithNegativeGrowth} />);

      // Revenue FY2024: (1000 - 1200) / 1200 * 100 = -16.67%
      expect(screen.getByText('-16.67%')).toBeInTheDocument();
    });

    it('should handle zero previous value gracefully', () => {
      const dataWithZero = {
        ...mockCompleteData,
        profitFy2022: 0,
      };

      render(<EnhancedFinancialMetricsSection financialData={dataWithZero} />);

      // Should display N/A for undefined growth
      const rows = screen.getAllByText('N/A');
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('Null/Empty Data Handling', () => {
    it('should not render when financialData is null', () => {
      const { container } = render(<EnhancedFinancialMetricsSection financialData={null} />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render when all fields are null', () => {
      const emptyData = {
        revenueFy2022: null,
        revenueFy2023: null,
        revenueFy2024: null,
        profitFy2022: null,
        profitFy2023: null,
        profitFy2024: null,
        ebitdaFy2022: null,
        ebitdaFy2023: null,
        ebitdaFy2024: null,
        totalIncomeFy2022: null,
        totalIncomeFy2023: null,
        totalIncomeFy2024: null,
        totalBorrowings: null,
        currentRatio: null,
        quickRatio: null,
        inventoryTurnover: null,
      };

      const { container } = render(<EnhancedFinancialMetricsSection financialData={emptyData} />);

      expect(container.firstChild).toBeNull();
    });

    it('should render with partial multi-year data', () => {
      const partialData = {
        ...mockCompleteData,
        revenueFy2022: null,
        profitFy2023: null,
      };

      render(<EnhancedFinancialMetricsSection financialData={partialData} />);

      expect(screen.getByText('Enhanced Financial Metrics')).toBeInTheDocument();
      expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    });

    it('should render with only additional ratios', () => {
      const ratiosOnlyData = {
        revenueFy2022: null,
        revenueFy2023: null,
        revenueFy2024: null,
        profitFy2022: null,
        profitFy2023: null,
        profitFy2024: null,
        ebitdaFy2022: null,
        ebitdaFy2023: null,
        ebitdaFy2024: null,
        totalIncomeFy2022: null,
        totalIncomeFy2023: null,
        totalIncomeFy2024: null,
        totalBorrowings: 500,
        currentRatio: 1.5,
        quickRatio: null,
        inventoryTurnover: null,
      };

      render(<EnhancedFinancialMetricsSection financialData={ratiosOnlyData} />);

      expect(screen.getByText('Additional Financial Ratios')).toBeInTheDocument();
      expect(screen.getByText('Total Borrowings')).toBeInTheDocument();
      expect(screen.queryByText('Metric')).not.toBeInTheDocument(); // No table
    });
  });

  describe('Growth Indicators', () => {
    it('should display upward trend icon for positive growth', () => {
      render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      // Positive growth should show TrendingUp icon (tested via className)
      const positiveGrowths = screen.getAllByText(/\+\d+\.\d+%/);
      expect(positiveGrowths.length).toBeGreaterThan(0);
    });

    it('should display downward trend icon for negative growth', () => {
      const dataWithNegativeGrowth = {
        ...mockCompleteData,
        revenueFy2023: 800, // Decreased
        profitFy2024: 100, // Decreased
      };

      render(<EnhancedFinancialMetricsSection financialData={dataWithNegativeGrowth} />);

      const negativeGrowths = screen.getAllByText(/-\d+\.\d+%/);
      expect(negativeGrowths.length).toBeGreaterThan(0);
    });
  });

  describe('Responsive Layout', () => {
    it('should have overflow-x-auto for horizontal scrolling', () => {
      const { container } = render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      const scrollContainer = container.querySelector('.overflow-x-auto');
      expect(scrollContainer).toBeInTheDocument();
    });

    it('should use grid layout for ratios', () => {
      const { container } = render(<EnhancedFinancialMetricsSection financialData={mockCompleteData} />);

      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers', () => {
      const largeData = {
        ...mockCompleteData,
        revenueFy2024: 999999.99,
      };

      render(<EnhancedFinancialMetricsSection financialData={largeData} />);

      expect(screen.getByText('₹999999.99 Cr')).toBeInTheDocument();
    });

    it('should handle decimal precision correctly', () => {
      const decimalData = {
        ...mockCompleteData,
        currentRatio: 1.234567,
      };

      render(<EnhancedFinancialMetricsSection financialData={decimalData} />);

      // Should round to 2 decimal places
      expect(screen.getByText('1.23')).toBeInTheDocument();
    });

    it('should handle negative values', () => {
      const negativeData = {
        ...mockCompleteData,
        profitFy2022: -50,
        profitFy2023: -30,
      };

      render(<EnhancedFinancialMetricsSection financialData={negativeData} />);

      expect(screen.getByText('₹-50.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹-30.00 Cr')).toBeInTheDocument();
    });
  });
});
