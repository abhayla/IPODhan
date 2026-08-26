import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * T-327F fix round 5 — the TZ-explicit driver.
 *
 * Round 4's version of this file set `process.env.TZ = 'Asia/Kolkata'` inside
 * the vitest worker and then asserted the drifted value
 * '2025-10-05T18:30:00.000Z'. That mutation is a NO-OP: vitest runs each test
 * file on a worker thread, and assigning process.env.TZ off the main thread
 * does not reset V8's date cache. The assertion only ever passed because the
 * dev machine's ambient zone already IS Asia/Kolkata; GitHub's runners are UTC,
 * so CI went red (run 32934980618, backfill-gmp-historical-callsite-tz.test.ts:68).
 *
 * The property under test genuinely needs a non-UTC process timezone (under
 * TZ=UTC the buggy `new Date(cells[0]).toISOString()` shape produces the SAME
 * output as the correct parser, so a UTC-only test cannot catch the
 * regression). The only reliable way to set a process timezone is at SPAWN
 * time — so this driver runs the real assertions
 * (tests/tz-cases/backfill-gmp-historical-callsite.tzcase.test.ts, deliberately
 * outside the tests/unit include glob) in a child vitest process, once per
 * timezone, with TZ in the child's env.
 *
 * Net effect: green in any CI timezone, and still RED if the call site is
 * reverted to the local-TZ shape — because the Asia/Kolkata child proves the
 * drift is real (witness assertion) before asserting the parser defeats it.
 */

const require = createRequire(import.meta.url);
const VITEST_BIN = require.resolve('vitest/vitest.mjs');
const SCRAPER_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const CASE_FILE = 'tests/tz-cases/backfill-gmp-historical-callsite.tzcase.test.ts';

function runCaseUnder(tz: string) {
  return spawnSync(
    process.execPath,
    [
      VITEST_BIN,
      'run',
      '--root',
      SCRAPER_ROOT,
      '--config',
      join(SCRAPER_ROOT, 'vitest.tzcase.config.ts'),
      '--reporter',
      'basic',
      CASE_FILE,
    ],
    {
      cwd: SCRAPER_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, TZ: tz, TZCASE_EXPECT_TZ: tz, CI: 'true' },
    }
  );
}

describe('scrapeChittorgarhGMPHistory call site is TZ-invariant (T-327F item B)', () => {
  // Each case spawns a full vitest run; two of them comfortably exceed the
  // 20s suite default.
  it(
    'passes its TZ-explicit case file under TZ=Asia/Kolkata (where the buggy shape WOULD drift)',
    () => {
      const res = runCaseUnder('Asia/Kolkata');
      expect(
        res.status,
        `child vitest failed under TZ=Asia/Kolkata:\n${res.stdout}\n${res.stderr}`
      ).toBe(0);
    },
    180_000
  );

  it(
    'passes the same case file under TZ=UTC (proving the driver is not zone-locked)',
    () => {
      const res = runCaseUnder('UTC');
      expect(
        res.status,
        `child vitest failed under TZ=UTC:\n${res.stdout}\n${res.stderr}`
      ).toBe(0);
    },
    180_000
  );
});
