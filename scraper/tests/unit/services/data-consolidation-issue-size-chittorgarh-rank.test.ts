/**
 * T-453: proves through the REAL resolver (`DataConsolidationService.consolidateIPOData`,
 * not just `getSourcePriority`) that a Chittorgarh-sourced issueSize now wins over an
 * existing NSE-sourced value.
 *
 * RCA: nse-api-client.ts computeNSEIssueSizeRupees derives issueSize as
 * (noOfSharesOffered / net offer) x price, which excludes the OFS. Chittorgarh's list
 * API field ('Total Issue Amount (Incl.Firm reservations) (Rs.cr.)') is read directly
 * from the source and matches the site's TOTAL-incl-OFS definition (schema.ts ~1102).
 * Before this fix, an NSE-tracked issueSize could never be corrected by a later
 * Chittorgarh write because NSE outranked CHITTORGARH in the matrix.
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

describe('T-453: Chittorgarh printed total outranks the NSE/BSE share-count derivation for issueSize', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a Chittorgarh total REPLACES a tracked NSE-derived (too-small) issueSize', async () => {
    // NSE tracked a share-count-derived figure (e.g. Meesho's undercounted
    // 3,085 Cr, missing the OFS).
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'issueSize',
        source: 'NSE',
        value: '30850000000.00', // 3,085 Cr as it round-trips from a pg NUMERIC column
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    // Chittorgarh reports the printed total (5,421 Cr).
    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { issueSize: 54210000000 },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    expect(result.fieldsUpdated).toBe(1);
    expect(result.consolidatedData.issueSize).toBe(54210000000);
  });

  it('an NSE write can no longer overwrite a tracked Chittorgarh issueSize (lower priority loses)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'issueSize',
        source: 'CHITTORGARH',
        value: '54210000000.00',
        confidence: 80,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { issueSize: 30850000000 }, // NSE's smaller derived figure
      source: 'NSE',
      confidence: 90,
    });

    // Lower-priority source loses on a genuine conflict — the tracked
    // Chittorgarh value must survive in the consolidated payload (returned
    // as the raw tracked value, a pg NUMERIC string round-trip).
    expect(Number(result.consolidatedData.issueSize)).toBe(54210000000);
  });
});
