/**
 * Unit Tests for IssueBreakdownChart Component (Story 4.11)
 * Tests pie chart rendering for Fresh Issue vs OFS breakdown.
 *
 * GitHub #8 (unit consistency): fresh_issue / ofs_issue are stored in RUPEES
 * (same convention as ipos.issue_size, which they sum to; field-priority-matrix
 * normalizes all three with normalization:'currency'). The component converts
 * rupees -> crore for display. Inputs below are therefore in RUPEES
 * (e.g. 3_000_000_000 = ₹300.00 Cr). The previous version of this test passed
 * bare crore numbers ("300" -> "₹300.00 Cr"), which encoded the wrong unit.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IssueBreakdownChart } from '@/components/ipo/IssueBreakdownChart';

const CR = 10000000; // rupees per crore

describe('IssueBreakdownChart', () => {
  describe('Data Display', () => {
    it('should render chart with both Fresh Issue and OFS', () => {
      render(<IssueBreakdownChart freshIssue={String(300 * CR)} ofsIssue={String(200 * CR)} />);

      // Check for breakdown summary
      expect(screen.getByText('Fresh Issue')).toBeInTheDocument();
      expect(screen.getByText('Offer for Sale (OFS)')).toBeInTheDocument();
      expect(screen.getByText('Total Issue Size')).toBeInTheDocument();

      // Check for amounts (rupees rendered as crore)
      expect(screen.getByText('₹300.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹200.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹500.00 Cr')).toBeInTheDocument();
    });

    it('should render chart with only Fresh Issue (100%)', () => {
      render(<IssueBreakdownChart freshIssue={String(500 * CR)} ofsIssue="0" />);

      expect(screen.getByText('Fresh Issue')).toBeInTheDocument();
      expect(screen.queryByText(/Offer for Sale/)).not.toBeInTheDocument();
      expect(screen.getAllByText('₹500.00 Cr').length).toBeGreaterThan(0);
    });

    it('should render chart with only OFS (100%)', () => {
      render(<IssueBreakdownChart freshIssue="0" ofsIssue={String(400 * CR)} />);

      expect(screen.getByText('Offer for Sale (OFS)')).toBeInTheDocument();
      expect(screen.queryByText(/Fresh Issue/)).not.toBeInTheDocument();
      expect(screen.getAllByText('₹400.00 Cr').length).toBeGreaterThan(0);
    });

    it('should calculate and display correct percentages', () => {
      render(<IssueBreakdownChart freshIssue={String(600 * CR)} ofsIssue={String(400 * CR)} />);

      // Fresh Issue: 600/1000 = 60%; OFS: 400/1000 = 40%
      expect(screen.getByText('Fresh Issue')).toBeInTheDocument();
      expect(screen.getByText('Offer for Sale (OFS)')).toBeInTheDocument();
      expect(screen.getByText('₹600.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹400.00 Cr')).toBeInTheDocument();
    });
  });

  describe('Null/Empty Data Handling', () => {
    it('should show no data message when both values are null', () => {
      render(<IssueBreakdownChart freshIssue={null} ofsIssue={null} />);

      expect(screen.getByText('No issue breakdown data available')).toBeInTheDocument();
    });

    it('should show no data message when both values are 0', () => {
      render(<IssueBreakdownChart freshIssue="0" ofsIssue="0" />);

      expect(screen.getByText('No issue breakdown data available')).toBeInTheDocument();
    });

    it('should handle undefined values', () => {
      render(<IssueBreakdownChart freshIssue={undefined} ofsIssue={undefined} />);

      expect(screen.getByText('No issue breakdown data available')).toBeInTheDocument();
    });
  });

  describe('Number Type Handling', () => {
    it('should handle numeric values', () => {
      render(<IssueBreakdownChart freshIssue={250 * CR} ofsIssue={150 * CR} />);

      expect(screen.getByText('₹250.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹150.00 Cr')).toBeInTheDocument();
    });

    it('should handle string numeric values', () => {
      render(<IssueBreakdownChart freshIssue={String(350.5 * CR)} ofsIssue={String(249.5 * CR)} />);

      expect(screen.getByText('₹350.50 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹249.50 Cr')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small values', () => {
      render(<IssueBreakdownChart freshIssue={String(0.5 * CR)} ofsIssue={String(0.3 * CR)} />);

      expect(screen.getByText('Fresh Issue')).toBeInTheDocument();
      expect(screen.getByText('Offer for Sale (OFS)')).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      render(<IssueBreakdownChart freshIssue={String(5000 * CR)} ofsIssue={String(3000 * CR)} />);

      expect(screen.getByText('₹5000.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹3000.00 Cr')).toBeInTheDocument();
    });

    it('should handle decimal percentages correctly', () => {
      render(<IssueBreakdownChart freshIssue={String(333 * CR)} ofsIssue={String(667 * CR)} />);

      // 333/1000 = 33.3%, 667/1000 = 66.7%
      expect(screen.getByText('₹333.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹667.00 Cr')).toBeInTheDocument();
      expect(screen.getByText('₹1000.00 Cr')).toBeInTheDocument();
    });
  });

  describe('Responsive Container', () => {
    it('should render ResponsiveContainer', () => {
      const { container } = render(<IssueBreakdownChart freshIssue={String(300 * CR)} ofsIssue={String(200 * CR)} />);

      const responsiveContainer = container.querySelector('div');
      expect(responsiveContainer).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <IssueBreakdownChart freshIssue={String(300 * CR)} ofsIssue={String(200 * CR)} className="custom-chart" />
      );

      expect(container.firstChild).toHaveClass('custom-chart');
    });
  });
});
