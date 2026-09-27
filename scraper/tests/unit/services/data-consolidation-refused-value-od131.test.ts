/**
 * OD-131 (owner, 2026-09-27, "Rejected = never set"): clarifies OD-75, no rule change.
 * A value the write path refused (sanitizer or validation) was never set:
 *   (a) no provenance row is written for a refused value;
 *   (b) an existing provenance row whose value is not stored does not make the source's next
 *       valid value a "changed own value" (OD-75) -- that value is a first write.
 *
 * Real case (staging, read 2026-09-27): glass-wall-systems-india-ltd, open 2026-09-08, close
 * 2026-09-10, allotment 2026-09-11, listing_date NULL, holds a `listingDate` field_sources row
 * (CHITTORGARH, 2026-09-03 05:30) for CG's refused 2026-09-03, and CG's correct 2026-09-16 is
 * refused. 13 IPOs carry the same shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import { sanitizeIpoWriteFields } from '../../../src/utils/validators.js';
import { isProvenanceValueStored } from '../../../src/services/data-persister.js';
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

/** A REAL field_sources row shape: the table has no value column (staging columns read 2026-09-27). */
function provenanceRow(fieldName: string, source: string, updatedAt: Date) {
  return {
    id: 'e2b683c1-0461-46d9-8e7e-6bf880e5b933',
    ipoId: 'ipo-glass-wall',
    tableName: 'ipos',
    rowKey: '',
    fieldName,
    source,
    confidence: 80,
    previousValue: null,
    previousSource: null,
    dataLineage: null,
    witnesses: null,
    verdict: null,
    updatedBy: 'SYSTEM',
    updatedAt,
    createdAt: updatedAt,
  };
}

const glassWallStored = {
  status: 'CLOSED',
  segment: 'SME',
  openDate: '2026-09-08',
  closeDate: '2026-09-10',
  allotmentDate: '2026-09-11',
  listingDate: null,
};

function trackedFields(): string[] {
  return vi.mocked(fieldSources.trackFieldUpdate).mock.calls.map((c) => (c[0] as { fieldName: string }).fieldName);
}

describe('OD-131: a refused value was never set', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataConsolidationService(fieldSources, conflicts);
    vi.mocked(conflicts.upsertConflict).mockResolvedValue({} as never);
    vi.mocked(conflicts.findUnresolvedForIPO).mockResolvedValue([] as never);
  });

  it('(b) glass-wall: a stale CHITTORGARH listingDate provenance row with no stored value does not block CG 2026-09-16 -- it is a first write', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([
      provenanceRow('listingDate', 'CHITTORGARH', new Date('2026-09-03T05:30:43Z')),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-glass-wall',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-09-16' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: glassWallStored,
      scrapedAt: new Date('2026-09-15T03:15:00Z'),
    });

    expect(result.consolidatedData.listingDate).toBe('2026-09-16');
    expect(result.fieldsUpdated).toBe(1);
    expect(trackedFields()).toEqual(['listingDate']);
    const reasons = vi.mocked(conflicts.upsertConflict).mock.calls.map((c) => (c[0] as { resolutionReason?: string }).resolutionReason);
    expect(reasons).not.toContain('SOURCE_CHANGED_OWN_VALUE');
  });

  it('(a) glass-wall: CG 2026-09-03 is accepted by consolidation, nulled by the write-field sanitizer (before open 2026-09-08), and writes NO field_sources row', async () => {
    // The data-persister consolidation door, step by step on the REAL functions:
    // consolidate (deferred) -> sanitizeIpoWriteFields -> commit only what is stored.
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-glass-wall',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-09-03' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: glassWallStored,
      scrapedAt: new Date('2026-09-03T05:30:43Z'),
      deferProvenance: true,
    });

    // Consolidation itself accepts it (nothing stored, Case 1) -- but writes nothing yet.
    expect(result.consolidatedData?.listingDate).toBe('2026-09-03');
    expect(trackedFields()).toEqual([]);
    expect(result.deferredProvenance?.map((w) => w.fieldName)).toEqual(['listingDate']);

    const finalData = sanitizeIpoWriteFields({
      openDate: glassWallStored.openDate,
      closeDate: glassWallStored.closeDate,
      allotmentDate: glassWallStored.allotmentDate,
      ...result.consolidatedData,
    });
    expect(finalData.listingDate).toBeNull();

    const commit = await service.commitDeferredProvenance(result.deferredProvenance, (w) =>
      isProvenanceValueStored(w, finalData)
    );
    expect(commit.written).toBe(0);
    expect(commit.refused.map((w) => w.fieldName)).toEqual(['listingDate']);
    expect(fieldSources.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('(a, positive) the same door writes provenance for a value that IS stored (CG 2026-09-16)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-glass-wall',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-09-16' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: glassWallStored,
      scrapedAt: new Date('2026-09-15T03:15:00Z'),
      deferProvenance: true,
    });
    const finalData = sanitizeIpoWriteFields({
      openDate: glassWallStored.openDate,
      closeDate: glassWallStored.closeDate,
      allotmentDate: glassWallStored.allotmentDate,
      ...result.consolidatedData,
    });
    expect(finalData.listingDate).toBe('2026-09-16');

    const commit = await service.commitDeferredProvenance(result.deferredProvenance, (w) =>
      isProvenanceValueStored(w, finalData)
    );
    expect(commit.written).toBe(1);
    expect(trackedFields()).toEqual(['listingDate']);
    expect(vi.mocked(fieldSources.trackFieldUpdate).mock.calls[0][0]).toMatchObject({
      fieldName: 'listingDate', source: 'CHITTORGARH', tableName: 'ipos', rowKey: '',
    });
  });

  it('without deferProvenance the service writes provenance inline, unchanged (every other caller)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-glass-wall',
      tableName: 'ipos',
      incomingData: { listingDate: '2026-09-16' },
      source: 'CHITTORGARH',
      confidence: 60,
      existingData: glassWallStored,
    });
    expect(result.deferredProvenance).toBeUndefined();
    expect(trackedFields()).toEqual(['listingDate']);
  });

  it('isProvenanceValueStored: 0, false and empty string are stored values; null/absent are not; other tables are not judged', () => {
    const w = (fieldName: string, tableName = 'ipos', rowKey = '') => ({ fieldName, tableName, rowKey });
    expect(isProvenanceValueStored(w('lotSize'), { lotSize: 0 })).toBe(true);
    expect(isProvenanceValueStored(w('flag'), { flag: false })).toBe(true);
    expect(isProvenanceValueStored(w('symbol'), { symbol: '' })).toBe(true);
    expect(isProvenanceValueStored(w('listingDate'), { listingDate: null })).toBe(false);
    expect(isProvenanceValueStored(w('listingDate'), {})).toBe(false);
    expect(isProvenanceValueStored(w('revenue', 'financial_data', 'FY2025'), {})).toBe(true);
  });
});
