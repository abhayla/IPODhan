/**
 * W-160 — exchange consensus / date-invariant escapes from the T-328 HOLD.
 *
 * Live defect (prod + staging, 2026-09-05): Kanohar Electricals
 * (a60482e5-19d0-4d0e-b1f9-6a39f8a8007e) is published with
 * openDate=2026-12-09 / closeDate=2026-12-12 (source CHITTORGARH) and
 * listingDate=2026-09-16 — listing BEFORE open, impossible. NSE and BSE both
 * report openDate=2026-09-08 / closeDate=2026-09-10 every cycle, but T-328's
 * HOLD rule protects the wrong CHITTORGARH value against each exchange
 * individually, forever.
 *
 * The HOLD rule is right to protect a published value against ONE
 * disagreeing source. It must yield when either:
 *   (a) two independent exchange sources (NSE and BSE) agree with each
 *       other on the incoming value, or
 *   (b) the held value violates the open < close < listing date-order
 *       invariant while the incoming value satisfies it.
 * Neither escape changes the field-priority matrix ranks — see
 * `resolveHighValueHoldEscape` in data-consolidation-service.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 100,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

describe('W-160 exchange consensus / date-invariant HOLD escapes (Kanohar shape)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.logConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flips to the exchange value once BOTH NSE and BSE independently agree in the same cycle, and a conflict row exists', async () => {
    const existingFieldSources = [
      {
        ipoId: 'kanohar-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    // Held closeDate stays stale (Dec-12) for this call — only openDate is in
    // the incoming payload, matching a real per-source scrape — so the
    // date-order invariant escape (b) does NOT fire here: it isolates this
    // test to the CONSENSUS path (a).
    const existingData = {
      status: 'UPCOMING',
      openDate: '2026-12-09',
      closeDate: '2026-12-12',
      listingDate: '2026-09-16',
      segment: 'MAINBOARD',
    };

    // Cycle step 1: NSE disagrees alone — still HELD (no consensus yet).
    const nseResult = await service.consolidateIPOData({
      ipoId: 'kanohar-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'NSE',
      confidence: 95,
      existingData,
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });
    const nseField = nseResult.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(nseField!.finalValue).toBe('2026-12-09');
    expect(nseField!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');

    // The HOLD wrote an open data_conflicts row recording NSE's proposed
    // value — simulate that row being readable for step 2.
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-1',
        ipoId: 'kanohar-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source1: 'CHITTORGARH',
        value1: '2026-12-09',
        source2: 'NSE',
        value2: '2026-09-08',
        resolvedSource: 'CHITTORGARH',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
        severity: 'CRITICAL',
        adminNote: null,
        resolvedAt: null,
        resolvedBy: null,
        detectedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);

    // Cycle step 2: BSE independently reports the SAME value NSE already
    // disputed with — exchange consensus overrides the HOLD.
    const bseResult = await service.consolidateIPOData({
      ipoId: 'kanohar-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      confidence: 95,
      existingData, // still stale — nothing was written after the NSE HOLD
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });
    const bseField = bseResult.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(bseField!.finalValue).toBe('2026-09-08');
    expect(bseField!.chosenSource).toBe('BSE');
    expect(bseField!.conflictReason).toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');

    // A conflict row is written recording the override (via the generic
    // logConflict path all non-HOLD resolutions already go through).
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'openDate',
        resolutionReason: 'EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE',
      })
    );

    // The value is written to field_sources — provenance flips to BSE.
    expect(mockFieldSourcesRepo.trackFieldUpdate).toHaveBeenCalled();
  });

  it('a single disagreeing exchange source (no consensus yet) still HOLDS', async () => {
    const existingFieldSources = [
      {
        ipoId: 'kanohar-single',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);
    // No prior open conflict from the OTHER exchange — findUnresolvedForIPO
    // returns [] (default from beforeEach).

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-single',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      confidence: 95,
      existingData: {
        status: 'UPCOMING',
        openDate: '2026-12-09',
        closeDate: '2026-12-12',
        listingDate: '2026-09-16',
        segment: 'MAINBOARD',
      },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.finalValue).toBe('2026-12-09');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('date-order invariant: a held closeDate that violates close < listing yields to a single-source incoming value that satisfies it', async () => {
    const existingFieldSources = [
      {
        ipoId: 'invariant-ipo',
        tableName: 'ipos',
        fieldName: 'closeDate',
        source: 'CHITTORGARH',
        value: '2026-09-25', // held close is AFTER the stored listing date — impossible
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'invariant-ipo',
      tableName: 'ipos',
      incomingData: { closeDate: '2026-09-05' }, // fixes the chain: open < close < listing
      source: 'NSE', // a SINGLE exchange source is enough — no consensus needed
      confidence: 95,
      existingData: {
        status: 'OPEN',
        openDate: '2026-09-01',
        closeDate: '2026-09-25',
        listingDate: '2026-09-10',
        segment: 'MAINBOARD',
      },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'closeDate');
    expect(fieldResult!.finalValue).toBe('2026-09-05');
    expect(fieldResult!.chosenSource).toBe('NSE');
    expect(fieldResult!.conflictReason).toBe('DATE_INVARIANT_OVERRIDE_HELD_VALUE');

    // Consensus is checked first (NSE is an exchange source) but finds no
    // prior BSE disagreement, so it falls through to the invariant escape —
    // which needs only this one source to fire.
    expect(mockConflictsRepo.findUnresolvedForIPO).toHaveBeenCalledWith('invariant-ipo');
  });

  it('date-order invariant does NOT fire when the incoming value is itself still inconsistent (falls through to HOLD)', async () => {
    const existingFieldSources = [
      {
        ipoId: 'invariant-noop-ipo',
        tableName: 'ipos',
        fieldName: 'closeDate',
        source: 'CHITTORGARH',
        value: '2026-09-25',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'invariant-noop-ipo',
      tableName: 'ipos',
      // Still after listing (Sep-10) — does not fix the chain.
      incomingData: { closeDate: '2026-09-12' },
      source: 'NSE',
      confidence: 95,
      existingData: {
        status: 'OPEN',
        openDate: '2026-09-01',
        closeDate: '2026-09-25',
        listingDate: '2026-09-10',
        segment: 'MAINBOARD',
      },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'closeDate');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('non-date HIGH_VALUE field (priceRangeMin) HOLD behaviour is unchanged: single-source disagreement still holds', async () => {
    const existingFieldSources = [
      {
        ipoId: 'price-band-ipo',
        tableName: 'ipos',
        fieldName: 'priceRangeMin',
        source: 'CHITTORGARH',
        value: 100,
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-31T00:00:00Z'),
        createdAt: new Date('2026-08-31T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'price-band-ipo',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 120 },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', priceRangeMin: 100 },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(fieldResult!.finalValue).toBe(100);
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    // Consensus IS checked (NSE is an exchange source, and consensus is
    // generic across every HIGH_VALUE_LIVE_FIELDS field, not date-only) —
    // but with no prior BSE disagreement on record, it finds nothing and
    // falls through to the unchanged plain HOLD.
    expect(mockConflictsRepo.findUnresolvedForIPO).toHaveBeenCalledWith('price-band-ipo');
  });
});
