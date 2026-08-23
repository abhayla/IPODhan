import { describe, it, expect } from 'vitest';
import { isAuthoritativeForHardDatesOnCreate } from '../../../src/utils/hard-date-source-trust';

describe('isAuthoritativeForHardDatesOnCreate (T-292 P2-5)', () => {
  it('trusts the exchanges, DRHP, and admin to assert hard dates on a fresh insert', () => {
    expect(isAuthoritativeForHardDatesOnCreate('NSE')).toBe(true);
    expect(isAuthoritativeForHardDatesOnCreate('BSE')).toBe(true);
    expect(isAuthoritativeForHardDatesOnCreate('DRHP')).toBe(true);
    expect(isAuthoritativeForHardDatesOnCreate('ADMIN')).toBe(true);
  });

  it('does not trust mid/low-trust aggregators alone (Priority Jewels shape)', () => {
    expect(isAuthoritativeForHardDatesOnCreate('MONEYCONTROL')).toBe(false);
    expect(isAuthoritativeForHardDatesOnCreate('CHITTORGARH')).toBe(false);
    expect(isAuthoritativeForHardDatesOnCreate('API_FALLBACK')).toBe(false);
    expect(isAuthoritativeForHardDatesOnCreate('INVESTORGAIN_GMP')).toBe(false);
  });
});
