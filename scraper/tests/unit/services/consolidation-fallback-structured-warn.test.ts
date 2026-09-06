/**
 * T-455 (issue #174, T-284C checker F1/F2) — `fallbackConsolidation()` used
 * to log NOTHING at all (no console.warn, no logger.warn — a stricter defect
 * than the checker's original F1 finding of "plain console.warn", since a
 * later change had silently removed even that). A row could take the
 * accept-all / zero-conflict-detection branch (the exact T-282/T-283
 * production symptom) with no signal to alert on.
 *
 * This test loads the REAL feature-flags module (nothing mocked, same
 * pattern as consolidation-percentage-gate.test.ts) so it exercises the
 * identical branch production takes, and spies on the real structured
 * logger rather than re-implementing one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

const ORIGINAL_ENV = { ...process.env };

async function loadServiceWithFlags(enableConsolidation: 'true' | 'false', percentage: string | undefined) {
  vi.resetModules();
  process.env.ENABLE_DATA_CONSOLIDATION = enableConsolidation;
  // See consolidation-percentage-gate.test.ts: an empty string keeps the key
  // present so dotenv.config() (which only fills ABSENT keys) can't
  // repopulate it from a local .env, while parseInt('' || '0') still
  // resolves to 0 — the exact prod-shipped "unset" shape.
  process.env.CONSOLIDATION_PERCENTAGE = percentage === undefined ? '' : percentage;

  const { DataConsolidationService } = await import('../../../src/services/data-consolidation-service.js');
  const loggerModule = await import('../../../src/utils/logger.js');
  return { DataConsolidationService, logger: loggerModule.default };
}

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

describe('consolidation fallback warning is a structured pino warn (T-455, issue #174)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('ENABLE_DATA_CONSOLIDATION=false: fires a structured warn with {flag, percentage, reason}', async () => {
    const { DataConsolidationService, logger } = await loadServiceWithFlags('false', '100');
    const warnSpy = vi.spyOn(logger, 'warn');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);

    await service.consolidateIPOData({
      ipoId: 'ipo-flag-off',
      tableName: 'ipos',
      source: 'CHITTORGARH' as any,
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      existingData: {},
      confidence: 80,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'ipo-flag-off',
        flag: false,
        percentage: 100,
        reason: expect.stringMatching(/ENABLE_DATA_CONSOLIDATION/),
      }),
      expect.stringContaining('fallback mode')
    );
  });

  it('ENABLE_DATA_CONSOLIDATION=true but CONSOLIDATION_PERCENTAGE unset (0): still fires the warn — the flag alone does not silence it', async () => {
    const { DataConsolidationService, logger } = await loadServiceWithFlags('true', undefined);
    const warnSpy = vi.spyOn(logger, 'warn');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);

    await service.consolidateIPOData({
      ipoId: 'ipo-pct-zero',
      tableName: 'ipos',
      source: 'CHITTORGARH' as any,
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      existingData: {},
      confidence: 80,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'ipo-pct-zero',
        flag: true,
        percentage: 0,
        reason: expect.stringMatching(/CONSOLIDATION_PERCENTAGE/),
      }),
      expect.stringContaining('fallback mode')
    );
  });

  it('CONSOLIDATION_PERCENTAGE=100 (real consolidation branch taken): the fallback warn does NOT fire', async () => {
    const { DataConsolidationService, logger } = await loadServiceWithFlags('true', '100');
    const warnSpy = vi.spyOn(logger, 'warn');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([]);

    await service.consolidateIPOData({
      ipoId: 'ipo-real-branch',
      tableName: 'ipos',
      source: 'CHITTORGARH' as any,
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      existingData: {},
      confidence: 80,
    });

    const fallbackWarnCalls = warnSpy.mock.calls.filter(
      ([, msg]) => typeof msg === 'string' && msg.includes('fallback mode')
    );
    expect(fallbackWarnCalls).toHaveLength(0);
  });
});
