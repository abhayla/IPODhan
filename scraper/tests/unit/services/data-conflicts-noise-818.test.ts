/**
 * #818 / F-181 — same-source and bookkeeping data_conflicts noise, on the REAL
 * `DataConsolidationService.consolidateIPOData` and the real rupee converters.
 *
 * Measured on ipodhan_staging 2026-09-23..25 (13 same-source unresolved rows):
 *  (1) lastScrapedAt / updatedAt DRHP-vs-DRHP rows            -> bookkeeping is never resolved
 *  (3) CHITTORGARH changing its own listingDate / issueSize     -> OD-75: ONE admin-only row under
 *      SOURCE_CHANGED_OWN_VALUE (spec-correct; pinned here, policy unchanged); a source WITH the
 *      refresh right (NSE listingDate) writes no row
 *  (4) 428400000.00000006 / 245799999.99999997 issue sizes      -> exact rupees at the parse boundary
 * and a genuine cross-source disagreement still creates its conflict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';
import { parseChittorgarhAmount } from '../../../src/scrapers/chittorgarh-scraper.js';
import { extractIssueSizeFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';
import { normalizeCurrency } from '../../../src/services/normalization-engine.js';
import { toRupees } from '../../../src/services/filing-persister.js';

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

function stored(fieldName: string, source: string, value: unknown) {
  const at = new Date('2026-09-20T00:00:00Z');
  return {
    ipoId: 'ipo-818', tableName: 'ipos', rowKey: '', fieldName, source, value, confidence: 65,
    dataLineage: null, previousValue: null, previousSource: null, updatedAt: at, createdAt: at,
  };
}

const conflictRows = () =>
  vi.mocked(conflicts.upsertConflict).mock.calls.map((c) => c[0] as unknown as Record<string, unknown>);
const trackedFields = () =>
  vi.mocked(fieldSources.trackFieldUpdate).mock.calls.map((c) => (c[0] as { fieldName: string }).fieldName);

describe('#818 consolidation: bookkeeping and same-source rows', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataConsolidationService(fieldSources, conflicts);
    vi.mocked(conflicts.upsertConflict).mockResolvedValue({} as never);
    vi.mocked(conflicts.findUnresolvedForIPO).mockResolvedValue([] as never);
  });

  it('(1) a DRHP re-read with new lastScrapedAt/updatedAt stamps writes NO conflict row and no provenance, and passes the new stamps through', async () => {
    const oldStamp = '2026-09-23T10:00:00.000Z';
    const newScraped = new Date('2026-09-25T04:30:00.000Z');
    const newUpdated = new Date('2026-09-25T04:30:01.000Z');
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      stored('lastScrapedAt', 'DRHP', oldStamp),
      stored('updatedAt', 'DRHP', oldStamp),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-818',
      tableName: 'ipos',
      incomingData: { lastScrapedAt: newScraped, updatedAt: newUpdated },
      source: 'DRHP',
      confidence: 90,
      existingData: { status: 'LISTED', lastScrapedAt: oldStamp, updatedAt: oldStamp },
      scrapedAt: newScraped,
    });

    expect(conflictRows()).toEqual([]);
    expect(trackedFields()).toEqual([]);
    expect(result.consolidatedData).toEqual({ lastScrapedAt: newScraped, updatedAt: newUpdated });
    expect(result.conflictsDetected).toBe(0);
  });

  it('(3) CHITTORGARH moving its own listingDate (no refresh right) writes exactly ONE OD-75 admin-only row and keeps the old date', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('listingDate', 'CHITTORGARH', '2026-09-30')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-818',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-10-05' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: { status: 'UPCOMING', segment: 'SME', listingDate: '2026-09-30' },
      scrapedAt: new Date('2026-09-25T04:30:00Z'),
    });

    expect(conflictRows()).toHaveLength(1);
    expect(conflictRows()[0]).toMatchObject({
      fieldName: 'listingDate',
      source1: 'CHITTORGARH',
      value1: '2026-09-30',
      source2: 'CHITTORGARH',
      value2: '2026-10-05',
      resolutionReason: 'SOURCE_CHANGED_OWN_VALUE',
      severity: 'INFO',
    });
    expect(result.consolidatedData.listingDate).toBe('2026-09-30');
  });

  it('(3) NSE moving its own listingDate (refresh granted by allowsSameSourceRefresh) is a refresh: no row, new date', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('listingDate', 'NSE', '2026-09-30')] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-818',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-10-05' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', listingDate: '2026-09-30' },
      scrapedAt: new Date('2026-09-25T04:30:00Z'),
    });

    expect(conflictRows()).toEqual([]);
    expect(result.consolidatedData.listingDate).toBe('2026-10-05');
  });

  it('a genuine cross-source disagreement still creates its conflict row', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([stored('listingDate', 'CHITTORGARH', '2026-09-30')] as never);

    await service.consolidateIPOData({
      ipoId: 'ipo-818',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-10-05' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', listingDate: '2026-09-30' },
      scrapedAt: new Date('2026-09-25T04:30:00Z'),
    });

    expect(conflictRows()).toHaveLength(1);
    expect(conflictRows()[0]).toMatchObject({
      fieldName: 'listingDate',
      source1: 'CHITTORGARH',
      value1: '2026-09-30',
      source2: 'NSE',
      value2: '2026-10-05',
    });
  });
});

describe('#818 (4) crore -> rupees is exact at every parse boundary', () => {
  // vinod-texworld-ltd 42.84 cr, panchatv-bharat-ltd 24.58 cr (staging 2026-09-23..25).
  it('Chittorgarh report amount', () => {
    expect(parseChittorgarhAmount('42.84')).toBe(428400000);
    expect(parseChittorgarhAmount('24.58')).toBe(245800000);
    expect(parseChittorgarhAmount('21.08')).toBe(210800000);
  });

  it('Chittorgarh detail page amount', () => {
    const html = (cr: string) => `<a title="Issue Size">Issue Size</a></span></td><td><span>₹${cr} Cr</span></td>`;
    expect(extractIssueSizeFromDetailHtml(html('42.84'), { floor: 100_000_000, priceRangeMax: null })).toBe(428400000);
    expect(extractIssueSizeFromDetailHtml(html('24.58'), { floor: 100_000_000, priceRangeMax: null })).toBe(245800000);
  });

  it('normalizeCurrency (crore string and bare crore number)', () => {
    expect(normalizeCurrency('₹42.84 Cr')).toBe(428400000);
    expect(normalizeCurrency(24.58, 'issueSize')).toBe(245800000);
  });

  it('filing amount in crore', () => {
    expect(toRupees(42.84, 'CRORE')).toBe(428400000);
    expect(toRupees(24.58, 'CRORE')).toBe(245800000);
  });
});
