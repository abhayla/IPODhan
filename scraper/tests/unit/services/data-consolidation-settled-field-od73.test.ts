/**
 * OD-73 (owner, 2026-09-23, "Rank decides") / OD-65 / #908 — a settled field is not rewritten.
 *
 * Measured on staging 2026-09-23 (#908): 17 live IPOs' price bands and dates had their
 * `field_sources` row re-stamped every cycle with IDENTICAL values — source CHITTORGARH,
 * previous_source CHITTORGARH, previous_value equal to the stored value, confidence 65
 * (CHITTORGARH base 60 + one F6 confirmation bonus). That signature is the Case 2
 * "equivalent value from a DIFFERENT source" branch of `consolidateField`, which re-wrote
 * the provenance row as a "confirmation" on every cycle a second source repeated the value.
 *
 * Spec §3.2 rule table, each row exercised on the REAL `consolidateIPOData`:
 *   A  the same value again (from any source)           -> no write, no provenance re-stamp
 *   B  a different value from a HIGHER-ranked source     -> replaces it (Vivekanand: BSE -> CHITTORGARH issue size)
 *   C  a different value from an equal/lower-ranked site -> not written; recorded in the admin conflicts list
 *   D  a new date from the exchange (postponement)       -> updates the same row
 *   E  status (a live figure)                            -> still refreshes every run
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_POLICY_WRITER: true,
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

const fieldSources = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const conflicts = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

function stored(fieldName: string, source: string, value: unknown, updatedAt = new Date('2026-09-20T00:00:00Z')) {
  return {
    ipoId: 'ipo-od73',
    tableName: 'ipos',
    rowKey: '',
    fieldName,
    source,
    value,
    confidence: 65,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt,
    createdAt: updatedAt,
  };
}

function trackedFields(): string[] {
  return vi.mocked(fieldSources.trackFieldUpdate).mock.calls.map((c) => (c[0] as { fieldName: string }).fieldName);
}

describe('OD-73: a settled field is not rewritten (#908)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataConsolidationService(fieldSources, conflicts);
    vi.mocked(conflicts.upsertConflict).mockResolvedValue({} as never);
    vi.mocked(conflicts.findUnresolvedForIPO).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('A: an identical value from a DIFFERENT source writes nothing and re-stamps no provenance (Adroit 126 -> 126)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      stored('priceRangeMin', 'CHITTORGARH', '126.00'),
      stored('openDate', 'CHITTORGARH', '2026-09-23'),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 126, openDate: '2026-09-23' },
      source: 'BSE',
      confidence: 90,
      existingData: { status: 'OPEN', priceRangeMin: '126.00', openDate: '2026-09-23' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.fieldsUpdated).toBe(0);
    expect(trackedFields()).toEqual([]);
  });

  it('A: an identical value from the SAME source writes nothing and re-stamps no provenance', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('priceRangeMin', 'CHITTORGARH', '126.00')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 126 },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'OPEN', priceRangeMin: '126.00' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.fieldsUpdated).toBe(0);
    expect(trackedFields()).toEqual([]);
  });

  it('B: a different issue size from a HIGHER-ranked source replaces it (Vivekanand BSE 19.2 cr -> CHITTORGARH 22.2 cr)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('issueSize', 'BSE', '192000000.00')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { issueSize: 222000000 },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'OPEN', segment: 'MAINBOARD', issueSize: '192000000.00' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.fieldsUpdated).toBe(1);
    expect(result.consolidatedData.issueSize).toBe(222000000);
    expect(trackedFields()).toEqual(['issueSize']);
  });

  // OPEN SPEC QUESTION (reported on the PR, not invented here): OD-73 says an equal-ranked
  // website's differing value is "recorded in the admin conflicts list", but
  // DataConflictsRepository.upsertConflict refuses source1 === source2 by design (self-comparison
  // rows once flooded the alert channel). When the equal-ranked source is the SAME source, the
  // value is kept (asserted below) but no conflict row can be written until the owner decides.
  it.todo('C: a same-source equal-rank disagreement is recorded in the admin conflicts list (awaiting owner: same-source conflict rows)');

  it('C: a different price band from the SAME website (equal rank) is not written', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('priceRangeMin', 'CHITTORGARH', '126.00')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 130 },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'CLOSED', priceRangeMin: '126.00' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.fieldsUpdated).toBe(0);
    expect(Number(result.consolidatedData.priceRangeMin)).toBe(126);
    expect(trackedFields()).toEqual([]);
  });

  it('C: a different registrar from a LOWER-ranked website than the document is not written, and is recorded', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('registrar', 'DRHP', 'Bigshare Services')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { registrar: 'Link Intime' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'CLOSED', registrar: 'Bigshare Services' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.fieldsUpdated).toBe(0);
    expect(result.consolidatedData.registrar).toBe('Bigshare Services');
    expect(trackedFields()).toEqual([]);
    expect(conflicts.upsertConflict).toHaveBeenCalledWith(expect.objectContaining({ fieldName: 'registrar', resolvedSource: 'DRHP' }));
  });

  it('D: a new open date from the exchange that set it (postponement) updates the same row', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      stored('openDate', 'NSE', '2026-09-24'),
      stored('closeDate', 'NSE', '2026-09-26'),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-29', closeDate: '2026-10-01' },
      source: 'NSE',
      confidence: 90,
      existingData: { status: 'UPCOMING', openDate: '2026-09-24', closeDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.openDate).toBe('2026-09-29');
    expect(result.consolidatedData.closeDate).toBe('2026-10-01');
    expect(result.fieldsUpdated).toBe(2);
  });

  it('D (negative): a WEBSITE that set a date cannot move it on its own later (equal rank is ignored)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('openDate', 'CHITTORGARH', '2026-09-24')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-29' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'UPCOMING', openDate: '2026-09-24' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.openDate).toBe('2026-09-24');
    expect(result.fieldsUpdated).toBe(0);
  });

  it('B: a different lot size from a HIGHER-ranked exchange replaces the lower-ranked one (manifest MAINBOARD: DOC > BSE > NSE)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('lotSize', 'NSE', 100)] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { lotSize: 120 },
      source: 'BSE',
      confidence: 90,
      existingData: { status: 'CLOSED', segment: 'MAINBOARD', lotSize: 100 },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.lotSize).toBe(120);
    expect(result.fieldsUpdated).toBe(1);
  });

  it('C: a different lot size from a LOWER-ranked exchange is not written, and is recorded (manifest MAINBOARD: DOC > BSE > NSE)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('lotSize', 'BSE', 100)] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { lotSize: 120 },
      source: 'NSE',
      confidence: 90,
      existingData: { status: 'CLOSED', segment: 'MAINBOARD', lotSize: 100 },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(Number(result.consolidatedData.lotSize)).toBe(100);
    expect(result.fieldsUpdated).toBe(0);
    expect(trackedFields()).toEqual([]);
    expect(conflicts.upsertConflict).toHaveBeenCalledWith(expect.objectContaining({ fieldName: 'lotSize', resolvedSource: 'BSE' }));
  });

  it('D (negative, not live): a WEBSITE that set a date on a CLOSED IPO cannot move it either', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('closeDate', 'CHITTORGARH', '2026-09-18')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { closeDate: '2026-09-19' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'CLOSED', closeDate: '2026-09-18' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.closeDate).toBe('2026-09-18');
    expect(result.fieldsUpdated).toBe(0);
  });

  it('E: status is a live figure and still refreshes from the same exchange every run', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('status', 'NSE', 'UPCOMING')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { status: 'OPEN' },
      source: 'NSE',
      confidence: 90,
      existingData: { status: 'UPCOMING' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.status).toBe('OPEN');
    expect(result.fieldsUpdated).toBe(1);
  });

  // ---- review round 1 (PR #914) ------------------------------------------------------------
  it('OD-75: a WEBSITE changing its own date on a CLOSED IPO keeps the page value and records a SOURCE_CHANGED_OWN_VALUE row, INFO', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('closeDate', 'CHITTORGARH', '2026-09-18')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { closeDate: '2026-09-19' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'CLOSED', closeDate: '2026-09-18' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.closeDate).toBe('2026-09-18');
    expect(trackedFields()).toEqual([]);
    expect(conflicts.upsertConflict).toHaveBeenCalledTimes(1);
    expect(conflicts.upsertConflict).toHaveBeenCalledWith(expect.objectContaining({
      fieldName: 'closeDate', source1: 'CHITTORGARH', source2: 'CHITTORGARH',
      resolvedSource: 'CHITTORGARH', resolutionReason: 'SOURCE_CHANGED_OWN_VALUE', severity: 'INFO',
    }));
  });

  it('OD-75: a WEBSITE changing its own date on a LIVE IPO is recorded under its own reason, INFO — never the CRITICAL HOLD reason', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('openDate', 'CHITTORGARH', '2026-09-24')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-29' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'UPCOMING', openDate: '2026-09-24' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.openDate).toBe('2026-09-24');
    const calls = vi.mocked(conflicts.upsertConflict).mock.calls.map((c) => c[0] as { resolutionReason: string; severity: string });
    expect(calls).toEqual([expect.objectContaining({ resolutionReason: 'SOURCE_CHANGED_OWN_VALUE', severity: 'INFO' })]);
  });

  it('OD-75 (negative): an exchange postponement writes NO same-source conflict row', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      stored('openDate', 'NSE', '2026-09-24'),
      stored('closeDate', 'NSE', '2026-09-26'),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-29', closeDate: '2026-10-01' },
      source: 'NSE',
      confidence: 90,
      existingData: { status: 'UPCOMING', openDate: '2026-09-24', closeDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.openDate).toBe('2026-09-29');
    expect(conflicts.upsertConflict).not.toHaveBeenCalled();
  });

  it('MINOR-3: an exchange "postponement" that would put the open after the close is NOT taken on a live IPO — the HOLD keeps the page value', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      stored('openDate', 'NSE', '2026-09-24'),
      stored('closeDate', 'NSE', '2026-09-26'),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-29' },
      source: 'NSE',
      confidence: 90,
      existingData: { status: 'UPCOMING', openDate: '2026-09-24', closeDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.openDate).toBe('2026-09-24');
    expect(result.fieldsUpdated).toBe(0);
  });

  it('MINOR-4: the exchange that stated the allotment date may postpone it (§1.11 row 19, E-1; OD-57(a))', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('allotmentDate', 'BSE', '2026-09-26')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { allotmentDate: '2026-09-30' },
      source: 'BSE',
      confidence: 90,
      existingData: { status: 'CLOSED', allotmentDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.allotmentDate).toBe('2026-09-30');
    expect(result.fieldsUpdated).toBe(1);
  });

  it('MINOR-4 (negative): a WEBSITE cannot move an allotment date it set', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('allotmentDate', 'MONEYCONTROL', '2026-09-26')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-od73',
      tableName: 'ipos',
      incomingData: { allotmentDate: '2026-09-30' },
      source: 'MONEYCONTROL',
      confidence: 60,
      existingData: { status: 'CLOSED', allotmentDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });

    expect(result.consolidatedData.allotmentDate).toBe('2026-09-26');
  });
});
