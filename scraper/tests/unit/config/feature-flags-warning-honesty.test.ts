/**
 * T-309 -> T-339 — validateFeatureFlags() no longer warns about rollout
 * percentages, because there are none.
 *
 * ORIGINAL DEFECT (T-309, T-305 round-6 P3): the old validator warned when an
 * `ENABLE_*` flag was on while its paired `*_PERCENTAGE` was 0. For
 * SOURCE_TRACKING and CONFLICT_DETECTION that percentage was never consulted by
 * any real call site, so the warning was simply FALSE — it fired ~40x/run
 * (695KB of misleading noise) while `field_sources` / `data_conflicts` were
 * genuinely being written.
 *
 * T-339 removes all six knobs. The validator now has exactly one job: make sure
 * nobody is still trying to switch consolidation off from the environment. This
 * suite locks that behaviour, still loading the REAL `feature-flags.js` fresh
 * via `vi.resetModules()` + dynamic import (no mocking), so it exercises the
 * identical code path production runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const RETIRED = [
  'ENABLE_DATA_CONSOLIDATION',
  'ENABLE_CONFLICT_DETECTION',
  'ENABLE_SOURCE_TRACKING',
  'CONSOLIDATION_PERCENTAGE',
  'SOURCE_TRACKING_PERCENTAGE',
  'CONFLICT_DETECTION_PERCENTAGE',
];

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of RETIRED) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    // dotenv.config() only fills ABSENT keys, so '' means "present but empty",
    // which is how we simulate "unset" without the local scraper/.env
    // repopulating it.
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

describe('validateFeatureFlags — the only remaining job is refusing a disabled consolidation (T-339)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('is silent when no retired key is present — the post-cleanup steady state (no more 695KB of noise)', async () => {
    const flags = await loadWithEnv({});
    expect(() => flags.validateFeatureFlags()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn about SOURCE_TRACKING or CONFLICT_DETECTION percentages — those knobs no longer exist (T-309 regression)', async () => {
    const flags = await loadWithEnv({
      SOURCE_TRACKING_PERCENTAGE: '0',
      CONFLICT_DETECTION_PERCENTAGE: '0',
    });
    // Both are OFF/partial leftovers, so the validator refuses to start —
    // but for the honest reason (someone is rationing consolidation), not the
    // old false "your percentage is 0" nag.
    expect(() => flags.validateFeatureFlags()).toThrow(/consolidation is MANDATORY/i);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns ONCE, naming the keys, when a fully-ON leftover is still deployed (todays prod + staging)', async () => {
    const flags = await loadWithEnv({
      ENABLE_DATA_CONSOLIDATION: 'true',
      ENABLE_CONFLICT_DETECTION: 'true',
      ENABLE_SOURCE_TRACKING: 'true',
      CONSOLIDATION_PERCENTAGE: '100',
    });
    expect(() => flags.validateFeatureFlags()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('ENABLE_DATA_CONSOLIDATION');
    expect(msg).toContain('CONSOLIDATION_PERCENTAGE');
    expect(msg).toMatch(/IGNORED/);
  });

  it('assertConsolidationFlagsNotDisabled returns the cleanup list rather than throwing on fully-ON leftovers', async () => {
    const flags = await loadWithEnv({
      ENABLE_SOURCE_TRACKING: 'true',
      CONSOLIDATION_PERCENTAGE: '100',
    });
    expect(flags.assertConsolidationFlagsNotDisabled()).toEqual([
      'ENABLE_SOURCE_TRACKING',
      'CONSOLIDATION_PERCENTAGE',
    ]);
  });

  it('accepts an explicit env argument so callers can check a slot file without mutating process.env', async () => {
    const flags = await loadWithEnv({});
    expect(() =>
      flags.assertConsolidationFlagsNotDisabled({ ENABLE_DATA_CONSOLIDATION: 'false' })
    ).toThrow(/ENABLE_DATA_CONSOLIDATION=false/);
    expect(
      flags.assertConsolidationFlagsNotDisabled({ ENABLE_DATA_CONSOLIDATION: 'true' })
    ).toEqual(['ENABLE_DATA_CONSOLIDATION']);
  });
});
