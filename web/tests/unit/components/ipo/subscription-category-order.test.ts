import { describe, it, expect } from 'vitest';
import {
  getCategoryBreakdown,
  calculateSubscriptionStats,
} from '@/components/ipo/charts/SubscriptionDashboard/utils';
import type { SubscriptionDataRaw } from '@/components/ipo/charts/SubscriptionDashboard/types';

// Real Knack Packaging shape (2026-07-02): QIB under-subscribed at 0.36x while
// NII/Retail/Employee were above 1x. The old value-DESC sort demoted QIB out of
// the top-3 headline cards (blind reviewer read it as a data contradiction).
// Category order must stay canonical — QIB, NII, Retail, then Employee/Shareholder —
// regardless of subscription values.
const latest = {
  totalSubscription: '1.15',
  qibSubscription: '0.36',
  niiSubscription: '1.91',
  retailSubscription: '1.28',
  employeeSubscription: '1.2',
  shareholderSubscription: null,
  totalApplications: null,
  qibApplications: null,
  niiApplications: null,
  retailApplications: null,
  qibSharesOffered: null,
  niiSharesOffered: null,
  retailSharesOffered: null,
  employeeSharesOffered: null,
  shareholderSharesOffered: null,
  timestamp: '2026-07-02T06:00:09.693Z',
} as unknown as SubscriptionDataRaw;

describe('getCategoryBreakdown ordering', () => {
  it('keeps canonical QIB → NII → Retail → Employee order even when QIB is the weakest', () => {
    const stats = calculateSubscriptionStats([latest], latest);
    const categories = getCategoryBreakdown(latest, stats);

    expect(categories.map((c) => c.category)).toEqual([
      'QIB',
      'NII',
      'Retail',
      'Employee',
    ]);
    // the headline trio (slice(0,3) in CategoryBreakdownChart) must contain QIB
    expect(categories.slice(0, 3).map((c) => c.category)).toContain('QIB');
    expect(categories[0].subscription).toBeCloseTo(0.36);
  });
});
