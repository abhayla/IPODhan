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

  it.each(['0', 'FALSE', 'false', 'False', 'no', 'off', 'OFF'])(
    "explicit falsy spelling '%s' on staging means false, not the ON slot default, and emits NO warning",
    async (value) => {
      const { slotAwareFlagDefault } = await loadWithEnv({
        DEPLOY_SLOT: 'staging',
        ENABLE_SLOT_AWARE_TEST_FLAG: value,
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    }
  );

  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'On'])(
    "explicit truthy spelling '%s' on prod means true, not the OFF slot default, and emits NO warning",
    async (value) => {
      const { slotAwareFlagDefault } = await loadWithEnv({
        DEPLOY_SLOT: 'prod',
        ENABLE_SLOT_AWARE_TEST_FLAG: value,
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    }
  );

  it('explicit empty string on staging is treated as unrecognised — false, not the ON slot default, and it warns', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: '',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('ENABLE_SLOT_AWARE_TEST_FLAG');

    warnSpy.mockRestore();
  });

  it('explicit whitespace-only value on staging behaves identically to explicit empty — false, and it warns', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: '   ',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('DEPLOY_SLOT=staging, flag env genuinely unset (undefined) still falls through to the slot default (true) — the distinction from empty', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: undefined,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('unrecognised value on staging logs the flag+raw value and resolves to false — NEVER the ON slot default', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'staging',
      ENABLE_SLOT_AWARE_TEST_FLAG: 'maybe',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('ENABLE_SLOT_AWARE_TEST_FLAG');
    expect(message).toContain('maybe');

    warnSpy.mockRestore();
  });

  it('unrecognised value on prod also logs and resolves to false (both directions covered)', async () => {
    const { slotAwareFlagDefault } = await loadWithEnv({
      DEPLOY_SLOT: 'prod',
      ENABLE_SLOT_AWARE_TEST_FLAG: 'maybe',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(slotAwareFlagDefault('ENABLE_SLOT_AWARE_TEST_FLAG')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
