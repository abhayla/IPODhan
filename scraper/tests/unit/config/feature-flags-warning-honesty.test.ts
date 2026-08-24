/**
 * T-309 (T-305 round-6 P3) — validateFeatureFlags() must not warn about a
 * percentage gate that is never actually consulted.
 *
 * Root cause: SOURCE_TRACKING_PERCENTAGE / CONFLICT_DETECTION_PERCENTAGE are
 * NEVER read by shouldUseFeature() at any real call site — ENABLE_SOURCE_TRACKING
 * and ENABLE_CONFLICT_DETECTION gate `data-consolidation-service.ts` and
 * `data-persister.ts` as plain booleans. Prod ships with the ENABLE_* flags
 * true and the *_PERCENTAGE vars unset (=> 0), so the old warning fired every
 * cycle (~40x, 695KB/run) even though field_sources/data_conflicts were
 * genuinely being written. DATA_CONSOLIDATION's percentage IS a real gate
 * (shouldUseFeature('CONSOLIDATION_PERCENTAGE', ...) in
 * data-consolidation-service.ts) so that warning must still fire.
 *
 * Loads the REAL feature-flags.js module fresh via vi.resetModules() + dynamic
 * import (no mocking) so this exercises the identical code path production runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

describe('validateFeatureFlags — SOURCE_TRACKING / CONFLICT_DETECTION percentage warnings (T-309)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
  });

  it('does NOT warn when SOURCE_TRACKING is enabled with percentage unset (the real prod shape)', async () => {
    const { validateFeatureFlags } = await loadWithEnv({
      ENABLE_SOURCE_TRACKING: 'true',
      SOURCE_TRACKING_PERCENTAGE: '',
      ENABLE_CONFLICT_DETECTION: 'false',
      ENABLE_DATA_CONSOLIDATION: 'false',
    });

    validateFeatureFlags();

    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('SOURCE_TRACKING enabled but percentage'))).toBe(false);
  });

  it('does NOT warn when CONFLICT_DETECTION is enabled with percentage unset', async () => {
    const { validateFeatureFlags } = await loadWithEnv({
      ENABLE_SOURCE_TRACKING: 'true',
      ENABLE_CONFLICT_DETECTION: 'true',
      CONFLICT_DETECTION_PERCENTAGE: '',
      ENABLE_DATA_CONSOLIDATION: 'false',
    });

    validateFeatureFlags();

    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('CONFLICT_DETECTION enabled but percentage'))).toBe(false);
  });

  it('STILL warns when DATA_CONSOLIDATION is enabled with CONSOLIDATION_PERCENTAGE unset (the real gate)', async () => {
    const { validateFeatureFlags } = await loadWithEnv({
      ENABLE_DATA_CONSOLIDATION: 'true',
      CONSOLIDATION_PERCENTAGE: '',
      ENABLE_SOURCE_TRACKING: 'true', // avoid the unrelated T-278 P3-5 warning
    });

    validateFeatureFlags();

    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('DATA_CONSOLIDATION enabled but percentage is 0%'))).toBe(true);
  });
});
