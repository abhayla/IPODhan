import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
