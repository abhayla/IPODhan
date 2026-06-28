/**
 * Unit tests for bid-tier (application-size) computation.
 * Cross-checked against the Ather Energy IPO published tiers
 * (lot 46, upper band ₹321).
 */

import { describe, it, expect } from 'vitest';
import { computeBidTiers } from '@/lib/utils/bid-tiers';

describe('computeBidTiers', () => {
  it('matches the Ather Energy IPO published tiers (lot 46 @ ₹321)', () => {
    const t = computeBidTiers(46, 321);
    expect(t).not.toBeNull();
    if (!t) return;

    expect(t.amountPerLot).toBe(14766);

    // Retail: 1 lot min, 13 lots max (13×14766=191,958 ≤ ₹2L; 14 would exceed)
    expect(t.retail.min).toEqual({ lots: 1, shares: 46, amount: 14766 });
    expect(t.retail.max).toEqual({ lots: 13, shares: 598, amount: 191958 });

    // sNII: 14 lots min (₹2,06,724 > ₹2L), 67 lots max (≤ ₹10L)
    expect(t.sNii.min).toEqual({ lots: 14, shares: 644, amount: 206724 });
    expect(t.sNii.max).toEqual({ lots: 67, shares: 3082, amount: 989322 });

    // bNII: 68 lots min (₹10,04,088 > ₹10L)
    expect(t.bNii.min).toEqual({ lots: 68, shares: 3128, amount: 1004088 });
  });

  it('keeps retail at >=1 lot even when a single lot exceeds the retail ceiling', () => {
    // Expensive lot: 100 shares @ ₹3,000 = ₹3,00,000 per lot (> ₹2L)
    const t = computeBidTiers(100, 3000);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.retail.min.lots).toBe(1);
    expect(t.retail.max.lots).toBe(1); // clamped, not 0
    expect(t.sNii.min.lots).toBe(2);
  });

  it('returns null for non-positive or non-finite inputs', () => {
    expect(computeBidTiers(0, 321)).toBeNull();
    expect(computeBidTiers(46, 0)).toBeNull();
    expect(computeBidTiers(-1, 321)).toBeNull();
    expect(computeBidTiers(46, Number.NaN)).toBeNull();
  });
});
