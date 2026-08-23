/**
 * T-283 — CONSOLIDATION_PERCENTAGE gate: the real gate, not a stub.
 *
 * Root cause (T-282): `CONSOLIDATION_PERCENTAGE` was unset in BOTH the
 * Windows and Linux prod scraper envs (pre-existing defect, not a migration
 * regression — see T-283 evidence/2026-08-23-T-283/00-windows-parity-check.log).
 * `feature-flags.ts` defaults it to `parseInt(undefined || '0') = 0`, and
 * `shouldUseFeature('CONSOLIDATION_PERCENTAGE', ipoId)` computes
 * `(hash(ipoId) % 100) < 0`, which is false for every IPO, every time. Every
 * call to `consolidateIPOData()` therefore silently took the
 * `fallbackConsolidation()` branch — accept-all, zero conflict detection,
 * zero guard execution (including the T-281 degenerate-price-band guard) —
 * for the entire time `ENABLE_DATA_CONSOLIDATION=true` has been deployed.
 *
 * EVERY existing consolidation test (data-consolidation-service.test.ts,
 * price-band-consolidation.test.ts, data-consolidation-source-tracking-gate.test.ts)
 * mocks `shouldUseFeature: () => true` — they prove the consolidation LOGIC is
 * correct but can never catch the REAL percentage gate being closed, because
 * they never let the gate run. This file is the missing case: it sets
 * `process.env.CONSOLIDATION_PERCENTAGE` exactly as a deploy env file would
 * (or leaves it unset, exactly as prod shipped), then loads the REAL
 * `feature-flags.js` module fresh via `vi.resetModules()` + dynamic import —
 * no mocking of `shouldUseFeature` or `FEATURE_FLAGS` at all — so this test
 * exercises the identical code path production runs. An unset flag can never
 * silently revert the pipeline again without this test going red.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

const ORIGINAL_ENV = { ...process.env };

async function loadServiceWithPercentage(percentage: string | undefined) {
  vi.resetModules();
  process.env.ENABLE_DATA_CONSOLIDATION = 'true';
  // feature-flags.ts calls dotenv.config() on import, which only fills in
  // keys ABSENT from process.env — a bare `delete` would let the local dev
  // scraper/.env (CONSOLIDATION_PERCENTAGE=100) silently repopulate it,
  // defeating the "unset" simulation. Setting an empty string keeps the key
  // present (dotenv leaves it alone) while `parseInt('' || '0')` in
  // feature-flags.ts still resolves it to 0 — the exact prod-shipped shape.
  process.env.CONSOLIDATION_PERCENTAGE = percentage === undefined ? '' : percentage;

  const { DataConsolidationService } = await import('../../../src/services/data-consolidation-service.js');
  const featureFlags = await import('../../../src/config/feature-flags.js');
  return { DataConsolidationService, featureFlags };
}

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

describe('CONSOLIDATION_PERCENTAGE gate (T-283 — real env, real shouldUseFeature, nothing mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('sanity: the real feature-flags module resolves 0/unset -> always false, 100 -> always true', async () => {
    const { featureFlags: unsetFlags } = await loadServiceWithPercentage(undefined);
    expect(unsetFlags.FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE).toBe(0);
    expect(unsetFlags.shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'any-ipo-id-1')).toBe(false);
    expect(unsetFlags.shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'totally-different-id')).toBe(false);

    const { featureFlags: fullFlags } = await loadServiceWithPercentage('100');
    expect(fullFlags.FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE).toBe(100);
    expect(fullFlags.shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'any-ipo-id-1')).toBe(true);
    expect(fullFlags.shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'totally-different-id')).toBe(true);
  });

  it('CONSOLIDATION_PERCENTAGE unset (the exact shape every prod env shipped with): takes the fallback branch — accepts a degenerate band over a good one, never reads field_sources', async () => {
    const { DataConsolidationService } = await loadServiceWithPercentage(undefined);
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);

    // A real conflict + a degenerate price-band overwrite candidate: NSE
    // already has a good 285-300 range; Chittorgarh reports a degenerate
    // 300-300 (single price, band not yet announced) — the T-281 guard
    // should reject this when consolidation is actually running.
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([
      { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMin', source: 'NSE', value: '285', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
      { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMax', source: 'NSE', value: '300', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'CHITTORGARH' as any,
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      existingData: { priceRangeMin: 285, priceRangeMax: 300 },
      confidence: 80,
    });

    // Decisive fallback signal: the real branch always calls findByIPOId
    // (except for ipoId === 'new'); fallbackConsolidation never does.
    expect(mockFieldSourcesRepo.findByIPOId).not.toHaveBeenCalled();

    // fallbackConsolidation blindly accepts every incoming field as final —
    // the degenerate 300-300 overwrites the good 285-300, and no conflict is
    // ever recorded, reproducing the exact T-282 production symptom
    // (conflictsDetected: 0, DEGENERATE_PRICE_BAND rejection never logged).
    expect(result.conflictsDetected).toBe(0);
    const minField = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(minField?.finalValue).toBe(300);
    expect(minField?.chosenSource).toBe('CHITTORGARH');
    expect(minField?.rejectedSources).toBeUndefined();
  });

  it('CONSOLIDATION_PERCENTAGE=100 (the fix): takes the real consolidation branch — reads field_sources, and the T-281 guard rejects the degenerate overwrite', async () => {
    const { DataConsolidationService } = await loadServiceWithPercentage('100');
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);

    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValueOnce([
      { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMin', source: 'NSE', value: '285', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
      { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMax', source: 'NSE', value: '300', confidence: 95, updatedAt: new Date('2026-08-20T00:00:00Z') },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      source: 'CHITTORGARH' as any,
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      existingData: { priceRangeMin: 285, priceRangeMax: 300 },
      confidence: 80,
    });

    // Decisive real-branch signal: field_sources IS consulted.
    expect(mockFieldSourcesRepo.findByIPOId).toHaveBeenCalledWith('ipo-1');

    // The T-281 no-narrowing guard now actually runs: the degenerate 300-300
    // is rejected and the good stored 285-300 is kept — proving the guard
    // was correct all along and was only ever dead code behind this gate.
    const minField = result.fieldResults.find((f) => f.fieldName === 'priceRangeMin');
    expect(minField?.finalValue).toBe(285);
    expect(minField?.rejectedSources?.[0]?.reason).toBe('DEGENERATE_PRICE_BAND');
  });
});
