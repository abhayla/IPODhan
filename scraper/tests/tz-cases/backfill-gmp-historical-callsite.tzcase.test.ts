/**
 * T-327F fix round 5 — TZ-EXPLICIT child case.
 *
 * This file deliberately lives OUTSIDE the `tests/unit/**` include glob in
 * vitest.config.ts, so the normal suite never picks it up. It is executed only
 * by tests/unit/scripts/backfill-gmp-historical-callsite-tz.test.ts, which
 * spawns a fresh vitest process per timezone with `TZ` set in the CHILD's env.
 *
 * WHY a child process: round 4 asserted the drifted value after setting
 * `process.env.TZ = 'Asia/Kolkata'` in-process. Vitest runs test files in
 * worker threads, and a `process.env.TZ` assignment on a worker thread does
 * NOT reset V8's date cache — so the mutation is a silent no-op. The test only
 * ever passed because the dev box's AMBIENT timezone is already Asia/Kolkata;
 * on GitHub's UTC runners it went red (run 32934980618). Setting TZ at spawn
 * time is the only way to make the process timezone actually take effect.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@ipodhan/shared/db/schema', () => ({}));
vi.mock('@ipodhan/shared/db', () => ({ db: {} }));
vi.mock('@ipodhan/shared/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@ipodhan/shared/repositories', () => ({
  GMPRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { scrapeChittorgarhGMPHistory } from '../../src/scripts/backfill-gmp-historical.js';

const GMP_HISTORY_HTML = `
<html><body>
<table class="gmp-history">
  <tr><td>Date</td><td>GMP</td><td>GMP %</td><td>Est. Listing</td></tr>
  <tr><td>06-Oct-2025</td><td>120</td><td>15.5</td><td>920</td><td>800</td><td>500</td></tr>
  <tr><td>31-Dec-2025</td><td>90</td><td>11.0</td><td>890</td><td>700</td><td>400</td></tr>
</table>
</body></html>`;

function stubFetchOk(html: string) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe(`scrapeChittorgarhGMPHistory under TZ=${process.env.TZ ?? '(unset)'}`, () => {
  it('reports the timezone it was actually spawned with', () => {
    // The parent asserts on this file's own env expectation: if TZ did not
    // reach the child, the whole case is meaningless and must fail loudly
    // rather than pass vacuously.
    const expected = process.env.TZCASE_EXPECT_TZ;
    expect(expected, 'TZCASE_EXPECT_TZ must be set by the parent').toBeTruthy();
    // Assert the OFFSET, not the zone NAME: Windows ICU resolves
    // 'Asia/Kolkata' to its 'Asia/Calcutta' alias, so a name comparison is
    // platform-dependent while the offset is exactly the property under test.
    const expectedOffsetMinutes = expected === 'UTC' ? 0 : -330; // IST = UTC+05:30
    expect(new Date('2025-10-06T00:00:00Z').getTimezoneOffset()).toBe(expectedOffsetMinutes);
  });

  it('is the regression witness: a bare new Date(dateOnly) drifts iff the zone is behind/ahead of UTC', () => {
    const bare = new Date('06-Oct-2025').toISOString();
    if (process.env.TZCASE_EXPECT_TZ === 'UTC') {
      expect(bare).toBe('2025-10-06T00:00:00.000Z');
    } else {
      // Asia/Kolkata (+05:30): local midnight is the PREVIOUS day at 18:30Z.
      // This proves the buggy shape really would shift here, so the assertion
      // below is not vacuous.
      expect(bare).toBe('2025-10-05T18:30:00.000Z');
    }
  });

  it('emits UTC-midnight instants for date-only cells regardless of process TZ', async () => {
    globalThis.fetch = stubFetchOk(GMP_HISTORY_HTML) as unknown as typeof fetch;
    const rows = await scrapeChittorgarhGMPHistory('Example Ltd', 'example-ltd');
    expect(rows.map((r) => r.date)).toEqual([
      '2025-10-06T00:00:00.000Z',
      '2025-12-31T00:00:00.000Z',
    ]);
  });

  it('skips a row whose date cell is unparseable instead of guessing', async () => {
    globalThis.fetch = stubFetchOk(`
<table class="gmp-history">
  <tr><td>not a date</td><td>120</td><td>15.5</td><td>920</td></tr>
  <tr><td>06-Oct-2025</td><td>120</td><td>15.5</td><td>920</td></tr>
</table>`) as unknown as typeof fetch;

    const rows = await scrapeChittorgarhGMPHistory('Example Ltd', 'example-ltd');
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2025-10-06T00:00:00.000Z');
  });
});
