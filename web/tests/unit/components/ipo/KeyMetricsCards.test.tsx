import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyMetricsCards } from '@/components/ipo/KeyMetricsCards';

describe('KeyMetricsCards', () => {
  it('should render all 3 metric cards', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={25.6}
        gmp={100}
        gmpPercent={15}
      />
    );

    expect(screen.getByText('Issue Size')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Grey Market Premium')).toBeInTheDocument();
  });

  it('should format issue size correctly', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={null}
        gmp={null}
        gmpPercent={null}
      />
    );

    expect(screen.getByText('₹500 Crores')).toBeInTheDocument();
  });

  it('should format subscription with times subscribed', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={25.6}
        gmp={null}
        gmpPercent={null}
      />
    );

    expect(screen.getByText('25.60x')).toBeInTheDocument();
    expect(screen.getByText('Oversubscribed')).toBeInTheDocument();
  });

  it('should show undersubscribed for subscription < 1', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={0.5}
        gmp={null}
        gmpPercent={null}
      />
    );

    expect(screen.getByText('Undersubscribed')).toBeInTheDocument();
  });

  it('should show N/A for null subscription', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={null}
        gmp={null}
        gmpPercent={null}
      />
    );

    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('should format GMP with percentage', () => {
    render(
      <KeyMetricsCards
        issueSize={500}
        subscription={null}
        gmp={100}
        gmpPercent={15.5}
      />
    );

    expect(screen.getByText('+15.50%')).toBeInTheDocument();
  });

  it('should apply green color for positive GMP', () => {
    const { container } = render(
      <KeyMetricsCards
        issueSize={500}
        subscription={null}
        gmp={100}
        gmpPercent={15}
      />
    );

    const gmpValue = container.querySelector('.text-green-600');
    expect(gmpValue).toBeInTheDocument();
  });

  it('should apply red color for negative GMP', () => {
    const { container } = render(
      <KeyMetricsCards
        issueSize={500}
        subscription={null}
        gmp={-50}
        gmpPercent={-10}
      />
    );

    const gmpValue = container.querySelector('.text-red-600');
    expect(gmpValue).toBeInTheDocument();
  });
});
