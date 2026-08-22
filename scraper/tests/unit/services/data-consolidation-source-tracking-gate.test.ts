/**
 * P3-5 (T-278) regression: conflictsDetected==0 in prod despite 3760
 * fields/cycle consolidated.
 *
 * Root cause: ENABLE_SOURCE_TRACKING defaults to false (never set in any
 * deploy config — grep confirms it has never appeared in deploy-linux.yml
 * or its retired Windows predecessor) and gates `trackFieldSource()`
 * (data-consolidation-service.ts ~line 614). With it off, a scraper write
 * NEVER persists a field_sources row, so on every later cycle
 * `findByIPOId()` returns [] for that field — Case 1 ("no existing value")
 * fires forever, and Case 3 (the actual conflict-comparison branch) is
 * unreachable in practice, even though ENABLE_DATA_CONSOLIDATION is on and
 * the field IS being re-scraped from multiple disagreeing sources every
 * cycle. This is NOT dead code from a refactor — the detection logic
 * itself is correct (see data-consolidation-service.test.ts, which proves
 * it with ENABLE_SOURCE_TRACKING force-mocked true) — it is an inert
 * combination of two independently-gated flags where one is a hard
 * prerequisite for the other's counter to ever move.
 *
 * This file mocks the REAL production defaults (both flags false, as
 * shipped) to prove the inertness end-to-end, and confirms that once
 * field_sources already holds a prior value for a field (as it does for
 * admin-edited fields, or as it will for scraper fields once
 * ENABLE_SOURCE_TRACKING is turned on), conflict detection resumes working
 * without any further code change — turning the flag on is the complete
 * fix. Enabling it in production is an owner-gated activation
 * (owner-gated-feature-flags.md) and is intentionally NOT flipped by this
 * change; see the T-278 PR description.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

// Mirror the ACTUAL shipped defaults: process.env.ENABLE_* unset -> false.
// This is the config every prod scraper cycle runs under today.
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: false,
    ENABLE_CONFLICT_DETECTION: false,
    ENABLE_DATA_CONSOLIDATION: true, // confirmed on in prod (3760 fields/cycle)
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_DRHP_EXTRACTION: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 0,
    CONFLICT_DETECTION_PERCENTAGE: 0,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: (flag: string) => flag === 'CONSOLIDATION_PERCENTAGE',
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
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

describe('DataConsolidationService — prod-default flag gate (P3-5 root cause)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('never persists a field source under prod defaults, so a disagreeing re-scrape stays undetected forever', async () => {
    // Cycle 1: no prior field_sources row (fresh field). NSE reports 1000.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([]);
    const cycle1 = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'NSE' as any,
      incomingData: { lotSize: 1000 },
      confidence: 90,
    });
    expect(cycle1.conflictsDetected).toBe(0);
    // trackFieldUpdate is gated by ENABLE_SOURCE_TRACKING=false -> never called.
    expect(mockFieldSourcesRepo.trackFieldUpdate).not.toHaveBeenCalled();

    // Cycle 2: because cycle 1 never wrote a field_sources row, the repo
    // STILL returns [] here even though BSE now disagrees sharply (600 vs
    // 1000) — a genuine conflict a working detector would flag.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([]);
    const cycle2 = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'BSE' as any,
      incomingData: { lotSize: 600 },
      confidence: 90,
    });

    // This is the P3-5 symptom reproduced at unit scale: two disagreeing
    // sources, zero conflicts recorded, because the baseline was never saved.
    expect(cycle2.conflictsDetected).toBe(0);
  });

  it('resumes detecting conflicts as soon as a prior field_sources row exists — proving the fix is the flag, not the logic', async () => {
    // Simulates the state AFTER ENABLE_SOURCE_TRACKING is turned on and has
    // run at least one prior cycle (or an admin-tracked field): a baseline
    // row already exists in field_sources.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([
      {
        tableName: 'ipos',
        fieldName: 'lotSize',
        value: 1000,
        source: 'NSE',
        updatedAt: new Date(),
      },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'BSE' as any,
      incomingData: { lotSize: 600 }, // 40% off NSE's 1000 -> CRITICAL
      confidence: 90,
    });

    // ENABLE_CONFLICT_DETECTION is still false here (persistence to
    // data_conflicts is owner-gated), but the in-memory counter that drives
    // the "conflictsDetected" log field (data-persister.ts) is NOT gated by
    // that flag — only the DB write is. The detection logic itself works
    // the instant a comparison baseline exists.
    expect(result.conflictsDetected).toBeGreaterThan(0);
  });
});
