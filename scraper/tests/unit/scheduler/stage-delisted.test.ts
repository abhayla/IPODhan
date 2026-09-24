/**
 * PR #972 round 3 (review MINOR 4): a DELISTED IPO (item 7 S5, §2.3.3.3, OD-38) passed every
 * stage up to and including listing, so its lifecycle stage is LISTED — the last stage, ranked
 * as never-urgent backfill by the document cycle — never UPCOMING, which would send the
 * document cycle hunting pre-open documents for a stock that no longer trades. Same intent as
 * WITHDRAWN (never crowds out a live issue). The scripts mirror (`deriveStage`) moves with it.
 */
import { describe, it, expect } from 'vitest';
import { deriveLifecycleStage, planStageReconciliation } from '../../../src/scheduler/stage-reconciler';
// @ts-expect-error - plain .mjs module without type declarations
import { deriveStage } from '../../../../scripts/lib/ipo-stage-completeness.mjs';

const row = { status: 'DELISTED', priceRangeMin: '100', openDate: '2026-06-01', hasRhpOnFile: true, offeringType: 'IPO' };

describe('DELISTED lifecycle stage', () => {
  it('deriveLifecycleStage: DELISTED -> LISTED (not UPCOMING)', () => {
    expect(deriveLifecycleStage(row, { today: new Date('2026-09-24T06:45:00Z') })).toBe('LISTED');
  });

  it('the scripts mirror agrees', () => {
    expect(deriveStage({ status: 'DELISTED', price_range_min: '100', open_date: '2026-06-01' }, { today: new Date('2026-09-24T06:45:00Z') })).toBe('LISTED');
  });

  it('a DELISTED row is planned at LISTED, so no pre-open document is due', () => {
    const [plan] = planStageReconciliation(
      [{ id: 'd', companyName: 'Gone Ltd', status: 'DELISTED', priceRangeMin: '100', openDate: '2026-06-01', hasRhpOnFile: true, offeringType: 'IPO', closeDate: '2026-06-03', listingDate: '2026-06-06', presence: {} } as any],
      { today: new Date('2026-09-24T06:45:00Z') },
    );
    expect(plan.stage).toBe('LISTED');
  });
});
