import { describe, it, expect, vi, afterEach } from 'vitest';

// Same module-graph stubs as backfill-gmp-historical-date-parse.test.ts: the
// script imports DB/Redis/repository modules that need a live shared-package
// build to resolve, none of which this test exercises.
vi.mock('@ipodhan/shared/db/schema', () => ({}));
vi.mock('@ipodhan/shared/db', () => ({ db: {} }));
vi.mock('@ipodhan/shared/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@ipodhan/shared/repositories', () => ({
  GMPRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { scrapeChittorgarhGMPHistory } from '../../../src/scripts/backfill-gmp-historical.js';

/**
 * T-327F fix round 4, item B (checker T-327C2).
 *
 * The first sweep-miss test only called the extracted helper
 * parseGmpHistoryDateCell(), so reverting the CALL SITE in
 * scrapeChittorgarhGMPHistory() back to the local-TZ shape
 * new Date(cells[0]).toISOString() left the suite green — the regression the
 * ticket exists to prevent was undetected.
 *
 * This test drives the real consuming function with a fetch stub returning a
 * Chittorgarh-shaped GMP-history table, under a fixed non-UTC process TZ
 * (Asia/Kolkata). A date-only cell parsed with bare new Date() lands at LOCAL
 * midnight, so reading it back as ISO yields the PREVIOUS day at 18:30Z; the
 * shared TZ-invariant parser yields UTC midnight of the same day. The
 * assertion below therefore goes RED on that revert, in any CI timezone.
 */
const GMP_HISTORY_HTML = `
<html><body>
<table class="gmp-history">
  <tr><td>Date</td><td>GMP</td><td>GMP %</td><td>Est. Listing</td></tr>
  <tr><td>06-Oct-2025</td><td>120</td><td>15.5</td><td>920</td><td>800</td><td>500</td></tr>
  <tr><td>31-Dec-2025</td><td>90</td><td>11.0</td><td>890</td><td>700</td><td>400</td></tr>
</table>
</body></html>`;

function stubFetchOk(html: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => html,
  });
}

const originalTZ = process.env.TZ;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.TZ = originalTZ;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('scrapeChittorgarhGMPHistory call site is TZ-invariant (T-327F item B)', () => {
  it('emits UTC-midnight instants for date-only cells under TZ=Asia/Kolkata', async () => {
    process.env.TZ = 'Asia/Kolkata';
    globalThis.fetch = stubFetchOk(GMP_HISTORY_HTML) as unknown as typeof fetch;

    // Sanity: this process really is in a +05:30 zone, so the bare-new-Date
    // form WOULD shift. Without this the assertion below could pass vacuously
    // in a UTC CI runner.
    expect(new Date('06-Oct-2025').toISOString()).toBe('2025-10-05T18:30:00.000Z');

    const rows = await scrapeChittorgarhGMPHistory('Example Ltd', 'example-ltd');

    expect(rows.map((r) => r.date)).toEqual([
      '2025-10-06T00:00:00.000Z',
      '2025-12-31T00:00:00.000Z',
    ]);
  });

  it('produces the same instants under TZ=UTC and TZ=America/Los_Angeles', async () => {
    const seen: string[][] = [];
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      globalThis.fetch = stubFetchOk(GMP_HISTORY_HTML) as unknown as typeof fetch;
      const rows = await scrapeChittorgarhGMPHistory('Example Ltd', 'example-ltd');
      seen.push(rows.map((r) => r.date));
    }
    expect(seen[0]).toEqual(['2025-10-06T00:00:00.000Z', '2025-12-31T00:00:00.000Z']);
    expect(seen[1]).toEqual(seen[0]);
  });

  it('skips a row whose date cell is unparseable instead of guessing', async () => {
    process.env.TZ = 'Asia/Kolkata';
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
