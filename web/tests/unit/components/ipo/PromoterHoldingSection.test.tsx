/**
 * Unit Tests for PromoterHoldingSection Component
 * Story 11.9 - AC#6
 *
 * Tests cover:
 * 1. Component renders correctly with valid data
 * 2. Component calculates dilution correctly
 * 3. Component shows empty state when data is null
 * 4. Component handles edge cases (0%, 100%, negative dilution)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromoterHoldingSection } from '@/components/ipo/PromoterHoldingSection';

describe('PromoterHoldingSection', () => {
  describe('Valid Data Rendering', () => {
    it('should render promoter holding data with valid pre and post issue values', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={77.5}
          promoterHoldingPostIssue={62.3}
        />
      );

      // Check header
      expect(screen.getByText('Promoter Holding Pattern')).toBeInTheDocument();

      // Check pre-issue holding
      expect(screen.getByText('Promoter Holding Pre Issue')).toBeInTheDocument();
      expect(screen.getByText('77.50%')).toBeInTheDocument();

      // Check post-issue holding
      expect(screen.getByText('Promoter Holding Post Issue')).toBeInTheDocument();
      expect(screen.getByText('62.30%')).toBeInTheDocument();

      // Check dilution is displayed
      expect(screen.getByText('Equity Dilution')).toBeInTheDocument();
      expect(screen.getByText('15.20%')).toBeInTheDocument();
    });

    it('should render with decimal precision (2 decimal places)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={85.67}
          promoterHoldingPostIssue={72.34}
        />
      );

      expect(screen.getByText('85.67%')).toBeInTheDocument();
      expect(screen.getByText('72.34%')).toBeInTheDocument();
      expect(screen.getByText('13.33%')).toBeInTheDocument(); // dilution
    });
  });

  describe('Dilution Calculation', () => {
    it('should calculate dilution correctly (85.50% - 70.25% = 15.25%)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={85.5}
          promoterHoldingPostIssue={70.25}
        />
      );

      expect(screen.getByText('15.25%')).toBeInTheDocument();
    });

    it('should calculate dilution with proper rounding', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={77.78}
          promoterHoldingPostIssue={62.22}
        />
      );

      // Display values with toFixed(2)
      expect(screen.getByText('77.78%')).toBeInTheDocument();
      expect(screen.getByText('62.22%')).toBeInTheDocument();
      // 77.78 - 62.22 = 15.56
      expect(screen.getByText('15.56%')).toBeInTheDocument();
    });

    it('should show low dilution indicator (<10%)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={75.0}
          promoterHoldingPostIssue={68.0}
        />
      );

      // Dilution = 7%
      expect(screen.getByText('7.00%')).toBeInTheDocument();
      expect(
        screen.getByText(/Low dilution suggests high promoter confidence/i)
      ).toBeInTheDocument();
    });

    it('should show moderate dilution indicator (10-20%)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={80.0}
          promoterHoldingPostIssue={65.0}
        />
      );

      // Dilution = 15%
      expect(screen.getByText('15.00%')).toBeInTheDocument();
      expect(
        screen.getByText(/Moderate dilution is common in IPOs/i)
      ).toBeInTheDocument();
    });

    it('should show high dilution indicator (>20%)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={85.0}
          promoterHoldingPostIssue={55.0}
        />
      );

      // Dilution = 30%
      expect(screen.getByText('30.00%')).toBeInTheDocument();
      expect(
        screen.getByText(/High dilution may indicate significant fundraising needs/i)
      ).toBeInTheDocument();
    });
  });

  describe('Empty State Handling', () => {
    it('should show empty state when both fields are null', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={null}
          promoterHoldingPostIssue={null}
        />
      );

      expect(
        screen.getByText('Promoter Holding Data Not Available')
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Promoter shareholding information is not yet available for this IPO/i
        )
      ).toBeInTheDocument();

      // Should not show data sections
      expect(
        screen.queryByText('Promoter Holding Pre Issue')
      ).not.toBeInTheDocument();
    });

    it('should show partial data when only pre-issue is available', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={75.0}
          promoterHoldingPostIssue={null}
        />
      );

      expect(screen.getByText('75.00%')).toBeInTheDocument();
      expect(screen.getByText('Post-IPO data not available yet')).toBeInTheDocument();

      // Should not show dilution section
      expect(screen.queryByText('Equity Dilution')).not.toBeInTheDocument();
    });

    it('should show partial data when only post-issue is available', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={null}
          promoterHoldingPostIssue={62.0}
        />
      );

      expect(screen.getByText('62.00%')).toBeInTheDocument();
      expect(screen.getByText('Pre-IPO data not available')).toBeInTheDocument();

      // Should not show dilution section
      expect(screen.queryByText('Equity Dilution')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle 0% dilution (no change in holding)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={75.0}
          promoterHoldingPostIssue={75.0}
        />
      );

      expect(screen.getByText('0.00%')).toBeInTheDocument();
      // 0% is < 10%, so should show low dilution message
      expect(
        screen.getByText(/Low dilution suggests high promoter confidence/i)
      ).toBeInTheDocument();
    });

    it('should handle 100% pre-issue holding', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={100.0}
          promoterHoldingPostIssue={75.0}
        />
      );

      expect(screen.getByText('100.00%')).toBeInTheDocument();
      expect(screen.getByText('75.00%')).toBeInTheDocument();
      expect(screen.getByText('25.00%')).toBeInTheDocument();
    });

    it('should handle negative dilution (increase in holding - unusual but possible)', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={60.0}
          promoterHoldingPostIssue={65.0}
        />
      );

      // Negative dilution: 60 - 65 = -5
      expect(screen.getByText('-5.00%')).toBeInTheDocument();
    });

    it('should handle very small percentages', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={0.5}
          promoterHoldingPostIssue={0.25}
        />
      );

      expect(screen.getByText('0.50%')).toBeInTheDocument();
      // Note: 0.25% appears twice (once for post-issue, once for dilution)
      const percentages = screen.getAllByText('0.25%');
      expect(percentages).toHaveLength(2);
    });

    it('should handle boundary values for dilution thresholds', () => {
      // Exactly 10% - should show moderate dilution
      const { rerender } = render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={80.0}
          promoterHoldingPostIssue={70.0}
        />
      );

      expect(
        screen.getByText(/Moderate dilution is common in IPOs/i)
      ).toBeInTheDocument();

      // Exactly 20% - should still show moderate dilution
      rerender(
        <PromoterHoldingSection
          promoterHoldingPreIssue={80.0}
          promoterHoldingPostIssue={60.0}
        />
      );

      expect(
        screen.getByText(/Moderate dilution is common in IPOs/i)
      ).toBeInTheDocument();

      // 20.01% - should show high dilution
      rerender(
        <PromoterHoldingSection
          promoterHoldingPreIssue={80.01}
          promoterHoldingPostIssue={60.0}
        />
      );

      expect(
        screen.getByText(/High dilution may indicate significant fundraising needs/i)
      ).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper title text', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={77.0}
          promoterHoldingPostIssue={62.0}
        />
      );

      // CardTitle doesn't use semantic heading tag but should have the text
      expect(screen.getByText('Promoter Holding Pattern')).toBeInTheDocument();
    });

    it('should have descriptive helper text', () => {
      render(
        <PromoterHoldingSection
          promoterHoldingPreIssue={77.0}
          promoterHoldingPostIssue={62.0}
        />
      );

      expect(
        screen.getByText(/Promoter holding data is sourced from the company/i)
      ).toBeInTheDocument();
    });
  });
});
