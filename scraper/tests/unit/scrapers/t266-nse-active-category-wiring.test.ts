import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchCurrentIPOs } from '../../../src/scrapers/nse-api-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'nse');
const raw = (f: string) => readFileSync(join(FIXTURES, f), 'utf-8');

/**
 * T-266 — end-to-end wiring proof for the NSE subscription path.
 *
 * Every HTTP call is served from the REAL payloads captured on 2026-08-22, so
 * this test fails if anyone un-wires `/api/ipo-active-category` and falls back
 * to the current-issue payload: the totals drop from the consolidated
 * (2.74 / 21.66) to the NSE-only figures (1.79 / 13.70), which is a different
 * and materially wrong number to publish.
 */

const jsonResponse = (body: string) =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      getSetCookie: () => ['nsit=abc; Path=/', 'nseappid=def; Path=/', 'bm_sv=ghi; Path=/'],
    },
    json: async () => JSON.parse(body),
    text: async () => body,
  }) as unknown as Response;

const htmlResponse = () =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: () => 'text/html',
      getSetCookie: () => ['nsit=abc; Path=/', 'nseappid=def; Path=/', 'bm_sv=ghi; Path=/'],
    },
    json: async () => ({}),
    text: async () => '<html></html>',
  }) as unknown as Response;

describe('T-266 fetchCurrentIPOs wiring', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        const url = String(input);
        calls.push(url);

        if (url.includes('/api/ipo-active-category')) {
          const symbol = new URL(url).searchParams.get('symbol');
          return jsonResponse(raw(`ipo-active-category-${symbol}.live-2026-08-22.json`));
        }
        if (url.includes('/api/ipo-current-issue')) {
          return jsonResponse(raw('ipo-current-issue.live-2026-08-22.json'));
        }
        // session-priming page visits
        return htmlResponse();
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls /api/ipo-active-category once per active symbol', async () => {
    const promise = fetchCurrentIPOs();
    await vi.runAllTimersAsync();
    await promise;

    const categoryCalls = calls.filter((u) => u.includes('/api/ipo-active-category'));
    expect(categoryCalls).toHaveLength(2);
    expect(categoryCalls.some((u) => u.includes('symbol=AUGMONT'))).toBe(true);
    expect(categoryCalls.some((u) => u.includes('symbol=TEMPSENS'))).toBe(true);
    expect(categoryCalls.every((u) => u.includes('issueType=ipo'))).toBe(true);
  });

  it('publishes the CONSOLIDATED figure, not the NSE-only one', async () => {
    const promise = fetchCurrentIPOs();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.subscriptions).toHaveLength(2);

    const augmont = result.subscriptions.find((s) => s.ipoSymbol === 'AUGMONT')!;
    const tempsens = result.subscriptions.find((s) => s.ipoSymbol === 'TEMPSENS')!;

    expect(augmont.coverage).toBe('CONSOLIDATED');
    expect(tempsens.coverage).toBe('CONSOLIDATED');

    // The whole-market numbers an investor should see.
    expect(augmont.totalSubscription).toBeCloseTo(2.7401544505125, 6);
    expect(tempsens.totalSubscription).toBeCloseTo(21.65620218122292, 6);

    // NOT the NSE-only numbers carried by ipo-current-issue.noOfTime.
    expect(augmont.totalSubscription).not.toBeCloseTo(1.7901764891364034, 4);
    expect(tempsens.totalSubscription).not.toBeCloseTo(13.70394305184009, 4);
  });

  it('falls back to the labelled NSE-only figure when active-category fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes('/api/ipo-active-category')) {
          return { ok: false, status: 500, statusText: 'Server Error', headers: { get: () => null, getSetCookie: () => [] } } as unknown as Response;
        }
        if (url.includes('/api/ipo-current-issue')) {
          return jsonResponse(raw('ipo-current-issue.live-2026-08-22.json'));
        }
        return htmlResponse();
      })
    );

    const promise = fetchCurrentIPOs();
    await vi.runAllTimersAsync();
    const result = await promise;

    const augmont = result.subscriptions.find((s) => s.ipoSymbol === 'AUGMONT')!;
    expect(augmont).toBeDefined();
    // Degraded, but HONEST: labelled EXCHANGE_ONLY so the persister guard will
    // not let it supersede a consolidated snapshot.
    expect(augmont.coverage).toBe('EXCHANGE_ONLY');
    expect(augmont.totalSubscription).toBeCloseTo(1.7901764891364034, 6);
  });
});
