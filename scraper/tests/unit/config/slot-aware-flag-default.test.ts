/**
 * item 01 slice s5a — slotAwareFlagDefault() must default ON for the
 * `staging` DEPLOY_SLOT and OFF everywhere else (prod, unset), and an
 * explicit value on the flag's own env var must always win over the slot
 * default, in either direction.
 *
 * Loads the REAL feature-flags.js module fresh via vi.resetModules() + dynamic
 * import (no mocking) so this exercises the identical code path production runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

describe('slotAwareFlagDefault (item 01 slice s5a)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('DEPLOY_SLOT=staging, flag env unset -> true', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: undefined,
    });

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(true);
  });

  it('DEPLOY_SLOT=prod, flag env unset -> false', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'prod',
      ENABLE_SLOT_AWARE_TEST_FLAG: undefined,
    });

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
  });

  it('DEPLOY_SLOT unset entirely, flag env unset -> false (the case that protects production)', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: undefined,
      ENABLE_SLOT_AWARE_TEST_FLAG: undefined,
    });

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
  });

  it('explicit env value always wins over the slot default, both directions', async () => {
    // env 'true' on prod overrides the OFF slot default
    const prodOverride = await loadWithEnv({
      DEPLOY_SLOT: 'prod',
      ENABLE_SLOT_AWARE_TEST_FLAG: 'true',
    });
    expect(prodOverride.slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(true);

    // env 'false' on staging overrides the ON slot default
    const stagingOverride = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: 'false',
    });
    expect(stagingOverride.slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
  });
});
