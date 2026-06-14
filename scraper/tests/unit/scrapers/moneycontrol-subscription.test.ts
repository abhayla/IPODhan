import { describe, it, expect } from 'vitest';
import {
  validateSubscriptionData,
  MoneycontrolIPOSchema,
} from '../../../src/utils/validators.js';

/**
 * Phase 2 contract guard: Moneycontrol now carries subscription %s and the
 * orchestrator turns them into subscription snapshots (ENABLE_MONEYCONTROL_SUBSCRIPTION).
 * These assert the data contract the orchestrator relies on.
 */
describe('Moneycontrol subscription persistence contract', () => {
  it('a Moneycontrol-derived subscription snapshot passes the shared validator', () => {
    const snapshot = {
      ipoCompanyName: 'Sarda Proteins Ltd',
      qibSubscription: 1.2,
      niiSubscription: 3.4,
      retailSubscription: 5.6,
      totalSubscription: 3.1,
      timestamp: new Date('2026-06-14T00:00:00Z').toISOString(),
    };
    const result = validateSubscriptionData(snapshot);
    expect(result.success).toBe(true);
    expect(result.data?.totalSubscription).toBe(3.1);
  });

  it('rejects a snapshot missing the required total/timestamp', () => {
    const bad = { ipoCompanyName: 'X', qibSubscription: 1, niiSubscription: 1, retailSubscription: 1 };
    expect(validateSubscriptionData(bad as unknown).success).toBe(false);
  });

  it('MoneycontrolIPOSchema accepts the carried subscription fields', () => {
    const ipo = {
      companyName: 'Sarda Proteins Ltd',
      issueSize: 1000000,
      priceRangeMin: 100,
      priceRangeMax: 100,
      openDate: '2026-06-11',
      closeDate: '2026-06-24',
      listingExchange: 'BOTH',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      status: 'OPEN',
      dataSource: 'MONEYCONTROL',
      totalSubscription: 3.1,
      qibSubscription: 1.2,
      niiSubscription: 3.4,
      retailSubscription: 5.6,
    };
    const parsed = MoneycontrolIPOSchema.safeParse(ipo);
    expect(parsed.success).toBe(true);
  });
});
