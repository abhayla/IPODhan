/**
 * Unit tests for OverallSubscriptionChart (T-302 / P3-15)
 *
 * "Current ... closes {date}" is present/future-tense framing that is only
 * honest while bidding is genuinely ongoing (round-5 review: a LISTED IPO's
 * dashboard read "Current 108x - closes Aug 14" days after it had already
 * listed). Once the IPO has CLOSED or LISTED, the caption must switch to
 * past tense.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverallSubscriptionChart } from '@/components/ipo/charts/SubscriptionDashboard/OverallSubscriptionChart';
import type { SubscriptionTimePoint, SubscriptionStats } from '@/components/ipo/charts/SubscriptionDashboard/types';

vi.mock('@/components/ipo/charts/base/AreaChartBase', () => ({
  AreaChartBase: () => <div data-testid="area-chart-stub" />,
}));

const data: SubscriptionTimePoint[] = [
  {
    date: new Date('2025-08-12'),
    dateLabel: '12 Aug',
    totalSubscription: 108,
    qibSubscription: 50,
    niiSubscription: 40,
    retailSubscription: 18,
    employeeSubscription: null,
    shareholderSubscription: null,
  },
];

const stats: SubscriptionStats = {
  total: 108,
  qib: 50,
  nii: 40,
  retail: 18,
  employee: null,
  shareholder: null,
  totalApplications: null,
  peakSubscription: 108,
};

describe('OverallSubscriptionChart — status-aware caption (P3-15)', () => {
  it('uses present-tense "Current ... closes" wording while OPEN', () => {
    render(
      <OverallSubscriptionChart
        data={data}
        stats={stats}
        closeDate={new Date('2025-08-14')}
        status="OPEN"
      />
    );

    expect(screen.getByText(/Current 108x/)).toBeInTheDocument();
    expect(screen.getByText(/closes Aug 14/)).toBeInTheDocument();
  });

  it('uses past-tense "Final ... closed" wording for a LISTED IPO', () => {
    render(
      <OverallSubscriptionChart
        data={data}
        stats={stats}
        closeDate={new Date('2025-08-14')}
        status="LISTED"
      />
    );

    expect(screen.getByText(/Final 108x/)).toBeInTheDocument();
    expect(screen.getByText(/closed Aug 14/)).toBeInTheDocument();
    expect(screen.queryByText(/^Current/)).not.toBeInTheDocument();
    expect(screen.queryByText(/closes Aug 14/)).not.toBeInTheDocument();
  });

  it('uses past-tense wording for a CLOSED IPO', () => {
    render(
      <OverallSubscriptionChart
        data={data}
        stats={stats}
        closeDate={new Date('2025-08-14')}
        status="CLOSED"
      />
    );

    expect(screen.getByText(/Final 108x/)).toBeInTheDocument();
    expect(screen.getByText(/closed Aug 14/)).toBeInTheDocument();
  });
});
