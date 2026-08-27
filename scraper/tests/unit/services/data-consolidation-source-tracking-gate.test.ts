/**
 * P3-5 (T-278) -> T-339: the flag that caused it is gone; this file now locks
 * the INVERSE.
 *
 * ORIGINAL DEFECT (T-278 P3-5): `ENABLE_SOURCE_TRACKING` defaulted to false and
 * gated `trackFieldSource()`. With it off, a scraper write NEVER persisted a
 * field_sources row, so on every later cycle `findByIPOId()` returned [] for
 * that field — the "no existing value" branch fired forever and
 * `conflictsDetected` stayed 0 in prod even while multiple disagreeing sources
 * re-scraped the same field every cycle. The detection LOGIC was correct; the
 * flag combination made it unreachable.
 *
 * T-339 deleted `ENABLE_SOURCE_TRACKING` (and `ENABLE_CONFLICT_DETECTION`, and
 * `ENABLE_DATA_CONSOLIDATION`, and the three percentage knobs) rather than
 * documenting the trap again. Source tracking and conflict persistence are
 * unconditional.
 *
 * So this suite is inverted: with the env EXACTLY as prod shipped it for the
 * pipeline's entire life (every one of those vars UNSET), the baseline IS
 * written on cycle 1 and the disagreement IS detected on cycle 2. If someone
 * reintroduces a gate, the first test goes red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

// The real module is used deliberately — there is no longer a flag to mock.
// The only env-dependent knobs left (DEBUG_DATA_FLOW etc.) are unset here,
// which is the production shape.

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

describe('DataConsolidationService — tracking + conflict detection are unconditional (T-339, was P3-5)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    for (const k of [
      'ENABLE_DATA_CONSOLIDATION',
      'ENABLE_CONFLICT_DETECTION',
      'ENABLE_SOURCE_TRACKING',
      'CONSOLIDATION_PERCENTAGE',
      'SOURCE_TRACKING_PERCENTAGE',
      'CONFLICT_DETECTION_PERCENTAGE',
    ]) {
      delete process.env[k];
    }
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('persists the field_sources baseline on cycle 1 and DETECTS the cycle-2 disagreement (P3-5 inverted)', async () => {
    // Cycle 1: no prior field_sources row (fresh field). NSE reports 1000.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([]);
    const cycle1 = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'NSE' as any,
      incomingData: { lotSize: 1000 },
      confidence: 90,
    });
    expect(cycle1.conflictsDetected).toBe(0); // nothing to disagree with yet

    // The baseline IS written — this single assertion is the whole P3-5 fix.
    expect(mockFieldSourcesRepo.trackFieldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ipoId: 'ipo-1', fieldName: 'lotSize', value: 1000, source: 'NSE' })
    );

    // Cycle 2: the baseline cycle 1 wrote is now visible to the repo, so BSE's
    // sharply different value (600 vs 1000) is a comparison, not a first sight.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([
      { tableName: 'ipos', fieldName: 'lotSize', value: 1000, source: 'NSE', updatedAt: new Date() },
    ]);
    const cycle2 = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'BSE' as any,
      incomingData: { lotSize: 600 },
      confidence: 90,
    });

    expect(cycle2.conflictsDetected).toBeGreaterThan(0);
  });

  it('persists the conflict to data_conflicts too — detection and the audit trail are no longer separately gated', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([
      { tableName: 'ipos', fieldName: 'lotSize', value: 1000, source: 'NSE', updatedAt: new Date() },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'BSE' as any,
      incomingData: { lotSize: 600 }, // 40% off NSE's 1000 -> CRITICAL
      confidence: 90,
    });

    expect(result.conflictsDetected).toBeGreaterThan(0);
    // ENABLE_CONFLICT_DETECTION used to gate this write independently of the
    // in-memory counter, which is how prod could log "conflicts detected" with
    // an empty data_conflicts table. Both now move together.
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalled();
  });

  it('shadow mode is the ONLY thing that still suppresses persistence (negative control)', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([]);
    await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'NSE' as any,
      incomingData: { lotSize: 1000 },
      confidence: 90,
      shadowMode: true,
    });
    expect(mockFieldSourcesRepo.trackFieldUpdate).not.toHaveBeenCalled();
    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
  });
});
