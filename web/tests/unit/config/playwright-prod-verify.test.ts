import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isValidProdBaseUrl, buildPlaywrightArgs } from '../../../scripts/run-prod-verify.mjs';

// W-164: guards the exact bug that let `npm run test:prod-verify` boot a
// local `next dev` server on the laptop while targeting prod
// (https://ipodhan.com). The config MUST NOT start a local webServer when
// PROD_BASE_URL points at a remote host, and MUST keep today's local-dev
// behavior when it is unset.

const ORIGINAL_ENV = { ...process.env };

async function loadConfig() {
  vi.resetModules();
  const mod = await import('../../../playwright.config');
  return mod.default;
}

describe('playwright.config.ts prod-verify gating', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it(
    'does NOT start a local webServer when PROD_BASE_URL is a remote host',
    async () => {
      process.env.PROD_BASE_URL = 'https://ipodhan.com';
      const config = await loadConfig();

      expect(config.webServer).toBeUndefined();
    },
    20000 // cold import of @playwright/test's config module is slow
  );

  it('keeps the local dev webServer when PROD_BASE_URL is unset', async () => {
    delete process.env.PROD_BASE_URL;
    const config = await loadConfig();

    expect(config.webServer).toBeDefined();
    expect((config.webServer as { command: string }).command).toBe('npm run dev');
  });
});

describe('run-prod-verify.mjs (round 2: arg forwarding + URL validation)', () => {
  it('forwards extra CLI args after the fixed playwright args', () => {
    const args = buildPlaywrightArgs(['--grep', 'compare']);

    expect(args).toEqual([
      'playwright',
      'test',
      'production-verification',
      '--project=chromium',
      '--grep',
      'compare',
    ]);
  });

  it('forwards no extra args when none are given', () => {
    expect(buildPlaywrightArgs([])).toEqual([
      'playwright',
      'test',
      'production-verification',
      '--project=chromium',
    ]);
  });

  it('accepts http(s) URLs as valid PROD_BASE_URL', () => {
    expect(isValidProdBaseUrl('https://ipodhan.com')).toBe(true);
    expect(isValidProdBaseUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects a PROD_BASE_URL that is not http(s)', () => {
    expect(isValidProdBaseUrl('ipodhan.com')).toBe(false);
    expect(isValidProdBaseUrl('ftp://ipodhan.com')).toBe(false);
    expect(isValidProdBaseUrl('')).toBe(false);
  });
});
