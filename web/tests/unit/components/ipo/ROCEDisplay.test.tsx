/**
 * ROCEDisplay Component Unit Tests
 * Story 4.10: Enhanced Financial Metrics Display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ROCEDisplay } from '@/components/ipo/ROCEDisplay';

describe('ROCEDisplay Component', () => {
  describe('with valid ROCE', () => {
    it('displays ROCE with percentage sign', () => {
      render(<ROCEDisplay roce={18.5} />);
      expect(screen.getByText('18.50%')).toBeInTheDocument();
      expect(screen.getByText('ROCE:')).toBeInTheDocument();
    });

    it('formats string values correctly', () => {
      render(<ROCEDisplay roce="12.456" />);
      expect(screen.getByText('12.46%')).toBeInTheDocument();
    });

    it('rounds to 2 decimal places', () => {
      render(<ROCEDisplay roce={15.999} />);
      expect(screen.getByText('16.00%')).toBeInTheDocument();
    });

    it('displays info tooltip icon', () => {
      const { container } = render(<ROCEDisplay roce={15} />);
      const infoIcon = container.querySelector('svg');
      expect(infoIcon).toBeInTheDocument();
    });

    it('applies font-semibold to value', () => {
      render(<ROCEDisplay roce={15} />);
      const valueElement = screen.getByText('15.00%');
      expect(valueElement).toHaveClass('font-semibold');
    });

    it('applies padding to badge', () => {
      render(<ROCEDisplay roce={15} />);
      const valueElement = screen.getByText('15.00%');
      expect(valueElement).toHaveClass('px-2');
      expect(valueElement).toHaveClass('py-0.5');
    });
  });

  describe('color coding logic', () => {
    it('applies green color and background for ROCE > 15% (excellent)', () => {
      render(<ROCEDisplay roce={20} />);
      const valueElement = screen.getByText('20.00%');
      expect(valueElement).toHaveClass('text-green-700');
      expect(valueElement).toHaveClass('bg-green-50');
    });

    it('applies yellow color and background for ROCE 10-15% (good)', () => {
      render(<ROCEDisplay roce={12} />);
      const valueElement = screen.getByText('12.00%');
      expect(valueElement).toHaveClass('text-yellow-700');
      expect(valueElement).toHaveClass('bg-yellow-50');
    });

    it('applies red color and background for ROCE < 10% (poor)', () => {
      render(<ROCEDisplay roce={8} />);
      const valueElement = screen.getByText('8.00%');
      expect(valueElement).toHaveClass('text-red-700');
      expect(valueElement).toHaveClass('bg-red-50');
    });

    it('correctly handles boundary value 10% (yellow)', () => {
      render(<ROCEDisplay roce={10} />);
      const valueElement = screen.getByText('10.00%');
      expect(valueElement).toHaveClass('text-yellow-700');
      expect(valueElement).toHaveClass('bg-yellow-50');
    });

    it('correctly handles boundary value 15% (yellow)', () => {
      render(<ROCEDisplay roce={15} />);
      const valueElement = screen.getByText('15.00%');
      expect(valueElement).toHaveClass('text-yellow-700');
      expect(valueElement).toHaveClass('bg-yellow-50');
    });

    it('correctly handles value just above 15% (green)', () => {
      render(<ROCEDisplay roce={15.01} />);
      const valueElement = screen.getByText('15.01%');
      expect(valueElement).toHaveClass('text-green-700');
      expect(valueElement).toHaveClass('bg-green-50');
    });

    it('correctly handles value just below 10% (red)', () => {
      render(<ROCEDisplay roce={9.99} />);
      const valueElement = screen.getByText('9.99%');
      expect(valueElement).toHaveClass('text-red-700');
      expect(valueElement).toHaveClass('bg-red-50');
    });
  });

  describe('dark mode classes', () => {
    it('applies dark mode green classes for excellent ROCE', () => {
      render(<ROCEDisplay roce={20} />);
      const valueElement = screen.getByText('20.00%');
      expect(valueElement).toHaveClass('dark:text-green-400');
      expect(valueElement).toHaveClass('dark:bg-green-950/30');
    });

    it('applies dark mode yellow classes for good ROCE', () => {
      render(<ROCEDisplay roce={12} />);
      const valueElement = screen.getByText('12.00%');
      expect(valueElement).toHaveClass('dark:text-yellow-400');
      expect(valueElement).toHaveClass('dark:bg-yellow-950/30');
    });

    it('applies dark mode red classes for poor ROCE', () => {
      render(<ROCEDisplay roce={8} />);
      const valueElement = screen.getByText('8.00%');
      expect(valueElement).toHaveClass('dark:text-red-400');
      expect(valueElement).toHaveClass('dark:bg-red-950/30');
    });
  });

  describe('null/undefined handling', () => {
    it('displays "N/A" for null ROCE', () => {
      render(<ROCEDisplay roce={null} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
      expect(screen.getByText('ROCE:')).toBeInTheDocument();
    });

    it('displays "N/A" for undefined ROCE', () => {
      render(<ROCEDisplay roce={null} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('applies muted text color for N/A state', () => {
      render(<ROCEDisplay roce={null} />);
      const naText = screen.getByText('N/A');
      expect(naText).toHaveClass('text-muted-foreground');
    });

    it('displays explanatory tooltip for N/A state', () => {
      const { container } = render(<ROCEDisplay roce={null} />);
      const infoIcon = container.querySelector('svg');
      expect(infoIcon).toBeInTheDocument();
    });

    it('does not apply background color for N/A state', () => {
      render(<ROCEDisplay roce={null} />);
      const naText = screen.getByText('N/A');
      expect(naText).not.toHaveClass('bg-green-50');
      expect(naText).not.toHaveClass('bg-yellow-50');
      expect(naText).not.toHaveClass('bg-red-50');
    });
  });

  describe('custom styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <ROCEDisplay roce={15} className="custom-class" />
      );
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('custom-class');
    });

    it('applies rounded corners to badge', () => {
      render(<ROCEDisplay roce={15} />);
      const valueElement = screen.getByText('15.00%');
      expect(valueElement).toHaveClass('rounded');
    });
  });

  describe('edge cases', () => {
    it('handles zero ROCE (red)', () => {
      render(<ROCEDisplay roce={0} />);
      expect(screen.getByText('0.00%')).toBeInTheDocument();
      const valueElement = screen.getByText('0.00%');
      expect(valueElement).toHaveClass('text-red-700');
      expect(valueElement).toHaveClass('bg-red-50');
    });

    it('handles negative ROCE (red)', () => {
      render(<ROCEDisplay roce={-5} />);
      expect(screen.getByText('-5.00%')).toBeInTheDocument();
      const valueElement = screen.getByText('-5.00%');
      expect(valueElement).toHaveClass('text-red-700');
      expect(valueElement).toHaveClass('bg-red-50');
    });

    it('handles very high ROCE (green)', () => {
      render(<ROCEDisplay roce={50} />);
      expect(screen.getByText('50.00%')).toBeInTheDocument();
      const valueElement = screen.getByText('50.00%');
      expect(valueElement).toHaveClass('text-green-700');
      expect(valueElement).toHaveClass('bg-green-50');
    });

    it('handles decimal string with extra precision', () => {
      render(<ROCEDisplay roce="18.123456789" />);
      expect(screen.getByText('18.12%')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('renders label and value for screen readers', () => {
      render(<ROCEDisplay roce={15} />);
      expect(screen.getByText('ROCE:')).toBeInTheDocument();
      expect(screen.getByText('15.00%')).toBeInTheDocument();
    });

    it('maintains flex layout for proper alignment', () => {
      const { container } = render(<ROCEDisplay roce={15} />);
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('flex');
      expect(wrapper).toHaveClass('items-center');
    });
  });
});
