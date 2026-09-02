/**
 * W-60 — terminal `ipo_status` values (WITHDRAWN / POSTPONED) must not be
 * silently overwritten by a non-ADMIN source in the scraper's per-field
 * consolidation resolver.
 *
 * Context: `ipo_status` gained terminal values WITHDRAWN and POSTPONED
 * (commit 4a96ab7d). The web updater refuses to move an IPO off either via
 * `TERMINAL_STATUSES` (`web/lib/services/status-updater-service.ts`), but the
 * scraper's `resolveConflict` per-field resolver had no matching guard:
 * `status` sources rank ADMIN > NSE > BSE > MONEYCONTROL > CHITTORGARH and
 * the field is `timeBased: true`, so a stored WITHDRAWN (e.g. from a BSE
 * public notice) was overwritten by NSE's next ordinary "Closed"/"Open", or
 * by a newer BSE row.
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

describe('terminal ipo_status consolidation guard (W-60)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);
  });

  it('keeps an existing WITHDRAWN status when NSE sends a newer ordinary CLOSED', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('status', 'BSE', 'WITHDRAWN', new Date('2026-08-20T10:00:00Z')),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'terminal-status-ipo',
      tableName: 'ipos',
      incomingData: { status: 'CLOSED' },
      source: 'NSE',
      existingData: { status: 'WITHDRAWN' } as any,
      scrapedAt: new Date('2026-08-21T10:00:00Z'), // newer than the stored row
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'status');
    expect(field?.finalValue).toBe('WITHDRAWN');
    expect(field?.chosenSource).toBe('BSE');
    expect(field?.hadConflict).toBe(true);
    expect(field?.conflictSeverity).toBe('WARNING');
    expect(field?.conflictReason).toBe('TERMINAL_STATUS_KEPT');
    expect(field?.rejectedSources).toEqual([
      { source: 'NSE', value: 'CLOSED', reason: 'TERMINAL_STATUS_KEPT' },
    ]);
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'status',
        source1: 'BSE',
        source2: 'NSE',
        resolvedSource: 'BSE',
        resolutionReason: 'TERMINAL_STATUS_KEPT',
        severity: 'WARNING',
      })
    );
  });

  it('keeps an existing POSTPONED status against a newer same-source OPEN', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('status', 'BSE', 'POSTPONED', new Date('2026-08-20T10:00:00Z')),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'terminal-status-ipo',
      tableName: 'ipos',
      incomingData: { status: 'OPEN' },
      source: 'BSE', // same source, would normally win as a fresher time-based write
      existingData: { status: 'POSTPONED' } as any,
      scrapedAt: new Date('2026-08-21T10:00:00Z'),
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'status');
    expect(field?.finalValue).toBe('POSTPONED');
    expect(field?.chosenSource).toBe('BSE');
    expect(field?.conflictReason).toBe('TERMINAL_STATUS_KEPT');
  });

  it('lets ADMIN move a WITHDRAWN status back to UPCOMING', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('status', 'BSE', 'WITHDRAWN', new Date('2026-08-20T10:00:00Z')),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'terminal-status-ipo',
      tableName: 'ipos',
      incomingData: { status: 'UPCOMING' },
      source: 'ADMIN',
      existingData: { status: 'WITHDRAWN' } as any,
      scrapedAt: new Date('2026-08-21T10:00:00Z'),
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'status');
    expect(field?.finalValue).toBe('UPCOMING');
    expect(field?.chosenSource).toBe('ADMIN');
    expect(field?.conflictReason).not.toBe('TERMINAL_STATUS_KEPT');
  });

  it('allows a terminal value to be entered for the first time (existing non-terminal)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      // existing OPEN from BSE (lower priority than NSE for `status`)
      fieldSourceRow('status', 'BSE', 'OPEN', new Date('2026-08-20T10:00:00Z')),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'terminal-status-ipo',
      tableName: 'ipos',
      incomingData: { status: 'WITHDRAWN' },
      source: 'NSE', // higher source priority than BSE for `status`
      existingData: { status: 'OPEN' } as any,
      scrapedAt: new Date('2026-08-21T10:00:00Z'),
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'status');
    expect(field?.finalValue).toBe('WITHDRAWN');
    expect(field?.chosenSource).toBe('NSE');
    expect(field?.conflictReason).not.toBe('TERMINAL_STATUS_KEPT');
  });

  it('leaves a non-status field untouched by the terminal-status guard (newest-wins still works)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'terminal-status-ipo',
        tableName: 'ipos',
        fieldName: 'total_subscription',
        source: 'NSE',
        value: '5',
        confidence: 95,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-20T10:00:00Z'),
        createdAt: new Date(),
      },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'terminal-status-ipo',
      tableName: 'ipos',
      incomingData: { total_subscription: 8 },
      source: 'NSE',
      confidence: 95,
      scrapedAt: new Date('2026-08-20T11:00:00Z'), // newer -> TIME_BASED_PRIORITY wins
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'total_subscription');
    expect(field?.chosenSource).toBe('NSE');
    expect(field?.finalValue).toBe(8);
    expect(field?.conflictReason).not.toBe('TERMINAL_STATUS_KEPT');
  });
});
