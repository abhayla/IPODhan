/**
 * Review round 3, MAJOR (fabricated provenance): `mapScrapedIPOToConsolidationInput`
 * maps a FIXED 19-key list — companyName, segment, offeringType, sector,
 * issueSize, priceRangeMin/Max, lotSize, faceValue, status, openDate,
 * closeDate, allotmentDate, listingDate, companyDescription, registrar,
 * leadManagers, listingExchanges, symbol, isin. The field-plan walk's write
 * payload (`runWrite` in field-plan-walk.ts) spreads the pre-resolved row's
 * identity fields into `scrapedIPO` alongside the ONE field it actually
 * supplied (review round 2, RCA1 — required so `computeIpoIdentitySlug` and
 * the lock/resolution path have a real companyName). Without a filter, EVERY
 * one of those identity fields also enters `consolidateIPOData` as this
 * write's OWN claim under source DOC/BSE/CHITTORGARH confidence 100 — up to
 * 7 spurious `trackFieldSource({ confirmations: 1 })` calls (Case 2,
 * data-consolidation-service.ts:1745-1768) plus a fresh field_sources row for
 * any untracked identity value, for a walk write that only ever fetched ONE
 * field.
 *
 * Fix: `consolidatedUpsertIPO`'s 5th argument, `onlyFields?: string[]`
 * (camelCase), filters the MAPPED `incomingData` to exactly those keys —
 * AFTER slug computation and identity resolution (the full scrapedIPO shape
 * is still used for the lock slug and passed through to
 * mapScrapedIPOToConsolidationInput/extractConsolidatedData's originalScraped
 * param; only what reaches `consolidateIPOData` as this write's claim is
 * filtered). Omitting the argument (every existing caller) is byte-identical
 * to today's unfiltered behaviour.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: false,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 0,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
}));

import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';

function emptyConsolidationResult() {
  return {
    fieldResults: [],
    fieldsProcessed: 0,
    fieldsUpdated: 0,
    conflictsDetected: 0,
    performanceMs: 0,
  };
}

function makeOrchestrator(existingIPO: Record<string, unknown>) {
  const ipoRepository = {
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: existingIPO.id })),
  };
  const fieldSourcesRepository = {
    findByField: vi.fn(async () => null),
  };
  const dataConflictsRepository = {};
  // redis: null -> DistributedLock.acquire gracefully degrades (always succeeds),
  // matching the existing slug-guard test's own construction pattern.
  const orchestrator: any = new DataConsolidationOrchestrator(
    ipoRepository as any,
    fieldSourcesRepository as any,
    dataConflictsRepository as any,
    null
  );
  const consolidateSpy = vi
    .spyOn(orchestrator.consolidationService, 'consolidateIPOData')
    .mockResolvedValue(emptyConsolidationResult() as any);
  return { orchestrator, ipoRepository, consolidateSpy };
}

const EXISTING = {
  id: '00000000-0000-4000-8000-0000000660b1',
  companyName: 'Test Company Limited',
  symbol: 'TESTCO',
  isin: 'INE000A00001',
  offeringType: 'IPO',
  openDate: '2026-09-01',
  closeDate: '2026-09-03',
  priceRangeMin: 100,
  segment: 'MAINBOARD',
};

/** The exact walk-shaped payload runWrite() sends (review round 2, RCA1). */
function walkShapedScrapedIPO() {
  return {
    id: EXISTING.id,
    companyName: EXISTING.companyName,
    symbol: EXISTING.symbol,
    isin: EXISTING.isin,
    offeringType: EXISTING.offeringType,
    openDate: EXISTING.openDate,
    closeDate: EXISTING.closeDate,
    priceRangeMin: EXISTING.priceRangeMin,
    segment: EXISTING.segment,
    issueSize: 123456789,
  };
}

describe('consolidatedUpsertIPO — onlyFields filters the consolidated claim to exactly what was supplied', () => {
  it('a walk-shaped call with onlyFields=["issueSize"] consolidates ONLY issueSize — zero for companyName/symbol/isin/dates', async () => {
    const { orchestrator, consolidateSpy } = makeOrchestrator(EXISTING);

    await orchestrator.consolidatedUpsertIPO(
      walkShapedScrapedIPO(),
      'DOC',
      100,
      EXISTING,
      ['issueSize']
    );

    expect(consolidateSpy).toHaveBeenCalledTimes(1);
    const call = consolidateSpy.mock.calls[0][0] as { incomingData: Record<string, unknown> };
    expect(Object.keys(call.incomingData)).toEqual(['issueSize']);
    expect(call.incomingData).not.toHaveProperty('companyName');
    expect(call.incomingData).not.toHaveProperty('symbol');
    expect(call.incomingData).not.toHaveProperty('isin');
    expect(call.incomingData).not.toHaveProperty('openDate');
    expect(call.incomingData).not.toHaveProperty('closeDate');
    expect(call.incomingData).not.toHaveProperty('segment');
    expect(call.incomingData).not.toHaveProperty('offeringType');
  });

  it('omitting onlyFields is byte-identical to today\'s behaviour — every mapped field still reaches consolidation', async () => {
    const { orchestrator, consolidateSpy } = makeOrchestrator(EXISTING);

    await orchestrator.consolidatedUpsertIPO(walkShapedScrapedIPO(), 'DOC', 100, EXISTING);

    expect(consolidateSpy).toHaveBeenCalledTimes(1);
    const call = consolidateSpy.mock.calls[0][0] as { incomingData: Record<string, unknown> };
    // Every one of the walk-shaped payload's mapped keys is still present —
    // no filtering happened.
    expect(call.incomingData).toHaveProperty('companyName', EXISTING.companyName);
    expect(call.incomingData).toHaveProperty('symbol', EXISTING.symbol);
    expect(call.incomingData).toHaveProperty('isin', EXISTING.isin);
    expect(call.incomingData).toHaveProperty('issueSize', 123456789);
  });

  it('an empty onlyFields array consolidates NOTHING (never falls back to unfiltered)', async () => {
    const { orchestrator, consolidateSpy } = makeOrchestrator(EXISTING);

    await orchestrator.consolidatedUpsertIPO(walkShapedScrapedIPO(), 'DOC', 100, EXISTING, []);

    expect(consolidateSpy).toHaveBeenCalledTimes(1);
    const call = consolidateSpy.mock.calls[0][0] as { incomingData: Record<string, unknown> };
    expect(Object.keys(call.incomingData)).toEqual([]);
  });
});
