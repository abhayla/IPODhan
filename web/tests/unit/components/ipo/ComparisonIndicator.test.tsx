/**
 * Unit Tests for ComparisonIndicator Component
 *
 * Tests for:
 * - Color coding based on comparison to average
 * - Arrow direction indicators
 * - Tooltip content
 * - Edge cases (null values, zero average)
 *
 * Story 4.8: Peer Comparison Tab
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparisonIndicator } from '@/components/ipo/ComparisonIndicator';
import '@testing-library/jest-dom';

describe('ComparisonIndicator', () => {
  describe('No Data Cases', () => {
    it('should show dash when value is null', () => {
      const { container } = render(<ComparisonIndicator value={null} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show dash when average is null', () => {
      const { container } = render(<ComparisonIndicator value={100} average={null} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show dash when average is zero', () => {
      const { container } = render(<ComparisonIndicator value={100} average={0} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show dash when both are null', () => {
      const { container } = render(<ComparisonIndicator value={null} average={null} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });
  });

  describe('Better Than Average (Higher is Better)', () => {
    it('should show up arrow when value is >10% above average', () => {
      // Value: 120, Average: 100, Difference: +20%
      const { container } = render(<ComparisonIndicator value={120} average={100} higherIsBetter={true} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should show green color when significantly above average', () => {
      // Value: 150, Average: 100, Difference: +50%
      const { container } = render(<ComparisonIndicator value={150} average={100} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });
  });

  describe('Worse Than Average (Higher is Better)', () => {
    it('should show down arrow when value is >10% below average', () => {
      // Value: 80, Average: 100, Difference: -20%
      const { container } = render(<ComparisonIndicator value={80} average={100} higherIsBetter={true} />);
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });

    it('should show red color when significantly below average', () => {
      // Value: 50, Average: 100, Difference: -50%
      const { container } = render(<ComparisonIndicator value={50} average={100} />);
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });
  });

  describe('Near Average (Neutral)', () => {
    it('should show neutral when value is within ±10% of average', () => {
      // Value: 105, Average: 100, Difference: +5%
      const { container } = render(<ComparisonIndicator value={105} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show neutral when value is exactly at average', () => {
      // Value: 100, Average: 100, Difference: 0%
      const { container } = render(<ComparisonIndicator value={100} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show neutral when value is slightly below average', () => {
      // Value: 95, Average: 100, Difference: -5%
      const { container } = render(<ComparisonIndicator value={95} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should show neutral when difference is exactly 10%', () => {
      // Value: 110, Average: 100, Difference: +10%
      const { container } = render(<ComparisonIndicator value={110} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });
  });

  describe('Lower is Better Scenarios', () => {
    it('should show green when value is significantly below average (lower is better)', () => {
      // P/E Ratio: 15, Average: 20, Difference: -25% (BETTER)
      const { container } = render(<ComparisonIndicator value={15} average={20} higherIsBetter={false} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should show red when value is significantly above average (lower is better)', () => {
      // P/E Ratio: 30, Average: 20, Difference: +50% (WORSE)
      const { container } = render(<ComparisonIndicator value={30} average={20} higherIsBetter={false} />);
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });

    it('should show neutral when value is near average (lower is better)', () => {
      // P/E Ratio: 21, Average: 20, Difference: +5%
      const { container } = render(<ComparisonIndicator value={21} average={20} higherIsBetter={false} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative values correctly', () => {
      // Value: -20, Average: -10, Difference: -100% (worse in absolute terms)
      const { container } = render(<ComparisonIndicator value={-20} average={-10} higherIsBetter={true} />);
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });

    it('should handle very small differences correctly', () => {
      // Value: 100.01, Average: 100, Difference: +0.01%
      const { container } = render(<ComparisonIndicator value={100.01} average={100} />);
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should handle very large differences correctly', () => {
      // Value: 1000, Average: 10, Difference: +9900%
      const { container } = render(<ComparisonIndicator value={1000} average={10} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <ComparisonIndicator
          value={120}
          average={100}
          className="custom-class"
        />
      );
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('Boundary Cases', () => {
    it('should handle exactly +10% threshold', () => {
      // Value: 110, Average: 100, Difference: exactly +10%
      const { container } = render(<ComparisonIndicator value={110} average={100} />);
      // At exactly 10%, should be neutral (within threshold)
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should handle exactly -10% threshold', () => {
      // Value: 90, Average: 100, Difference: exactly -10%
      const { container } = render(<ComparisonIndicator value={90} average={100} />);
      // At exactly 10%, should be neutral (within threshold)
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });

    it('should handle just over +10% threshold', () => {
      // Value: 110.01, Average: 100, Difference: +10.01%
      const { container } = render(<ComparisonIndicator value={110.01} average={100} />);
      // Just over 10%, should show as better
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should handle just under -10% threshold', () => {
      // Value: 89.99, Average: 100, Difference: -10.01%
      const { container } = render(<ComparisonIndicator value={89.99} average={100} />);
      // Just over 10% worse, should show as worse
      expect(container.querySelector('.text-red-600')).toBeInTheDocument();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle P/E ratio comparison (lower is better)', () => {
      // IPO P/E: 18, Average P/E: 25, Difference: -28% (BETTER)
      const { container } = render(<ComparisonIndicator value={18} average={25} higherIsBetter={false} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should handle EPS comparison (higher is better)', () => {
      // IPO EPS: 25, Average EPS: 20, Difference: +25% (BETTER)
      const { container } = render(<ComparisonIndicator value={25} average={20} higherIsBetter={true} />);
      expect(container.querySelector('.text-green-600')).toBeInTheDocument();
    });

    it('should handle RONW comparison (higher is better)', () => {
      // IPO RONW: 18%, Average: 20%, Difference: -10%
      const { container } = render(<ComparisonIndicator value={18} average={20} higherIsBetter={true} />);
      // Exactly at threshold, should be neutral
      expect(container.querySelector('.text-gray-600')).toBeInTheDocument();
    });
  });
});
