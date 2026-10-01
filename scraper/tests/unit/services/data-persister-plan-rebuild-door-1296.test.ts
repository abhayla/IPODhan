import { describe, it, expect } from 'vitest';
import { resolveIposWriteTx } from '../../../src/services/data-persister';

const repo = { updateReportingHolds: async () => ({ dropped: [] }) };
const existing = { segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' };

describe('#1296 resolveIposWriteTx: the scraper write door runs the plan rebuild when plan inputs change', () => {
  it('returns a hook when segment changes', () => {
    expect(resolveIposWriteTx(repo, 'id', { segment: 'SME' }, existing, undefined)).toBeTypeOf('function');
  });
  it('returns a hook when listingExchanges changes, and when offeringType changes', () => {
    expect(resolveIposWriteTx(repo, 'id', { listingExchanges: ['NSE', 'BSE'] }, existing, undefined)).toBeTypeOf('function');
    expect(resolveIposWriteTx(repo, 'id', { offeringType: 'FPO' }, existing, undefined)).toBeTypeOf('function');
  });
  it('returns nothing when no plan input is written or all are unchanged', () => {
    expect(resolveIposWriteTx(repo, 'id', { lotSize: 10 }, existing, undefined)).toBeUndefined();
    expect(resolveIposWriteTx(repo, 'id', { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, existing, undefined)).toBeUndefined();
  });
  it('a caller-supplied hook wins', () => {
    const explicit = async () => undefined;
    expect(resolveIposWriteTx(repo, 'id', { segment: 'SME' }, existing, explicit)).toBe(explicit);
  });
  it('an untyped fake repository with no transactional write gets no hook (it would fail closed)', () => {
    expect(resolveIposWriteTx({}, 'id', { segment: 'SME' }, existing, undefined)).toBeUndefined();
  });
});
