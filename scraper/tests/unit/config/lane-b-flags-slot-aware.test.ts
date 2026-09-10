/**
 * Item 22 slice s0d — the flags THIS run introduced must read their default
 * through `slotAwareFlagDefault`, not `process.env.X === 'true'`.
 *
 * Why this exists, and why it is not tidying:
 *
 * `slotAwareFlagDefault` landed on main in #476 (item 01 slice s5a) with ZERO
 * production call sites. Every flag added by this run still read `=== 'true'`,
 * which means every one of them was OFF on staging. The staging proof owed for
 * #468 is "read the cycle line and watch the rotation counter move" — with the
 * flag off that counter CANNOT move, so the proof would have come back empty
 * and read as "the fix does nothing". A measurement whose result is fixed
 * before it runs is not a measurement.
 *
 * Decision 28's "never convert" protects flags that existed BEFORE this run
 * began, which may carry a production env value of unknown spelling. These
 * three have never been deployed anywhere, so they are exactly what the helper
 * was written for.
 *
 * Loads the REAL feature-flags module fresh per case (no mocking), so this is
 * the identical code path production evaluates at import time.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

/** Every flag this run introduced. Adding a flag without adding it here is the defect. */
const LANE_B_FLAGS = [
  'ENABLE_UPCOMING_DISCOVERY_RESERVATION',
  'ENABLE_RESOLVED_ADDRESS_REFUSAL',
] as const;

/**
 * Deliberately NOT converted yet, with the reason pinned so a later reader does
 * not "finish the job" and reintroduce the problem.
 */
const DEFERRED_FLAGS = [
  {
    flag: 'ENABLE_DOWNLOAD_STREAMING_CAP',
    reason:
      'slot-aware means ON in staging, but an over-cap refusal currently returns status 0 — the same shape a timeout returns, by explicit design in defaultFetcher. Switching it on before that refusal is distinguishable would make every over-size refusal read as a timeout, which is the D17 gap item 22 exists to close.',
  },
] as const;

describe.each(LANE_B_FLAGS)('%s reads its default slot-aware', (flag) => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('DEPLOY_SLOT=staging with the flag unset -> ON, so a staging proof can actually observe it', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'staging', [flag]: undefined });
    expect(FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]).toBe(true);
  });

  it('DEPLOY_SLOT=prod with the flag unset -> OFF', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'prod', [flag]: undefined });
    expect(FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]).toBe(false);
  });

  it('DEPLOY_SLOT unset entirely -> OFF (the case that protects production)', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: undefined, [flag]: undefined });
    expect(FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]).toBe(false);
  });

  it('an explicit env value wins over the slot default, in BOTH directions', async () => {
    const off = await loadWithEnv({ DEPLOY_SLOT: 'staging', [flag]: 'false' });
    expect(off.FEATURE_FLAGS[flag as keyof typeof off.FEATURE_FLAGS]).toBe(false);

    const on = await loadWithEnv({ DEPLOY_SLOT: 'prod', [flag]: 'true' });
    expect(on.FEATURE_FLAGS[flag as keyof typeof on.FEATURE_FLAGS]).toBe(true);
  });
});

describe('a deferred flag stays deferred, on purpose and with its reason', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it.each(DEFERRED_FLAGS)('$flag is still OFF on staging until its refusal is distinguishable', async ({ flag }) => {
    // This asserts the ABSENCE of a change. Without it, converting this flag
    // looks like tidying up an oversight rather than removing a guard.
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'staging', [flag]: undefined });
    expect(FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]).toBe(false);
  });
});

describe('no lane B flag is left reading `=== true` directly', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('every flag in the list is slot-aware, proved by behaviour rather than by grep', async () => {
    // A grep for `slotAwareFlagDefault(` would pass on a flag that calls it and
    // then throws the answer away. This asserts the OBSERVABLE difference: on
    // staging with nothing set, a `=== 'true'` flag is false and a slot-aware
    // flag is true.
    const { FEATURE_FLAGS } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ...Object.fromEntries(LANE_B_FLAGS.map((f) => [f, undefined])),
    });
    const notSlotAware = LANE_B_FLAGS.filter(
      (f) => FEATURE_FLAGS[f as keyof typeof FEATURE_FLAGS] !== true
    );
    expect(notSlotAware).toEqual([]);
  });
});
