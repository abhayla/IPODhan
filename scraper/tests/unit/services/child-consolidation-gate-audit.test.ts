/**
 * Item 1 slice s5b — the three-gate audit, and the empty-ipoId trap.
 *
 * These cases need NO database, and that is load-bearing, not incidental: the
 * environments they protect are precisely the ones that may have no database —
 * CI's integration job before it is wired, a developer laptop, the next box we
 * build. They were first written into `tests/integration/`, where the
 * `db-safety-guard` global setup (correctly) hard-fails without a confirmed
 * non-production target: the file never LOADED and vitest reported "no tests".
 * A check that protects the fresh-environment trap and cannot itself run in a
 * fresh environment is that same trap, one level up. So they live here, in the
 * unit tier, and run with nothing configured at all.
 *
 * The genuinely DB-dependent proof — two sources resolving by rank against a
 * real `field_sources` unique constraint — stays in
 * tests/integration/child-row-consolidation-financials.integration.test.ts.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator';
import { FEATURE_FLAGS, validateFeatureFlags } from '../../../src/config/feature-flags';

/**
 * The fresh-environment gate audit. Deliberately NOT `skipIf(!DATABASE_URL)`:
 * it needs no database, and the environments it protects — CI's integration
 * job, a developer laptop, the next box we build — are exactly the ones where
 * a DB might be absent and a quiet cycle gets written down as a proof.
 *
 * ENABLE_CHILD_TABLE_CONSOLIDATION is the THIRD gate in a chain. With either
 * of the two ahead of it closed, `consolidateIPOData` falls back: incoming
 * accepted, no resolution, no provenance — and everything LOOKS fine.
 * `validateFeatureFlags()` (already called at scraper start, index.ts:575)
 * must say so, naming the values.
 */
describe('three-gate audit at scraper start', () => {
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  const saved = {
    child: f.ENABLE_CHILD_TABLE_CONSOLIDATION,
    consolidation: f.ENABLE_DATA_CONSOLIDATION,
    tracking: f.ENABLE_SOURCE_TRACKING,
    pct: f.CONSOLIDATION_PERCENTAGE,
  };
  afterAll(() => {
    f.ENABLE_CHILD_TABLE_CONSOLIDATION = saved.child;
    f.ENABLE_DATA_CONSOLIDATION = saved.consolidation;
    f.ENABLE_SOURCE_TRACKING = saved.tracking;
    f.CONSOLIDATION_PERCENTAGE = saved.pct;
  });

  function warningsUnder(env: Record<string, unknown>): string[] {
    f.ENABLE_SOURCE_TRACKING = true;
    Object.assign(f, env);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      validateFeatureFlags();
      return spy.mock.calls.map((c) => String(c[0]));
    } finally {
      spy.mockRestore();
    }
  }

  const UNREACHABLE = 'child-table consolidation flag is ON but the path is unreachable';

  it('warns, naming BOTH values, when ENABLE_DATA_CONSOLIDATION gates the path off', () => {
    const warnings = warningsUnder({
      ENABLE_CHILD_TABLE_CONSOLIDATION: true,
      ENABLE_DATA_CONSOLIDATION: false,
      CONSOLIDATION_PERCENTAGE: 100,
    });
    const line = warnings.find((w) => w.includes(UNREACHABLE));
    expect(line).toBeDefined();
    expect(line).toContain('ENABLE_DATA_CONSOLIDATION=false');
    expect(line).toContain('CONSOLIDATION_PERCENTAGE=100');
  });

  it('warns, naming BOTH values, when CONSOLIDATION_PERCENTAGE=0 gates the path off', () => {
    const warnings = warningsUnder({
      ENABLE_CHILD_TABLE_CONSOLIDATION: true,
      ENABLE_DATA_CONSOLIDATION: true,
      CONSOLIDATION_PERCENTAGE: 0,
    });
    const line = warnings.find((w) => w.includes(UNREACHABLE));
    expect(line).toBeDefined();
    expect(line).toContain('ENABLE_DATA_CONSOLIDATION=true');
    expect(line).toContain('CONSOLIDATION_PERCENTAGE=0');
  });

  it('stays silent when all three gates are open — the staging/prod shape', () => {
    const warnings = warningsUnder({
      ENABLE_CHILD_TABLE_CONSOLIDATION: true,
      ENABLE_DATA_CONSOLIDATION: true,
      CONSOLIDATION_PERCENTAGE: 100,
    });
    expect(warnings.find((w) => w.includes(UNREACHABLE))).toBeUndefined();
  });

  it('stays silent when the child flag itself is off — that is a choice, not a trap', () => {
    const warnings = warningsUnder({
      ENABLE_CHILD_TABLE_CONSOLIDATION: false,
      ENABLE_DATA_CONSOLIDATION: false,
      CONSOLIDATION_PERCENTAGE: 0,
    });
    expect(warnings.find((w) => w.includes(UNREACHABLE))).toBeUndefined();
  });

  it('reports all three gates in the startup flag snapshot', async () => {
    const { getFeatureStatus } = await import('../../../src/config/feature-flags');
    f.ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    const status = getFeatureStatus();
    expect(status).toHaveProperty('CHILD_TABLE_CONSOLIDATION');
    expect(status).toHaveProperty('DATA_CONSOLIDATION');
    expect(status).toHaveProperty('CONSOLIDATION_PCT');
  });
});

/**
 * Amendment (2): a startup value is a statement about CONFIGURATION; it proves
 * nothing about a particular IPO, because CONSOLIDATION_PERCENTAGE is a
 * per-ipoId hash rollout (`simpleHash(ipoId) % 100 < flag`, feature-flags.ts).
 * At 60% the startup line reads 60 and half the IPOs still fall back.
 *
 * So the per-ROW proof keys on the absence of `fallbackConsolidation`'s own
 * per-call `logger.warn` FOR THIS ipoId. That warn is not silent — it names the
 * ipoId, the flag and the percentage. What is indistinguishable is the RESULT
 * (hadConflict:false, zero conflicts, zero provenance), which is exactly why
 * a proof must read the log line rather than the returned shape.
 */
describe('per-row fallback audit (no database needed)', () => {
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  const AUDIT_IPO = '00000000-0000-4000-8000-00000005b0f0';

  function fakeOrchestrator() {
    const noop = {
      findByIPOId: async () => [],
      findByField: async () => null,
      trackFieldUpdate: async () => undefined,
      findOpenConflicts: async () => [],
      upsertConflict: async () => undefined,
      autoResolveConverged: async () => 0,
    };
    return new DataConsolidationOrchestrator({} as never, noop as never, noop as never, null);
  }

  async function warnsDuringWrite(): Promise<string[]> {
    const { default: logger } = await import('../../../src/utils/logger');
    const spy = vi.spyOn(logger, 'warn').mockImplementation((() => undefined) as never);
    try {
      await fakeOrchestrator().consolidatedUpsertChildRows(
        AUDIT_IPO,
        'financial_statements',
        [{ rowKey: '2024:RESTATED', data: { revenue: '450.00' } }],
        'DRHP'
      );
      return spy.mock.calls
        .map((c) => JSON.stringify(c))
        .filter((c) => c.includes('fallback mode') && c.includes(AUDIT_IPO));
    } finally {
      spy.mockRestore();
    }
  }

  it('emits NO fallback warn for this ipoId when the rollout covers it', async () => {
    f.ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    f.ENABLE_DATA_CONSOLIDATION = true;
    f.ENABLE_SOURCE_TRACKING = true;
    f.CONSOLIDATION_PERCENTAGE = 100;
    expect(await warnsDuringWrite()).toHaveLength(0);
  });

  it('emits a fallback warn naming THIS ipoId when the rollout excludes it', async () => {
    f.ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    f.ENABLE_DATA_CONSOLIDATION = true;
    f.CONSOLIDATION_PERCENTAGE = 0;
    const warns = await warnsDuringWrite();
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('CONSOLIDATION_PERCENTAGE rollout excludes this ipoId');
  });
});

/**
 * Amendment (3): `shouldUseFeature`'s percentage branch needs a truthy ipoId.
 * `''` is a valid `string`, so TypeScript cannot reject it, and before the
 * guard it fell straight out of the function's trailing `return false` —
 * consolidation OFF while the environment reads 100.
 */
describe('shouldUseFeature percentage guard (no database needed)', () => {
  it('THROWS on an empty ipoId rather than reading as 0%', async () => {
    const { shouldUseFeature, FEATURE_FLAGS: FF } = await import('../../../src/config/feature-flags');
    (FF as never as Record<string, unknown>).CONSOLIDATION_PERCENTAGE = 100;
    expect(() => shouldUseFeature('CONSOLIDATION_PERCENTAGE', '')).toThrow(
      /requires a non-empty ipoId/
    );
    expect(() => shouldUseFeature('CONSOLIDATION_PERCENTAGE', undefined)).toThrow(
      /requires a non-empty ipoId/
    );
  });

  it('returns true for a real id at 100% and false at 0%', async () => {
    const { shouldUseFeature, FEATURE_FLAGS: FF } = await import('../../../src/config/feature-flags');
    const ff = FF as never as Record<string, unknown>;
    ff.CONSOLIDATION_PERCENTAGE = 100;
    expect(shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'abc-123')).toBe(true);
    ff.CONSOLIDATION_PERCENTAGE = 0;
    expect(shouldUseFeature('CONSOLIDATION_PERCENTAGE', 'abc-123')).toBe(false);
  });
});
