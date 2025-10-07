import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriptionBreakdown } from '@/components/ipo/SubscriptionBreakdown';
import type { Subscription } from '@/lib/db/types';

const mockSubscription: Subscription = {
  id: '1',
  ipoId: 'ipo-1',
  timestamp: new Date('2025-01-10T10:00:00'),
  qibSubscription: '45.20',
  niiSubscription: '12.50',
  retailSubscription: '8.30',
  totalSubscription: '25.60',
  employeeSubscription: '0.00',
  othersSubscription: '0.00',
  anchorInvestorSubscription: '0.00',
  retailHNISubscription: '0.00',
  retailOthersSubscription: '0.00',
  bNIISubscription: '0.00',
  sNIISubscription: '0.00',
  totalApplications: 50000,
  totalSharesBid: 10000000,
  sharesOffered: 5000000,
};

describe('SubscriptionBreakdown', () => {
  it('should display "not available" message when subscription is null', () => {
    render(<SubscriptionBreakdown subscription={null} />);
    expect(
      screen.getByText('Subscription data not available yet')
    ).toBeInTheDocument();
  });

  it('should render total subscription', () => {
    render(<SubscriptionBreakdown subscription={mockSubscription} />);
    expect(screen.getByText('25.60x')).toBeInTheDocument();
  });

  it('should render all three categories', () => {
    render(<SubscriptionBreakdown subscription={mockSubscription} />);

    expect(
      screen.getByText('QIB (Qualified Institutional Buyers)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('NII (Non-Institutional Investors)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Retail Individual Investors')
    ).toBeInTheDocument();
  });

  it('should display subscription values for each category', () => {
    render(<SubscriptionBreakdown subscription={mockSubscription} />);

    expect(screen.getByText('45.20x')).toBeInTheDocument();
    expect(screen.getByText('12.50x')).toBeInTheDocument();
    expect(screen.getByText('8.30x')).toBeInTheDocument();
  });

  it('should render progress bars', () => {
    const { container } = render(
      <SubscriptionBreakdown subscription={mockSubscription} />
    );

    const progressBars = container.querySelectorAll('.h-6.rounded-full');
    expect(progressBars.length).toBeGreaterThanOrEqual(3);
  });

  it('should apply green color for subscription >= 1', () => {
    const { container } = render(
      <SubscriptionBreakdown subscription={mockSubscription} />
    );

    const greenBars = container.querySelectorAll('.bg-green-500');
    expect(greenBars.length).toBeGreaterThan(0);
  });

  it('should display additional metrics when available', () => {
    render(<SubscriptionBreakdown subscription={mockSubscription} />);

    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('1,00,00,000')).toBeInTheDocument();
  });

  it('should format timestamp correctly', () => {
    render(<SubscriptionBreakdown subscription={mockSubscription} />);
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });
});
