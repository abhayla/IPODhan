/**
 * Unit Tests for IPOObjectivesSection
 * Story 11.13: IPO Objectives Section
 *
 * Test Coverage:
 * - Component rendering with complete data
 * - Empty state handling (null/empty array)
 * - Null amount handling (unallocated funds)
 * - Total calculation accuracy
 * - Currency formatting
 * - Serial number sorting
 * - Responsive table rendering
 * - Empty state message display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOObjectivesSection, type IPOObjective } from '@/components/ipo-detail/IPOObjectivesSection';

describe('IPOObjectivesSection', () => {
  const mockObjectivesComplete: IPOObjective[] = [
    { sno: 1, description: 'Repayment of debt', amount: 500.50 },
    { sno: 2, description: 'Working capital requirements', amount: 300.00 },
    { sno: 3, description: 'Capital expenditure', amount: 200.25 },
    { sno: 4, description: 'General corporate purposes', amount: null },
  ];

  const mockObjectivesAllAllocated: IPOObjective[] = [
    { sno: 1, description: 'Repayment of debt', amount: 500.00 },
    { sno: 2, description: 'Working capital requirements', amount: 300.00 },
    { sno: 3, description: 'Capital expenditure', amount: 200.00 },
  ];

  const mockObjectivesUnordered: IPOObjective[] = [
    { sno: 3, description: 'Capital expenditure', amount: 200.00 },
    { sno: 1, description: 'Repayment of debt', amount: 500.00 },
    { sno: 2, description: 'Working capital requirements', amount: 300.00 },
  ];

  describe('Rendering with Complete Data', () => {
    it('should render section with title and icon', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('Objects of the Issue')).toBeInTheDocument();
      expect(screen.getByText(/Breakdown of how the IPO proceeds will be utilized/i)).toBeInTheDocument();
    });

    it('should render table headers correctly', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('S.No')).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    it('should display all objectives', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('Repayment of debt')).toBeInTheDocument();
      expect(screen.getByText('Working capital requirements')).toBeInTheDocument();
      expect(screen.getByText('Capital expenditure')).toBeInTheDocument();
      expect(screen.getByText('General corporate purposes')).toBeInTheDocument();
    });

    it('should display serial numbers correctly', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      const rows = screen.getAllByRole('row');
      // First row is header, skip it
      const dataRows = rows.slice(1);

      // Check that serial numbers are rendered
      expect(dataRows[0]).toHaveTextContent('1');
      expect(dataRows[1]).toHaveTextContent('2');
      expect(dataRows[2]).toHaveTextContent('3');
      expect(dataRows[3]).toHaveTextContent('4');
    });

    it('should format currency values correctly', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('₹500.50 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹300.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹200.25 Cr')).toBeInTheDocument();
    });

    it('should display information note', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText(/All amounts are in ₹ Crores/i)).toBeInTheDocument();
      expect(screen.getByText(/objects of the issue represent/i)).toBeInTheDocument();
    });
  });

  describe('Null Amount Handling', () => {
    it('should display "—" for null amounts', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      // Find the row with null amount (General corporate purposes)
      const generalPurposeRow = screen.getByText('General corporate purposes').closest('tr');
      expect(generalPurposeRow).toHaveTextContent('—');
    });

    it('should not include null amounts in total calculation', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      // Total should be 500.50 + 300.00 + 200.25 = 1000.75
      expect(screen.getByText('₹1000.75 Cr')).toBeInTheDocument();
    });

    it('should handle objectives with all null amounts', () => {
      const allNullAmounts: IPOObjective[] = [
        { sno: 1, description: 'General corporate purposes', amount: null },
        { sno: 2, description: 'Unallocated funds', amount: null },
      ];

      render(<IPOObjectivesSection objectives={allNullAmounts} />);

      // Total should be 0.00
      expect(screen.getByText('₹0.00 Cr')).toBeInTheDocument();

      // Both should show "—"
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBe(2);
    });
  });

  describe('Total Calculation', () => {
    it('should calculate total correctly with mixed amounts', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      // Expected: 500.50 + 300.00 + 200.25 = 1000.75
      expect(screen.getByText('₹1000.75 Cr')).toBeInTheDocument();
    });

    it('should calculate total correctly with all allocated amounts', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesAllAllocated} />);

      // Expected: 500.00 + 300.00 + 200.00 = 1000.00
      expect(screen.getByText('₹1000.00 Cr')).toBeInTheDocument();
    });

    it('should display "Total Allocated" label', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('Total Allocated')).toBeInTheDocument();
    });

    it('should handle decimal precision correctly', () => {
      const preciseAmounts: IPOObjective[] = [
        { sno: 1, description: 'Objective 1', amount: 123.456 },
        { sno: 2, description: 'Objective 2', amount: 234.567 },
      ];

      render(<IPOObjectivesSection objectives={preciseAmounts} />);

      // Total should be 123.456 + 234.567 = 358.023 → ₹358.02 Cr
      expect(screen.getByText('₹358.02 Cr')).toBeInTheDocument();
    });
  });

  describe('Serial Number Sorting', () => {
    it('should sort objectives by serial number ascending', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesUnordered} />);

      const rows = screen.getAllByRole('row');
      const dataRows = rows.slice(1); // Skip header row

      // First data row should have sno 1
      expect(dataRows[0]).toHaveTextContent('Repayment of debt');
      // Second data row should have sno 2
      expect(dataRows[1]).toHaveTextContent('Working capital requirements');
      // Third data row should have sno 3
      expect(dataRows[2]).toHaveTextContent('Capital expenditure');
    });

    it('should maintain sorting with mixed serial numbers', () => {
      const mixedOrder: IPOObjective[] = [
        { sno: 5, description: 'Fifth', amount: 100 },
        { sno: 1, description: 'First', amount: 100 },
        { sno: 3, description: 'Third', amount: 100 },
        { sno: 2, description: 'Second', amount: 100 },
        { sno: 4, description: 'Fourth', amount: 100 },
      ];

      render(<IPOObjectivesSection objectives={mixedOrder} />);

      const rows = screen.getAllByRole('row');
      const dataRows = rows.slice(1);

      expect(dataRows[0]).toHaveTextContent('First');
      expect(dataRows[1]).toHaveTextContent('Second');
      expect(dataRows[2]).toHaveTextContent('Third');
      expect(dataRows[3]).toHaveTextContent('Fourth');
      expect(dataRows[4]).toHaveTextContent('Fifth');
    });
  });

  describe('Empty State Handling', () => {
    it('should display empty state when objectives is null', () => {
      render(<IPOObjectivesSection objectives={null} />);

      expect(screen.getByText('Objects of the Issue')).toBeInTheDocument();
      expect(screen.getByText('IPO objectives not available')).toBeInTheDocument();
      expect(screen.getByText(/Fund utilization details will be available after DRHP filing/i)).toBeInTheDocument();
    });

    it('should display empty state when objectives is empty array', () => {
      render(<IPOObjectivesSection objectives={[]} />);

      expect(screen.getByText('Objects of the Issue')).toBeInTheDocument();
      expect(screen.getByText('IPO objectives not available')).toBeInTheDocument();
    });

    it('should not display table in empty state', () => {
      const { container } = render(<IPOObjectivesSection objectives={null} />);

      const table = container.querySelector('table');
      expect(table).not.toBeInTheDocument();
    });

    it('should not display total in empty state', () => {
      render(<IPOObjectivesSection objectives={[]} />);

      expect(screen.queryByText('Total Allocated')).not.toBeInTheDocument();
    });

    it('should display info icon in empty state', () => {
      const { container } = render(<IPOObjectivesSection objectives={null} />);

      // Check for Info icon (lucide-react renders SVG)
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Responsive Layout', () => {
    it('should have overflow-x-auto for horizontal scrolling', () => {
      const { container } = render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      const scrollContainer = container.querySelector('.overflow-x-auto');
      expect(scrollContainer).toBeInTheDocument();
    });

    it('should use Card component for structure', () => {
      const { container } = render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      // Card component adds specific classes
      expect(container.firstChild).toHaveClass('rounded-xl');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large amounts', () => {
      const largeAmounts: IPOObjective[] = [
        { sno: 1, description: 'Large allocation', amount: 999999.99 },
      ];

      render(<IPOObjectivesSection objectives={largeAmounts} />);

      // Should appear in table cell (not total) and total
      const largeAmountCells = screen.getAllByText('₹999999.99 Cr');
      expect(largeAmountCells.length).toBeGreaterThan(0);
    });

    it('should handle single objective', () => {
      const singleObjective: IPOObjective[] = [
        { sno: 1, description: 'Single purpose', amount: 100.00 },
      ];

      render(<IPOObjectivesSection objectives={singleObjective} />);

      expect(screen.getByText('Single purpose')).toBeInTheDocument();
      // Should appear in table cell and total
      const amounts = screen.getAllByText('₹100.00 Cr');
      expect(amounts.length).toBeGreaterThan(0);
    });

    it('should handle zero amount', () => {
      const zeroAmount: IPOObjective[] = [
        { sno: 1, description: 'Zero allocation', amount: 0 },
      ];

      render(<IPOObjectivesSection objectives={zeroAmount} />);

      // Should appear in table cell and total
      const zeroAmounts = screen.getAllByText('₹0.00 Cr');
      expect(zeroAmounts.length).toBeGreaterThan(0);
    });

    it('should handle very long descriptions', () => {
      const longDescription: IPOObjective[] = [
        {
          sno: 1,
          description: 'This is a very long description that might wrap to multiple lines in the table cell to test responsive behavior',
          amount: 100.00
        },
      ];

      render(<IPOObjectivesSection objectives={longDescription} />);

      expect(screen.getByText(/This is a very long description/i)).toBeInTheDocument();
    });

    it('should handle negative amounts gracefully', () => {
      const negativeAmount: IPOObjective[] = [
        { sno: 1, description: 'Negative value', amount: -100.00 },
      ];

      render(<IPOObjectivesSection objectives={negativeAmount} />);

      // Should appear in table cell and total
      const negativeAmounts = screen.getAllByText('₹-100.00 Cr');
      expect(negativeAmounts.length).toBeGreaterThan(0);
    });
  });

  describe('Optional Props', () => {
    it('should render without totalIssueSize prop', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      expect(screen.getByText('Objects of the Issue')).toBeInTheDocument();
    });

    it('should render with totalIssueSize prop', () => {
      render(
        <IPOObjectivesSection
          objectives={mockObjectivesComplete}
          totalIssueSize={1500}
        />
      );

      expect(screen.getByText('Objects of the Issue')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic HTML table structure', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should have proper table headers', () => {
      render(<IPOObjectivesSection objectives={mockObjectivesComplete} />);

      const columnHeaders = screen.getAllByRole('columnheader');
      expect(columnHeaders).toHaveLength(3); // S.No, Description, Amount
    });
  });
});
