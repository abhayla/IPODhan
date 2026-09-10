// implements: R-160
/**
 * Item 22 slice 2 — the `ENABLE_DOWNLOAD_STREAMING_CAP` flag's own unit test.
 *
 * Loads the REAL feature-flags.js module fresh via vi.resetModules() + a
 * dynamic import (no mocking), exercising the identical `=== 'true'` pattern
 * every other boolean flag in this file uses — so this test would fail if
 * the flag were ever wired as `!== 'false'` or any other loosened check.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../../src/config/feature-flags.js');
}

describe('ENABLE_DOWNLOAD_STREAMING_CAP', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('defaults OFF (false) when unset', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ ENABLE_DOWNLOAD_STREAMING_CAP: undefined });
    expect(FEATURE_FLAGS.ENABLE_DOWNLOAD_STREAMING_CAP).toBe(false);
  });

  it('is false for any value other than the literal string "true"', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'True', '']) {
      const { FEATURE_FLAGS } = await loadWithEnv({ ENABLE_DOWNLOAD_STREAMING_CAP: value });
      expect(FEATURE_FLAGS.ENABLE_DOWNLOAD_STREAMING_CAP).toBe(false);
    }
  });

  it('is true only when set to the literal string "true"', async () => {
    const { FEATURE_FLAGS } = await loadWithEnv({ ENABLE_DOWNLOAD_STREAMING_CAP: 'true' });
    expect(FEATURE_FLAGS.ENABLE_DOWNLOAD_STREAMING_CAP).toBe(true);
  });
});
