/**
 * Unit Tests for CategoryReservationSection Component
 * Story 11.15 - Category-wise Reservation Display
 *
 * Tests cover:
 * 1. Component renders table with all categories when data complete
 * 2. Component calculates and displays percentages correctly
 * 3. Component hides Employee category when null
 * 4. Component hides Anchor category when null
 * 5. Component shows empty state when no reservation data available
 * 6. Component formats numbers in Indian format
 * 7. Component calculates total shares correctly
 * 8. Component shows max allottees only for Retail category
 * 9. Component handles edge case: all share counts zero
 * 10. Component has proper accessibility (ARIA labels)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';

describe('CategoryReservationSection', () => {
  describe('Complete Data Rendering', () => {
    it('should render table with all 5 categories when data is complete', () => {
      const completeData = {
        qibSharesOffered: 117975000,
        niiSharesOffered: 35392500,
        retailSharesOffered: 82582500,
        retailMaxAllottees: 589875,
        employeeSharesOffered: 1550000,
        anchorSharesOffered: 70785000,
      };

      render(<CategoryReservationSection reservationData={completeData} />);

      // Check header
      expect(screen.getByText('Category-wise Reservation')).toBeInTheDocument();

      // Check all 5 categories are present (using getAllByText since they appear in table and distribution)
      expect(screen.getAllByText(/Qualified Institutional Buyers/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Non-Institutional Investors/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Retail Individual Investors/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Employee Reservation/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Anchor Investors/i).length).toBeGreaterThan(0);

      // Check total row
      expect(screen.getByText('Total')).toBeInTheDocument();
    });

    it('should display share counts in Indian number format', () => {
      const completeData = {
        qibSharesOffered: 117975000,
        niiSharesOffered: 35392500,
        retailSharesOffered: 82582500,
        retailMaxAllottees: 589875,
        employeeSharesOffered: 1550000,
        anchorSharesOffered: 70785000,
      };

      render(<CategoryReservationSection reservationData={completeData} />);

      // Check Indian number formatting (with commas)
      expect(screen.getByText('11,79,75,000')).toBeInTheDocument(); // QIB
      expect(screen.getByText('3,53,92,500')).toBeInTheDocument(); // NII
      expect(screen.getByText('8,25,82,500')).toBeInTheDocument(); // Retail
      expect(screen.getByText('15,50,000')).toBeInTheDocument(); // Employee
      expect(screen.getByText('7,07,85,000')).toBeInTheDocument(); // Anchor
    });
  });

  describe('Percentage Calculation', () => {
    it('should calculate and display percentage for each category with 2 decimal places', () => {
      const data = {
        qibSharesOffered: 49670000, // 49.67%
        niiSharesOffered: 14900000, // 14.90%
        retailSharesOffered: 34770000, // 34.77%
        retailMaxAllottees: null,
        employeeSharesOffered: 650000, // 0.65%
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Check percentages with 2 decimal places (getAllByText since they appear in table and distribution)
      expect(screen.getAllByText('49.67%').length).toBeGreaterThan(0);
      expect(screen.getAllByText('14.90%').length).toBeGreaterThan(0);
      expect(screen.getAllByText('34.77%').length).toBeGreaterThan(0);
      expect(screen.getAllByText('0.65%').length).toBeGreaterThan(0);
    });

    it('should calculate total as 100.00%', () => {
      const data = {
        qibSharesOffered: 50000000,
        niiSharesOffered: 30000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Total percentage should always be 100.00%
      expect(screen.getByText('100.00%')).toBeInTheDocument();
    });
  });

  describe('Optional Categories', () => {
    it('should hide Employee category when employeeSharesOffered is null', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: 100000,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Employee should NOT be displayed
      expect(screen.queryByText(/Employee Reservation/i)).not.toBeInTheDocument();

      // But QIB, NII, Retail should be displayed (using getAllByText)
      expect(screen.getAllByText(/Qualified Institutional Buyers/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Non-Institutional Investors/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Retail Individual Investors/i).length).toBeGreaterThan(0);
    });

    it('should hide Anchor category when anchorSharesOffered is null', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: 100000,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Anchor should NOT be displayed
      expect(screen.queryByText(/Anchor Investors/i)).not.toBeInTheDocument();
    });

    it('should hide categories when share count is zero', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: 100000,
        employeeSharesOffered: 0, // Zero shares offered
        anchorSharesOffered: 0,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Categories with 0 shares should be hidden
      expect(screen.queryByText(/Employee Reservation/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Anchor Investors/i)).not.toBeInTheDocument();
    });
  });

  describe('Total Calculation', () => {
    it('should calculate total shares correctly (sum of all categories)', () => {
      const data = {
        qibSharesOffered: 100000000,
        niiSharesOffered: 50000000,
        retailSharesOffered: 30000000,
        retailMaxAllottees: null,
        employeeSharesOffered: 10000000,
        anchorSharesOffered: 20000000,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Total = 100M + 50M + 30M + 10M + 20M = 210M (getAllByText since appears multiple times)
      expect(screen.getAllByText('21,00,00,000').length).toBeGreaterThan(0);
    });

    it('should calculate total correctly with only mandatory categories', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Total = 60M + 20M + 20M = 100M (getAllByText since appears in total row and summary)
      expect(screen.getAllByText('10,00,00,000').length).toBeGreaterThan(0);
    });
  });

  describe('Max Allottees Display', () => {
    it('should show max allottees for Retail category', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: 589875,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Max allottees should be displayed in Indian format
      expect(screen.getByText('5,89,875')).toBeInTheDocument();
    });

    it('should show "N/A" for categories without max allottees', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Should have multiple "N/A" entries (for QIB, NII, and potentially Retail if null)
      const naElements = screen.getAllByText('N/A');
      expect(naElements.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should not render when reservationData is null', () => {
      const { container } = render(<CategoryReservationSection reservationData={null} />);

      // Component should return null - container should be empty
      expect(container.firstChild).toBeNull();
    });

    it('should not render when all share counts are null', () => {
      const data = {
        qibSharesOffered: null,
        niiSharesOffered: null,
        retailSharesOffered: null,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      const { container } = render(<CategoryReservationSection reservationData={data} />);

      // Component should return null - no categories to display
      expect(container.firstChild).toBeNull();
    });

    it('should not render when all share counts are zero', () => {
      const data = {
        qibSharesOffered: 0,
        niiSharesOffered: 0,
        retailSharesOffered: 0,
        retailMaxAllottees: null,
        employeeSharesOffered: 0,
        anchorSharesOffered: 0,
      };

      const { container } = render(<CategoryReservationSection reservationData={data} />);

      // Component should return null - no valid categories to display
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Visual Elements', () => {
    it('should render visual percentage distribution bars', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Check for "Reservation Distribution" section
      expect(screen.getByText('Reservation Distribution')).toBeInTheDocument();
    });

    it('should render information note about SEBI guidelines', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Check for SEBI guidelines note
      expect(screen.getByText(/SEBI guidelines/i)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have descriptive category names with tooltips', () => {
      const data = {
        qibSharesOffered: 60000000,
        niiSharesOffered: 20000000,
        retailSharesOffered: 20000000,
        retailMaxAllottees: null,
        employeeSharesOffered: null,
        anchorSharesOffered: null,
      };

      render(<CategoryReservationSection reservationData={data} />);

      // Check for descriptive text
      expect(
        screen.getByText(/Institutional investors like mutual funds, insurance companies/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/HNI investors with application size above ₹2 lakhs/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Individual investors with application size up to ₹2 lakhs/i)
      ).toBeInTheDocument();
    });
  });
});
