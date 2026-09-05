/**
 * W-160 round 2 — exchange consensus / date-invariant escapes from the T-328
 * HOLD.
 *
 * Live defect (prod + staging, 2026-09-05): Kanohar Electricals
 * (a60482e5-19d0-4d0e-b1f9-6a39f8a8007e) is published with
 * openDate=2026-12-09 / closeDate=2026-12-12 (source CHITTORGARH) and
 * listingDate=2026-09-16 — listing BEFORE open, impossible. NSE and BSE both
 * report openDate=2026-09-08 / closeDate=2026-09-10 in the SAME payload,
 * every cycle, but T-328's HOLD rule protects the wrong CHITTORGARH value
 * forever.
 *
 * Round 1 (048d6b1f) shipped BROKEN:
 *   - escape (b) judged openDate against a STALE stored closeDate (and vice
 *     versa), so neither field's incoming candidate ever validated as a
 *     whole and the real Kanohar shape stayed HELD (CRITICAL-1).
 *   - escape (a)'s only conflict writer was gated on
 *     `ENABLE_CONFLICT_DETECTION`, which is off (0%) in prod/staging, so the
 *     audit trail the escape reads was NEVER written — 0 conflict rows for
 *     Kanohar after weeks of holds (CRITICAL-2).
 *   - escape (b) fired for ANY incoming source and trusted an unvalidated
 *     listingDate (MAJOR-3).
 *
 * Round 2 fixes: the held/incoming date triples are computed ONCE per
 * `consolidateIPOData` call (openDate and closeDate judged against the SAME
 * pair, so an exchange reporting both flips both in one shot); the HOLD's
 * conflict-row write is unconditional (shadow mode aside); both escapes
 * require an exchange source and an override RESOLVES the conflict row it
 * used.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    // Round 2 (CRITICAL-2): deliberately OFF, matching prod/staging today —
    // proves the HOLD conflict-row write and the escapes no longer depend on
    // this rollout flag.
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
  resolveConflict: vi.fn(),
} as unknown as DataConflictsRepository;

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: 'kanohar-ipo',
    tableName: 'ipos',
    fieldName,
    source,
    value,
    confidence: 90,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    createdAt: new Date('2026-08-31T00:00:00Z'),
  };
}

describe('W-160 round 2 — exchange consensus / date-invariant HOLD escapes (Kanohar shape)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({ id: 'row-generic' } as any);
    vi.mocked(mockConflictsRepo.logConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([]);
    vi.mocked(mockConflictsRepo.resolveConflict).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const kanoharExisting = () => [
    fieldSourceRow('openDate', 'CHITTORGARH', '2026-12-09'),
    fieldSourceRow('closeDate', 'CHITTORGARH', '2026-12-12'),
  ];
  const kanoharExistingData = {
    status: 'UPCOMING',
    openDate: '2026-12-09',
    closeDate: '2026-12-12',
    listingDate: '2026-09-16',
    segment: 'MAINBOARD',
  };

  it('CRITICAL-1: a SINGLE exchange run reporting BOTH open and close flips BOTH dates via the date-order invariant (b) — the real Kanohar shape', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(kanoharExisting() as any);

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08', closeDate: '2026-09-10' },
      source: 'NSE',
      confidence: 95,
      existingData: kanoharExistingData,
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const openField = result.fieldResults.find((f) => f.fieldName === 'openDate');
    const closeField = result.fieldResults.find((f) => f.fieldName === 'closeDate');

    expect(openField!.finalValue).toBe('2026-09-08');
    expect(openField!.chosenSource).toBe('NSE');
    expect(openField!.conflictReason).toBe('DATE_INVARIANT_OVERRIDE_HELD_VALUE');

    expect(closeField!.finalValue).toBe('2026-09-10');
    expect(closeField!.chosenSource).toBe('NSE');
    expect(closeField!.conflictReason).toBe('DATE_INVARIANT_OVERRIDE_HELD_VALUE');
  });

  it('CRITICAL-1 negative control: reporting ONLY openDate (closeDate absent this cycle) does NOT flip — the stale held close still fails the invariant', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(kanoharExisting() as any);

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-partial-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' }, // no closeDate this cycle
      source: 'NSE',
      confidence: 95,
      existingData: kanoharExistingData,
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const openField = result.fieldResults.find((f) => f.fieldName === 'openDate');
    // incoming close falls back to the stale held 2026-12-12, which still
    // fails close < listing (2026-09-16) — the pair does not validate, so
    // HOLD stands rather than flipping one field alone.
    expect(openField!.finalValue).toBe('2026-12-09');
    expect(openField!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('CRITICAL-2: the HOLD writes its conflict row even with ENABLE_CONFLICT_DETECTION off (matches prod/staging), and an override RESOLVES it', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'CHITTORGARH', '2026-12-09'),
    ] as any);

    // Step 1: NSE alone (no closeDate this cycle) — HOLD, writes a conflict row.
    await service.consolidateIPOData({
      ipoId: 'kanohar-consensus-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    // The HOLD wrote its conflict row DESPITE ENABLE_CONFLICT_DETECTION being off.
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({ fieldName: 'openDate', resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE' })
    );

    // Simulate that row being readable for step 2 (BSE agrees with NSE).
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-open-1',
        ipoId: 'kanohar-consensus-ipo',
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
        detectedAt: new Date(), // fresh — within the 7-day age bound
        createdAt: new Date(),
      },
    ] as any);

    const bseResult = await service.consolidateIPOData({
      ipoId: 'kanohar-consensus-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });

    const bseField = bseResult.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(bseField!.finalValue).toBe('2026-09-08');
    expect(bseField!.conflictReason).toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');

    // The consensus row is explicitly RESOLVED, not left open to flip-flop.
    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith(
      'conflict-open-1',
      expect.objectContaining({ resolvedSource: 'BSE', resolutionReason: 'EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE' })
    );
  });

  it('MAJOR-3 / mutation gap: the SAME source repeating its own proposal is NOT consensus (NSE proposes X twice)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'CHITTORGARH', '2026-12-09'),
    ] as any);

    // A stale open row whose source2 is NSE itself (a forged/leftover row —
    // must never be read as "the OTHER exchange agreed").
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-self',
        ipoId: 'kanohar-forgery-ipo',
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

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-forgery-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'NSE', // same source as the recorded row's source2 — not consensus
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.finalValue).toBe('2026-12-09');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalled();
  });

  it('MAJOR-3 / mutation gap: a non-exchange incoming source (CHITTORGARH) never escapes, even with a matching prior row and a valid invariant', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'MONEYCONTROL', '2026-12-09'),
      fieldSourceRow('closeDate', 'MONEYCONTROL', '2026-12-12'),
    ] as any);

    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-x',
        ipoId: 'kanohar-nonexchange-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source1: 'MONEYCONTROL',
        value1: '2026-12-09',
        source2: 'BSE',
        value2: '2026-09-08',
        resolvedSource: 'MONEYCONTROL',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
        severity: 'CRITICAL',
        adminNote: null,
        resolvedAt: null,
        resolvedBy: null,
        detectedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-nonexchange-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08', closeDate: '2026-09-10' },
      source: 'CHITTORGARH', // an aggregator, never an exchange
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.finalValue).toBe('2026-12-09');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalled();
  });

  it('MAJOR-3: a consensus row older than 7 days is not trusted', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'CHITTORGARH', '2026-12-09'),
    ] as any);

    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-stale',
        ipoId: 'kanohar-stale-ipo',
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
        detectedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-stale-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.finalValue).toBe('2026-12-09');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('MAJOR-3: a corrupt incoming listingDate (before the incoming open) disqualifies the invariant escape', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('closeDate', 'CHITTORGARH', '2026-09-25'),
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'corrupt-listing-ipo',
      tableName: 'ipos',
      // Incoming closeDate looks like it fixes the chain, but the incoming
      // listingDate itself is corrupt (before the incoming open) — must not flip.
      incomingData: { closeDate: '2026-09-05', listingDate: '2026-08-15' },
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

  it('MINOR: consensus matches regardless of which write path recorded the prior row (String vs JSON.stringify serialization)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'CHITTORGARH', '2026-12-09'),
    ] as any);

    // A plain (unquoted) date string, as HOLD's own write path produces after
    // the round-2 `serializeFieldValue` fix — the read side must match it.
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-serialize',
        ipoId: 'serialize-ipo',
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

    const result = await service.consolidateIPOData({
      ipoId: 'serialize-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-12-09', closeDate: '2026-12-12', listingDate: '2026-09-16', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.finalValue).toBe('2026-09-08');
    expect(fieldResult!.conflictReason).toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');
  });

  it('non-date HIGH_VALUE field (priceRangeMin) HOLD behaviour is unchanged: single-source disagreement still holds', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('priceRangeMin', 'CHITTORGARH', 100),
    ] as any);

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
  });
});
