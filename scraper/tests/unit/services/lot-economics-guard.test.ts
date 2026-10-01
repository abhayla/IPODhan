/**
 * #721: guardLotEconomics, the one Rule 9 gate for the doors that do not run the persister's
 * merged-record pass (persister create, consolidation orchestrator create/update, the lot backfill).
 */
import { describe, it, expect } from 'vitest';
import { guardLotEconomics } from '../../../src/services/lot-economics-guard.js';

const ctx = { source: 'BSE', door: 'test' };

describe('guardLotEconomics (#721)', () => {
  it('drops an impossible incoming lot judged against the STORED segment', () => {
    const { payload, violation } = guardLotEconomics({ lotSize: 100, priceRangeMax: 2165 }, { segment: 'MAINBOARD', offeringType: 'IPO' }, ctx);
    expect(violation?.rule).toBe('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    expect(payload).not.toHaveProperty('lotSize');
    expect(payload.priceRangeMax).toBe(2165);
  });

  it('the stored segment governs over the payload segment (a payload claiming SME cannot relax its own lot)', () => {
    const { violation } = guardLotEconomics({ lotSize: 1000, priceRangeMax: 120, segment: 'SME' }, { segment: 'MAINBOARD' }, ctx);
    expect(violation?.rule).toBe('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });

  it('infers the segment when none is stored or sent (spec §2.8) and uses the stored exchanges', () => {
    expect(guardLotEconomics({ lotSize: 2000 }, { priceRangeMax: 69, listingExchanges: ['NSE', 'BSE'] }, ctx).violation?.rule).toBe('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    expect(guardLotEconomics({ lotSize: 2000 }, { priceRangeMax: 69, listingExchanges: ['BSE'] }, ctx).violation).toBeNull();
  });

  it('a stored lot made impossible by an incoming cap is reported, and nothing is dropped from a payload without a lot', () => {
    const { payload, violation } = guardLotEconomics({ priceRangeMax: 300 }, { lotSize: 100, segment: 'MAINBOARD' }, ctx);
    expect(violation?.rule).toBe('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    expect(payload).toEqual({ priceRangeMax: 300 });
  });

  it('an ADMIN write is never refused', () => {
    const { payload, violation } = guardLotEconomics({ lotSize: 100, priceRangeMax: 2165 }, { segment: 'MAINBOARD' }, { ...ctx, source: 'ADMIN' });
    expect(violation).toBeNull();
    expect(payload.lotSize).toBe(100);
  });

  it('a legal pair passes untouched', () => {
    const p = { lotSize: 50, priceRangeMax: 290 };
    expect(guardLotEconomics(p, { segment: 'MAINBOARD' }, ctx)).toEqual({ payload: p, violation: null });
  });
});
