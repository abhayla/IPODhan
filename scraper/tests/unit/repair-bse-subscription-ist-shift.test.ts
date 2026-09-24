import { describe, it, expect } from 'vitest';
import { planRepair, type CandidateRow } from '../../scripts/repair-bse-subscription-ist-shift';

const row = (over: Partial<CandidateRow>): CandidateRow => ({
  id: 'r1',
  ipoId: 'ipo-1',
  slug: 'x-ltd',
  timestamp: '2026-09-23T17:00:00.000Z',
  qibSubscription: '1.00',
  niiSubscription: '2.00',
  retailSubscription: '3.00',
  totalSubscription: '2.00',
  employeeSubscription: null,
  ...over,
});

describe('planRepair — BSE subscription IST-shift class fix (T-999)', () => {
  it('shifts a row with no collision at the shifted instant', () => {
    const plan = planRepair([row({})], new Map());
    expect(plan.toShift).toHaveLength(1);
    expect(plan.toDeleteAsDuplicate).toHaveLength(0);
  });

  it('deletes as a duplicate when the shifted instant already has an identical row for the same ipo', () => {
    const candidate = row({ id: 'bad-1' });
    const existing = row({ id: 'good-1', timestamp: '2026-09-23T11:30:00.000Z' });
    const existingMap = new Map([[`ipo-1::2026-09-23T11:30:00.000Z`, existing]]);
    const plan = planRepair([candidate], existingMap);
    expect(plan.toShift).toHaveLength(0);
    expect(plan.toDeleteAsDuplicate).toEqual([{ row: candidate, survivorId: 'good-1' }]);
  });

  it('shifts (does not delete) when the shifted instant collides but the FIGURES differ — a real second observation, not a duplicate', () => {
    const candidate = row({ id: 'bad-1', totalSubscription: '5.00' });
    const existing = row({ id: 'other-1', timestamp: '2026-09-23T11:30:00.000Z', totalSubscription: '2.00' });
    const existingMap = new Map([[`ipo-1::2026-09-23T11:30:00.000Z`, existing]]);
    const plan = planRepair([candidate], existingMap);
    expect(plan.toShift).toHaveLength(1);
    expect(plan.toDeleteAsDuplicate).toHaveLength(0);
  });

  it('is idempotent by construction: a row already at the shifted instant is never itself a candidate (candidates are selected by time-of-day = 17:00:00 upstream; this only guards against a candidate colliding with ITSELF)', () => {
    const candidate = row({ id: 'r1', timestamp: '2026-09-23T17:00:00.000Z' });
    // Same row present in the "existing" map under its own id (defensive: must not treat itself as a duplicate survivor).
    const existingMap = new Map([[`ipo-1::2026-09-23T11:30:00.000Z`, candidate]]);
    const plan = planRepair([candidate], existingMap);
    expect(plan.toShift).toHaveLength(1);
    expect(plan.toDeleteAsDuplicate).toHaveLength(0);
  });

  it('handles multiple ipos independently', () => {
    const a = row({ id: 'a', ipoId: 'ipo-a' });
    const b = row({ id: 'b', ipoId: 'ipo-b' });
    const plan = planRepair([a, b], new Map());
    expect(plan.toShift.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
