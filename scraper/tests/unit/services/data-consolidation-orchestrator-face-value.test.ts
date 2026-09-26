/**
 * W-02 round 2: extractConsolidatedData() previously wrote
 * `faceValue: consolidated.faceValue || 10` — a missing consolidated face
 * value became a fabricated 10 on the consolidation write path. Must stay
 * undefined instead.
 */
import { describe, it, expect } from 'vitest';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';

// #951: extractConsolidatedData takes the write's claim (the keys of the
// consolidated incomingData). These tests exercise a full scrape, so every
// mapped key is claimed.
const ALL_CLAIMED = new Set([
  'companyName', 'segment', 'offeringType', 'sector', 'issueSize', 'priceRangeMin',
  'priceRangeMax', 'lotSize', 'faceValue', 'status', 'openDate', 'closeDate',
  'allotmentDate', 'listingDate', 'companyDescription', 'registrar', 'leadManagers',
  'listingExchanges', 'symbol', 'isin',
]);


function makeOrchestrator() {
  return new DataConsolidationOrchestrator({} as any, {} as any, {} as any, null);
}

describe('DataConsolidationOrchestrator.extractConsolidatedData faceValue (W-02 round 2 fix)', () => {
  it('leaves faceValue undefined when consolidation produced no face value', () => {
    const orchestrator: any = makeOrchestrator();
    const result = { fieldResults: [] } as any;
    const originalScraped = { companyName: 'Deepa Jewellers Limited', offeringType: 'IPO', status: 'CLOSED' } as any;
    const consolidated = orchestrator.extractConsolidatedData(result, originalScraped, undefined, undefined, ALL_CLAIMED);
    expect(consolidated.faceValue).toBeUndefined();
  });

  it('passes through a genuine consolidated faceValue', () => {
    const orchestrator: any = makeOrchestrator();
    const result = { fieldResults: [{ fieldName: 'faceValue', finalValue: 2 }] } as any;
    const originalScraped = { companyName: 'Deepa Jewellers Limited', offeringType: 'IPO', status: 'CLOSED' } as any;
    const consolidated = orchestrator.extractConsolidatedData(result, originalScraped, undefined, undefined, ALL_CLAIMED);
    expect(consolidated.faceValue).toBe(2);
  });
});
