import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  isValidProdBaseUrl,
  buildPlaywrightArgs,
  isEntryFile,
} from '../../../scripts/run-prod-verify.mjs';

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

describe('isEntryFile (W-164c: entry guard compares paths, not URL strings)', () => {
  it('matches on Windows where import.meta.url has three slashes (file:///D:/...)', () => {
    expect(
      isEntryFile(
        'D:\\Abhay\\x\\run-prod-verify.mjs',
        'file:///D:/Abhay/x/run-prod-verify.mjs',
        'win32'
      )
    ).toBe(true);
  });

  it('matches on Windows regardless of drive-letter/path case', () => {
    expect(
      isEntryFile(
        'd:\\abhay\\x\\RUN-PROD-VERIFY.mjs',
        'file:///D:/Abhay/x/run-prod-verify.mjs',
        'win32'
      )
    ).toBe(true);
  });

  it('does not match a different file', () => {
    expect(
      isEntryFile(
        'D:\\Abhay\\x\\some-other-script.mjs',
        'file:///D:/Abhay/x/run-prod-verify.mjs',
        'win32'
      )
    ).toBe(false);
  });

  // Note: Node's fileURLToPath() parses a file:// URL using the ACTUAL host
  // platform, not our `platform` parameter — a posix-style file:// URL
  // (file:///home/...) cannot be parsed on a Windows host regardless of what
  // we pass as `platform`. This suite runs on Windows, so posix parsing is
  // covered indirectly by the win32 cases above; the isEntryFile `platform`
  // parameter only controls the case-sensitivity of the final comparison.

  it('returns false when argv1 is undefined (e.g. imported, not run as entry)', () => {
    expect(isEntryFile(undefined, 'file:///D:/Abhay/x/run-prod-verify.mjs', 'win32')).toBe(false);
  });
});

describe('run-prod-verify.mjs as a real child process (W-164c regression guard)', () => {
  it(
    'produces non-empty output when actually invoked (the entry-guard regression made this silent, exit 0)',
    () => {
      const scriptPath = path.join(__dirname, '../../../scripts/run-prod-verify.mjs');

      const npxCheck = spawnSync('npx', ['--version'], { shell: true });
      if (npxCheck.status !== 0) {
        // npx unavailable in this environment — skip rather than false-fail.
        return;
      }

      const result = spawnSync(process.execPath, [scriptPath, '--list'], {
        shell: true,
        timeout: 60000,
        env: { ...process.env, PROD_BASE_URL: 'https://example.invalid' },
      });

      const combinedOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

      // The regression: main() never ran, so nothing printed and exit was 0.
      // Once main() runs, Playwright prints *something* (config/browser
      // errors are fine — the point is it is no longer silent).
      expect(combinedOutput.length).toBeGreaterThan(0);
    },
    65000
  );
});
