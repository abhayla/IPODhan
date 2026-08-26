/**
 * T-283 -> T-339 — the CONSOLIDATION_PERCENTAGE gate is GONE, and this file
 * now proves the env can no longer reopen it.
 *
 * ORIGINAL DEFECT (T-282/T-283): `CONSOLIDATION_PERCENTAGE` was unset in both
 * the Windows and the Linux prod scraper envs. `feature-flags.ts` defaulted it
 * to `parseInt(undefined || '0') = 0`, and
 * `shouldUseFeature('CONSOLIDATION_PERCENTAGE', ipoId)` computed
 * `(hash(ipoId) % 100) < 0` — false for every IPO, every time. Every call to
 * `consolidateIPOData()` therefore silently took the accept-all fallback
 * branch (zero conflict detection, zero guard execution including the T-281
 * degenerate-price-band guard) for the entire time `ENABLE_DATA_CONSOLIDATION=true`
 * had been deployed.
 *
 * T-283 fixed the VALUE. T-339 removes the SWITCH: the percentage knob, its two
 * siblings, and the three `ENABLE_*` booleans are deleted from `FEATURE_FLAGS`,
 * and `consolidateIPOData()` has no gate left to take. The env vars are still
 * checked at startup — an OFF/partial leftover hard-fails the process rather
 * than quietly reverting the pipeline (see
 * write-path-consolidation-mandatory.test.ts block 1b).
 *
 * These tests still load the REAL `feature-flags.js` fresh via
 * `vi.resetModules()` + dynamic import, with the env set exactly as a deploy
 * file would set it — no mocking of `shouldUseFeature` or `FEATURE_FLAGS` — so
 * they exercise the identical code path production runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

const ORIGINAL_ENV = { ...process.env };

async function loadServiceWithPercentage(percentage: string | undefined) {
  vi.resetModules();
  // feature-flags.ts calls dotenv.config() on import, which only fills in keys
  // ABSENT from process.env — a bare `delete` would let the local dev
  // scraper/.env (CONSOLIDATION_PERCENTAGE=100) silently repopulate it,
  // defeating the "unset" simulation. Setting an empty string keeps the key
  // present (dotenv leaves it alone) while reading as "not set to anything".
  process.env.CONSOLIDATION_PERCENTAGE = percentage === undefined ? '' : percentage;

  const { DataConsolidationService } = await import('../../../src/services/data-consolidation-service.js');
  return { DataConsolidationService };
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

// The exact T-282 production shape: NSE already published a good 285-300 band;
// Chittorgarh reports a degenerate 300-300 (single price, band not yet
// announced). The T-281 no-narrowing guard must reject it.
function degenerateBandInput() {
  return {
    ipoId: 'ipo-1',
    tableName: 'ipos',
    source: 'CHITTORGARH' as any,
    incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
    existingData: { priceRangeMin: 285, priceRangeMax: 300 },
    confidence: 80,
  };
}

function nseBandSources() {
  return [
    { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMin', source: 'NSE', value: '285', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
    { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMax', source: 'NSE', value: '300', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
  ];
}

describe('CONSOLIDATION_PERCENTAGE is retired (T-339, was T-283) — real env, nothing mocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('the percentage knob no longer exists on FEATURE_FLAGS at any value', async () => {
    vi.resetModules();
    process.env.CONSOLIDATION_PERCENTAGE = '0';
    const flags = await import('../../../src/config/feature-flags.js');
    expect(flags.FEATURE_FLAGS).not.toHaveProperty('CONSOLIDATION_PERCENTAGE');
    expect(flags.RETIRED_CONSOLIDATION_ENV_KEYS).toContain('CONSOLIDATION_PERCENTAGE');
  });

  it('CONSOLIDATION_PERCENTAGE UNSET (the exact shape every prod env shipped with) still runs REAL consolidation — this is the T-282 regression, now impossible', async () => {
    const { DataConsolidationService } = await loadServiceWithPercentage(undefined);
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce(nseBandSources());

    const result = await service.consolidateIPOData(degenerateBandInput());

    // Decisive real-branch signal: field_sources IS consulted. The accept-all
    // fallback never called it — that was the T-282 fingerprint.
    expect(mockFieldSourcesRepo.findByIPOId).toHaveBeenCalledWith('ipo-1');

    // And the T-281 guard actually runs: the degenerate 300-300 is rejected
    // and the good stored 285-300 survives.
    const minField = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(minField?.finalValue).toBe(285);
    expect(minField?.rejectedSources?.[0]?.reason).toBe('DEGENERATE_PRICE_BAND');
  });

  it('CONSOLIDATION_PERCENTAGE=0 behaves identically — the value is inert, not a kill switch', async () => {
    const { DataConsolidationService } = await loadServiceWithPercentage('0');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce(nseBandSources());

    const result = await service.consolidateIPOData(degenerateBandInput());

    expect(mockFieldSourcesRepo.findByIPOId).toHaveBeenCalledWith('ipo-1');
    const minField = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(minField?.finalValue).toBe(285);
  });

  it('CONSOLIDATION_PERCENTAGE=100 (todays prod value) behaves identically — no behaviour change from this task', async () => {
    const { DataConsolidationService } = await loadServiceWithPercentage('100');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce(nseBandSources());

    const result = await service.consolidateIPOData(degenerateBandInput());

    expect(mockFieldSourcesRepo.findByIPOId).toHaveBeenCalledWith('ipo-1');
    const minField = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(minField?.finalValue).toBe(285);
    expect(minField?.rejectedSources?.[0]?.reason).toBe('DEGENERATE_PRICE_BAND');
  });
});
