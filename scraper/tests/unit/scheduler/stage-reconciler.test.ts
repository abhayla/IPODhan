import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  dueFetchKindsForStage,
  planStageReconciliation,
  isStaleClosedWithoutListing,
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
      // T-403 per-document kinds; a LISTED IPO whose PDFs are already purged
      // has nothing left to do at all.
      docDrhp: true, docRhp: true, docPriceBandAd: true, docCorrigendum: true,
      docAnchorReport: true, docProspectus: true, purgePdfs: true,
    };
    const plan = planStageReconciliation([
      { id: '3', companyName: 'Gamma Ltd', status: 'LISTED', priceRangeMin: 100, presence: all },
    ]);
    expect(plan[0].dueFetches).toEqual([]);
  });
});

describe('T-403 — per-document fetch kinds', () => {
  const bare = (status: string, priceRangeMin: number | null) => ({
    id: 'x', companyName: 'X Ltd', status, priceRangeMin, presence: {} as ReconcilerIpoRow['presence'],
  });

  it('T58 each document kind becomes due at its own stage, cumulatively', () => {
    const at = (status: string, min: number | null) =>
      planStageReconciliation([bare(status, min)])[0].dueFetches;

    // UPCOMING (no band yet) = the DRHP stage only.
    expect(at('UPCOMING', null)).toContain('docDrhp');
    expect(at('UPCOMING', null)).not.toContain('docRhp');

    // PRE_OPEN (band present = RHP filed) adds the RHP-era filings.
    const preOpen = at('UPCOMING', 131);
    for (const kind of ['docRhp', 'docPriceBandAd', 'docCorrigendum', 'docAnchorReport']) {
      expect(preOpen).toContain(kind);
    }
    expect(preOpen).not.toContain('docProspectus');

    // The Prospectus is not due until the issue has CLOSED.
    expect(at('OPEN', 131)).not.toContain('docProspectus');
    expect(at('CLOSED', 131)).toContain('docProspectus');

    // Cumulative: a late-discovered CLOSED IPO still catches up on the DRHP/RHP.
    expect(at('CLOSED', 131)).toContain('docDrhp');
    expect(at('CLOSED', 131)).toContain('docRhp');
  });

  it('T59 purgePdfs becomes due only at LISTED', () => {
    // The DATE test (close_date + PROSPECTUS_RETENTION_DAYS) is owned by
    // document-store.isPurgeDue; the reconciler only decides the stage.
    for (const status of ['UPCOMING', 'OPEN', 'CLOSED']) {
      expect(planStageReconciliation([bare(status, 131)])[0].dueFetches).not.toContain('purgePdfs');
    }
    expect(planStageReconciliation([bare('LISTED', 131)])[0].dueFetches).toContain('purgePdfs');
  });
});

/**
 * W-127: three SME IPOs (stanbik-agro-ltd, western-overseas-study-abroad-ltd,
 * shipwaves-online-ltd) sat CLOSED since December 2025 with no listing_date.
 * computeTargetStatus (web/lib/services/status-updater-service.ts) correctly
 * refuses to guess LISTED with no date — but nothing ever stopped the stage
 * reconciler from treating them as a live candidate (dueFetches computed,
 * step-ledger rows written) every single cycle, forever. This is the terminal
 * rule: exclude a stale CLOSED-without-listing row from due-fetch candidacy.
 */
describe('W-127 — stale CLOSED-without-listing rows are excluded from live candidates', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');

  it('isStaleClosedWithoutListing: true past the staleness window with no listing_date', () => {
    expect(
      isStaleClosedWithoutListing({ status: 'CLOSED', closeDate: '2025-12-16', listingDate: null }, today, 30)
    ).toBe(true);
  });

  it('isStaleClosedWithoutListing: false within the staleness window', () => {
    expect(
      isStaleClosedWithoutListing({ status: 'CLOSED', closeDate: '2026-09-01', listingDate: null }, today, 30)
    ).toBe(false);
  });

  it('isStaleClosedWithoutListing: false once a listing_date exists, no matter how old close_date is', () => {
    expect(
      isStaleClosedWithoutListing(
        { status: 'CLOSED', closeDate: '2025-12-16', listingDate: '2025-12-22' },
        today,
        30
      )
    ).toBe(false);
  });

  it('isStaleClosedWithoutListing: false for a non-CLOSED status regardless of dates', () => {
    expect(
      isStaleClosedWithoutListing({ status: 'OPEN', closeDate: '2025-12-16', listingDate: null }, today, 30)
    ).toBe(false);
  });

  it('a CLOSED row ~200 days old with no listing_date is excluded from due fetches (staleClosed: true)', () => {
    const row: ReconcilerIpoRow = {
      id: 'stanbik', companyName: 'Stanbik Agro Ltd', status: 'CLOSED', priceRangeMin: 100,
      closeDate: '2025-12-16', listingDate: null, presence: {},
    };
    const plan = planStageReconciliation([row], { today, staleClosedDays: 30 })[0];
    expect(plan.staleClosed).toBe(true);
    expect(plan.dueFetches).toEqual([]);
  });

  it('a CLOSED row 3 days old with no listing_date is NOT excluded (still due for docProspectus)', () => {
    const row: ReconcilerIpoRow = {
      id: 'fresh', companyName: 'Fresh Ltd', status: 'CLOSED', priceRangeMin: 100,
      closeDate: '2026-09-01', listingDate: null, presence: {},
    };
    const plan = planStageReconciliation([row], { today, staleClosedDays: 30 })[0];
    expect(plan.staleClosed).toBe(false);
    expect(plan.dueFetches).toContain('docProspectus');
  });

  it('a CLOSED row with a listing_date in the past is not stale — its dueFetches follow the normal stage rules', () => {
    const row: ReconcilerIpoRow = {
      id: 'listed-eventually', companyName: 'Listed Eventually Ltd', status: 'CLOSED', priceRangeMin: 100,
      closeDate: '2025-12-16', listingDate: '2025-12-22', presence: {},
    };
    const plan = planStageReconciliation([row], { today, staleClosedDays: 30 })[0];
    expect(plan.staleClosed).toBe(false);
  });

  it('respects a custom staleClosedDays threshold (default is 30)', () => {
    const row: ReconcilerIpoRow = {
      id: 'edge', companyName: 'Edge Ltd', status: 'CLOSED', priceRangeMin: 100,
      closeDate: '2026-08-20', listingDate: null, presence: {}, // 15 days old at `today`
    };
    expect(planStageReconciliation([row], { today, staleClosedDays: 30 })[0].staleClosed).toBe(false);
    expect(planStageReconciliation([row], { today, staleClosedDays: 10 })[0].staleClosed).toBe(true);
  });
});
