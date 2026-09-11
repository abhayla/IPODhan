/**
 * `ENABLE_FILING_AUTO_PERSIST` must read its default through
 * `slotAwareFlagDefault`, so the staging slot defaults ON and production
 * defaults OFF by construction.
 *
 * What this file pins, and why each row is load-bearing:
 *
 * - Staging, var unset -> ON. The auto-persist path is exercised on a slot
 *   whose cycle logs and database can be READ, rather than being reachable
 *   only by hand-editing the env file on a live server.
 * - Prod / unknown slot, var unset -> OFF. Production must never acquire a
 *   path that lets a scrape rewrite published data by default, and an
 *   unrecognised slot resolves to the same safe answer.
 * - An EXPLICIT value wins over the slot default in BOTH directions. That
 *   explicit path IS the owner's §GATE: writing the var into the prod env
 *   file is the one deliberate way this can ever be on in production, and
 *   writing `false` on staging is how an operator isolates a regression. A
 *   test asserting "prod stays false even when the var is explicitly true"
 *   would delete the owner's only switch, so the matrix asserts the opposite
 *   on purpose — do not "fix" it later.
 * - Explicitly EMPTY is not a choice. `FLAG=${SOMEVAR}` that never expanded
 *   warns and fails closed to `false`, never to the staging default.
 *
 * This file makes no claim about what any deployed slot is currently running,
 * or about what downstream writers have or have not done; it pins the
 * resolution contract only.
 *
 * Loads the REAL feature-flags module fresh per case (no mocking), so this is
 * the identical code path production evaluates at import time.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const FLAG = 'ENABLE_FILING_AUTO_PERSIST';

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

describe('ENABLE_FILING_AUTO_PERSIST is slot-aware', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('DEPLOY_SLOT=staging with the flag unset -> true (the point of this change: the extractor actually runs)', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'staging', [FLAG]: undefined });
    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(true);
  });

  it('DEPLOY_SLOT=prod with the flag unset -> false (production must never acquire this by default)', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'prod', [FLAG]: undefined });
    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(false);
  });

  it('DEPLOY_SLOT unset entirely with the flag unset -> false (fail-closed when the slot is unknown)', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: undefined, [FLAG]: undefined });
    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(false);
  });

  it("DEPLOY_SLOT=prod with the var explicitly 'true' -> true (the owner's §GATE path must still work)", async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'prod', [FLAG]: 'true' });
    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(true);
  });

  it("DEPLOY_SLOT=staging with the var explicitly 'false' -> false (an operator can isolate a regression on staging)", async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'staging', [FLAG]: 'false' });
    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(false);
  });

  it('DEPLOY_SLOT=staging with the var explicitly EMPTY -> false AND a warning (an unexpanded deploy-template variable is a bug, not a choice)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { FEATURE_FLAGS } = await loadWithEnv({ DEPLOY_SLOT: 'staging', [FLAG]: '' });

    expect(FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST).toBe(false);
    const warned = warnSpy.mock.calls.map(([m]) => String(m)).filter((m) => m.includes(FLAG));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('explicitly set but empty');
    warnSpy.mockRestore();
  });
});
