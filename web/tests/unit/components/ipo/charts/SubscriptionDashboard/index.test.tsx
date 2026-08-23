/**
 * Unit tests for SubscriptionDashboard header framing (T-302 / P3-15)
 *
 * "Real-time tracking for {companyName}" is only honest while bidding is
 * ongoing — a LISTED IPO's dashboard kept that present-tense framing days
 * after the IPO had already listed (round-5 review finding P3-15).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriptionDashboard } from '@/components/ipo/charts/SubscriptionDashboard';
import type { SubscriptionDataRaw } from '@/lib/utils/chart-data';

vi.mock('@/components/ipo/charts/base/AreaChartBase', () => ({
  AreaChartBase: () => <div data-testid="area-chart-stub" />,
}));

const subscriptions: SubscriptionDataRaw[] = [
  {
    id: 'sub-1',
    timestamp: '2025-08-12',
    totalSubscription: 108,
    subscriptionQIB: 50,
    subscriptionNII: 40,
    subscriptionRetail: 18,
  },
];

describe('SubscriptionDashboard — status-aware header (P3-15)', () => {
  it('shows "Real-time tracking" while the IPO is OPEN', () => {
    render(
      <SubscriptionDashboard
        subscriptions={subscriptions}
        latestSubscription={subscriptions[0]}
        companyName="Test Co Ltd"
        closeDate={new Date('2025-08-14')}
        status="OPEN"
      />
    );

    expect(screen.getByText(/Real-time tracking for Test Co Ltd/)).toBeInTheDocument();
  });

  it('shows "Final subscription data" — never "Real-time" — for a LISTED IPO', () => {
    render(
      <SubscriptionDashboard
        subscriptions={subscriptions}
        latestSubscription={subscriptions[0]}
        companyName="Test Co Ltd"
        closeDate={new Date('2025-08-14')}
        status="LISTED"
      />
    );

    expect(screen.getByText(/Final subscription data for Test Co Ltd/)).toBeInTheDocument();
    expect(screen.queryByText(/Real-time tracking/)).not.toBeInTheDocument();
  });
});
