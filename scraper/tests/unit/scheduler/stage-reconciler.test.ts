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
