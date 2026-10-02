/**
 * PR #1488 review (budget): the walk's ipo-detail read is ONE request per IPO per ask. A 401/403
 * must not start the session-refresh retry loop other NSE reads use; it throws, and the walk
 * answers CHECK_FAILED with that cause.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchNSEIPODetailPayload } from '../../../src/scrapers/nse-api-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchNSEIPODetailPayload: no auth-retry loop (#1486 / PR #1488)', () => {
  it('a 403 on ipo-detail throws after exactly one ipo-detail request', async () => {
    const detailUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/ipo-detail')) {
        detailUrls.push(String(url));
        return new Response('denied', { status: 403, statusText: 'Forbidden' });
      }
      return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'nsit=a; Path=/' } });
    }));
    await expect(fetchNSEIPODetailPayload('RUNWALENTR', 'EQ')).rejects.toThrow(/403/);
    expect(detailUrls).toHaveLength(1);
    expect(detailUrls[0]).toContain('symbol=RUNWALENTR');
  });
});
