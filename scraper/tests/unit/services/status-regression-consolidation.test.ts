/**
 * #70 round 2 — spec field 8 `status`: "must be a legal transition
 * (UPCOMING->OPEN->CLOSED->LISTED); never regresses without an ADMIN row".
 *
 * Staging 2026-09-26 (supervisor, read-only): lumino-industries-ltd
 * field_sources ipos.status source=NSE, previous_source=NSE,
 * previous_value=LISTED, updated 2026-09-07 13:59 UTC — NSE's own feed moved
 * the stored LISTED back to CLOSED through consolidation (timeBased, same rank,
 * newer wins). The guard lives in the consolidation resolver so every source's
 * status write passes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

// Mirrors deepa-consolidation-guards.test.ts: spread the real module first so
// only the flags this suite cares about are overridden.
vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
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

function fieldSourceRow(fieldName: string, source: string, value: any, updatedAt: Date) {
  return {
    ipoId: 'terminal-status-ipo',
    tableName: 'ipos',
    fieldName,
    source,
    value,
    confidence: 100,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt,
    createdAt: updatedAt,
  } as any;
}

async function consolidate(service: DataConsolidationService, stored: string, storedSource: string, incoming: string, incomingSource: string) {
  vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
    fieldSourceRow('status', storedSource, stored, new Date('2026-09-04T10:00:00Z')),
  ]);
  const result = await service.consolidateIPOData({
    ipoId: 'terminal-status-ipo',
    tableName: 'ipos',
    incomingData: { status: incoming },
    source: incomingSource as any,
    existingData: { status: stored } as any,
    scrapedAt: new Date('2026-09-07T13:59:00Z'), // newer than the stored row
  });
  return result.fieldResults.find((f) => f.fieldName === 'status');
}

describe('#70: a non-ADMIN source never regresses ipos.status', () => {
  let service: DataConsolidationService;
  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);
  });

  it('lumino shape: stored LISTED (NSE), newer NSE CLOSED -> stays LISTED', async () => {
    const field = await consolidate(service, 'LISTED', 'NSE', 'CLOSED', 'NSE');
    expect(field?.finalValue).toBe('LISTED');
    expect(field?.conflictReason).toBe('STATUS_REGRESSION_KEPT');
    expect(field?.rejectedSources).toEqual([{ source: 'NSE', value: 'CLOSED', reason: 'STATUS_REGRESSION_KEPT' }]);
  });

  it('stored LISTED (Chittorgarh), higher-ranked NSE CLOSED -> stays LISTED', async () => {
    expect((await consolidate(service, 'LISTED', 'CHITTORGARH', 'CLOSED', 'NSE'))?.finalValue).toBe('LISTED');
  });

  it.each([
    ['OPEN', 'UPCOMING'],
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'UPCOMING'],
    ['LISTED', 'OPEN'],
  ])('stored %s, newer BSE %s -> kept', async (stored, incoming) => {
    expect((await consolidate(service, stored, 'BSE', incoming, 'BSE'))?.finalValue).toBe(stored);
  });

  it('ADMIN may still regress (spec: "without an ADMIN row")', async () => {
    expect((await consolidate(service, 'LISTED', 'NSE', 'CLOSED', 'ADMIN'))?.finalValue).toBe('CLOSED');
  });

  it('a forward move still wins: stored CLOSED, newer NSE LISTED -> LISTED', async () => {
    expect((await consolidate(service, 'CLOSED', 'NSE', 'LISTED', 'NSE'))?.finalValue).toBe('LISTED');
  });

  it('entering WITHDRAWN from an exchange is not a regression (spec: "WITHDRAWN / POSTPONED only from the exchange or ADMIN")', async () => {
    expect((await consolidate(service, 'LISTED', 'NSE', 'WITHDRAWN', 'NSE'))?.finalValue).toBe('WITHDRAWN');
  });
});
