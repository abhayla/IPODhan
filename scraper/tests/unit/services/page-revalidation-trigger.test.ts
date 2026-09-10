/**
 * Item 21 slice 3 — the call that connects the two halves already on main.
 *
 * Slice 1 records which IPOs a cycle actually wrote to. Slice 2 built the
 * endpoint that clears their caches and rebuilds their pages. Until this slice
 * neither one does anything: the tracker fills a Set nobody drains, and the
 * endpoint waits for a caller that does not exist. Two merged, tested, green
 * halves adding up to zero — the exact shape item 20's wiring gate exists for,
 * which is why this test asserts the CALL and not the function.
 *
 * The rules that matter, each with a reason:
 *
 *  - ONE call per cycle, never one per IPO. Forty corrected IPOs is one refresh
 *    of the calendar page, not forty.
 *  - It DRAINS. A cycle that leaves the set full would send the same slugs again
 *    next cycle and refresh pages nothing touched.
 *  - An empty cycle sends NOTHING. Most cycles change nothing; posting an empty
 *    list every 30 minutes is a request that can only ever be a no-op.
 *  - Failure is NEVER fatal. The scrape has already written its rows; a page
 *    that will not rebuild waits out its timer, which is today's behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordTouched, drainTouched } from '../../../src/services/touched-ipos-tracker.js';
import { triggerPageRevalidation } from '../../../src/services/page-revalidation-trigger.js';

function fakeFetch(impl?: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (impl) return impl(url, init) as Response;
    return { ok: true, status: 200, json: async () => ({ data: { revalidated: 1 } }) } as Response;
  });
  return { fn, calls };
}

const ENV = { WEB_INTERNAL_URL: 'http://web:3001', ADMIN_API_TOKEN: 'tok' };

describe('triggerPageRevalidation', () => {
  beforeEach(() => { drainTouched(); });

  it('sends the slugs the cycle actually touched', async () => {
    recordTouched('acme-ltd');
    recordTouched('beta-ltd');
    const f = fakeFetch();
    const r = await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect(r.status).toBe('ok');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('http://web:3001/api/admin/revalidate');
    expect(JSON.parse(String(f.calls[0].init.body)).slugs.sort()).toEqual(['acme-ltd', 'beta-ltd']);
  });

  it('sends ONE request, not one per slug', async () => {
    for (const s of ['a-ltd', 'b-ltd', 'c-ltd', 'd-ltd']) recordTouched(s);
    const f = fakeFetch();
    await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect(f.calls).toHaveLength(1);
  });

  it('DRAINS the tracker, so the next cycle starts empty', async () => {
    recordTouched('acme-ltd');
    await triggerPageRevalidation({ env: ENV, fetchImpl: fakeFetch().fn });
    expect(drainTouched()).toEqual([]);
  });

  it('sends NOTHING when the cycle touched nothing', async () => {
    const f = fakeFetch();
    const r = await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect(f.calls).toHaveLength(0);
    expect(r.status).toBe('skipped');
  });

  it('carries the same Bearer auth as its sibling step', async () => {
    recordTouched('acme-ltd');
    const f = fakeFetch();
    await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('skips without a token rather than posting an unauthenticated request', async () => {
    recordTouched('acme-ltd');
    const f = fakeFetch();
    const r = await triggerPageRevalidation({ env: { WEB_INTERNAL_URL: 'http://web:3001' }, fetchImpl: f.fn });
    expect(f.calls).toHaveLength(0);
    expect(r.status).toBe('skipped');
  });

  it('a non-OK response is reported, never thrown', async () => {
    recordTouched('acme-ltd');
    const f = fakeFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
    const r = await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect(r.status).toBe('failed');
    expect(String(r.reason)).toContain('503');
  });

  it('a thrown fetch is caught - the scrape has already written its rows', async () => {
    recordTouched('acme-ltd');
    const f = fakeFetch(() => { throw new Error('web is down'); });
    await expect(triggerPageRevalidation({ env: ENV, fetchImpl: f.fn })).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('drains even when the request fails - a stuck set would resend forever', async () => {
    // The subtle one. If a failed post left the slugs in place, every later
    // cycle would resend them and refresh pages nothing had touched, and the
    // list would only ever grow.
    recordTouched('acme-ltd');
    const f = fakeFetch(() => { throw new Error('web is down'); });
    await triggerPageRevalidation({ env: ENV, fetchImpl: f.fn });
    expect(drainTouched()).toEqual([]);
  });
});

describe('it is actually wired into the cycle', () => {
  it('index.ts runs it as a post-step under source === all', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../../../src/index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // The tracker and the endpoint were both merged and both inert. An import
    // without a runStep call would leave them exactly that.
    expect(src).toMatch(/import\s*\{[^}]*triggerPageRevalidation/);
    expect(src).toMatch(/runStep\([^)]*'pageRevalidation'[^)]*triggerPageRevalidation/);
  });
});
