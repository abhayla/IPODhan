import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  dueFetchKindsForStage,
  planStageReconciliation,
  type ReconcilerIpoRow,
} from '../../../src/scheduler/stage-reconciler';

describe('deriveLifecycleStage', () => {
  it('maps status + price band', () => {
    expect(deriveLifecycleStage({ status: 'LISTED', priceRangeMin: 100 })).toBe('LISTED');
    expect(deriveLifecycleStage({ status: 'CLOSED', priceRangeMin: 100 })).toBe('CLOSED');
    expect(deriveLifecycleStage({ status: 'OPEN', priceRangeMin: 100 })).toBe('OPEN');
    expect(deriveLifecycleStage({ status: 'UPCOMING', priceRangeMin: null })).toBe('UPCOMING');
    expect(deriveLifecycleStage({ status: 'UPCOMING', priceRangeMin: 120 })).toBe('PRE_OPEN');
    expect(deriveLifecycleStage({ status: 'UPCOMING', priceRangeMin: 0 })).toBe('UPCOMING');
  });
});

describe('dueFetchKindsForStage is cumulative', () => {
  it('UPCOMING due set ⊆ LISTED due set; listing only due at LISTED', () => {
    const up = dueFetchKindsForStage('UPCOMING');
    const listed = dueFetchKindsForStage('LISTED');
    for (const k of up) expect(listed).toContain(k);
    expect(listed).toContain('listing');
    expect(up).not.toContain('listing');
    expect(dueFetchKindsForStage('OPEN')).toContain('subscription');
    expect(dueFetchKindsForStage('PRE_OPEN')).not.toContain('subscription');
  });
});

describe('planStageReconciliation', () => {
  it('lists only stage-due-AND-missing fetches per IPO', () => {
    const rows: ReconcilerIpoRow[] = [
      // OPEN IPO with financials present but subscription missing
      {
        id: '1', companyName: 'Alpha Ltd', status: 'OPEN', priceRangeMin: 100,
        presence: { documents: true, financials: true, peers: true, objectives: true, anchor: true, subscription: false, demand: false, gmp: true },
      },
      // UPCOMING (DRHP) missing financials
      {
        id: '2', companyName: 'Beta Ltd', status: 'UPCOMING', priceRangeMin: null,
        presence: { documents: false, financials: false, peers: true, objectives: true },
      },
    ];
    const plan = planStageReconciliation(rows);
    expect(plan[0].stage).toBe('OPEN');
    expect(plan[0].dueFetches).toContain('subscription');
    expect(plan[0].dueFetches).toContain('demand');
    expect(plan[0].dueFetches).not.toContain('gmp'); // present
    expect(plan[0].dueFetches).not.toContain('listing'); // not due yet (OPEN)
    expect(plan[1].stage).toBe('UPCOMING');
    expect(plan[1].dueFetches).toContain('documents');
    expect(plan[1].dueFetches).toContain('financials');
    expect(plan[1].dueFetches).not.toContain('subscription'); // not due at UPCOMING
  });

  it('a fully-populated LISTED IPO has zero due fetches', () => {
    const all: ReconcilerIpoRow['presence'] = {
      documents: true, financials: true, peers: true, objectives: true, anchor: true,
      subscription: true, demand: true, gmp: true, allotment: true, listing: true,
    };
    const plan = planStageReconciliation([
      { id: '3', companyName: 'Gamma Ltd', status: 'LISTED', priceRangeMin: 100, presence: all },
    ]);
    expect(plan[0].dueFetches).toEqual([]);
  });
});
