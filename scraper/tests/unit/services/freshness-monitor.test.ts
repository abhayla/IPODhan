/**
 * T-195: freshness-monitor.ts tests.
 *
 * These tests fail against the pre-fix `health-check.ts` stub (which
 * hardcoded `lastScrapedAt=null` / `timeSinceLastScrape=0`, so ITS
 * threshold logic could never fire) because that stub never called a real
 * repository. `evaluateFreshness` is the T-195 replacement: it wires real
 * per-source `getLastSuccess` timestamps (the SAME source
 * `/api/admin/scraper/status` already reads) against the SLO config in
 * `freshness-slo.ts`, so a genuinely-stale source now produces a real
 * breach + a real P1 notifyOwner call, and a fresh source does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateFreshness } from '../../../src/services/freshness-monitor.js';
import { FRESHNESS_SLOS } from '../../../src/config/freshness-slo.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
  process.env.NOTIFIER_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  delete process.env.NOTIFIER_URL;
  delete process.env.NOTIFIER_KEY;
});

function makeRepo(lastSuccessBySource: Record<string, { createdAt: Date } | null>) {
  return {
    getLastSuccess: vi.fn(async (source: string) =>
      Object.prototype.hasOwnProperty.call(lastSuccessBySource, source)
        ? lastSuccessBySource[source]
        : null
    ),
  };
}

describe('evaluateFreshness', () => {
  it('does NOT alert (and marks coldStart) when a source has never logged a success', async () => {
    const repo = makeRepo({}); // every source returns null
    const now = new Date('2026-08-18T12:00:00Z');

    const results = await evaluateFreshness(repo, now);

    expect(results).toHaveLength(FRESHNESS_SLOS.length);
    for (const r of results) {
      expect(r.coldStart).toBe(true);
      expect(r.breached).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not breach when the last success is well within the SLO', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const lastSuccessBySource: Record<string, { createdAt: Date }> = {};
    for (const slo of FRESHNESS_SLOS) {
      lastSuccessBySource[slo.source] = { createdAt: new Date(now.getTime() - 5 * 60 * 1000) }; // 5 min ago
    }
    const repo = makeRepo(lastSuccessBySource);

    const results = await evaluateFreshness(repo, now);

    expect(results.every((r) => !r.breached)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('breaches and fires a P1 notifyOwner call for a source stale beyond its SLO', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const gmpSlo = FRESHNESS_SLOS.find((s) => s.source === 'INVESTORGAIN_GMP')!;
    const lastSuccessBySource: Record<string, { createdAt: Date } | null> = {};
    for (const slo of FRESHNESS_SLOS) {
      lastSuccessBySource[slo.source] =
        slo.source === 'INVESTORGAIN_GMP'
          ? { createdAt: new Date(now.getTime() - (gmpSlo.maxStalenessMs + 60_000)) } // just past SLO
          : { createdAt: new Date(now.getTime() - 5 * 60 * 1000) };
    }
    const repo = makeRepo(lastSuccessBySource);

    const results = await evaluateFreshness(repo, now);

    const gmpResult = results.find((r) => r.source === 'INVESTORGAIN_GMP')!;
    expect(gmpResult.breached).toBe(true);
    expect(gmpResult.coldStart).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3300/notify');
    const body = JSON.parse(init.body);
    expect(body.severity).toBe('P1');
    expect(body.title).toContain('INVESTORGAIN_GMP');
    expect(body.dedupeKey).toContain('freshness:INVESTORGAIN_GMP:');
  });

  it('does not crash when the repository read throws (non-fatal)', async () => {
    const repo = {
      getLastSuccess: vi.fn().mockRejectedValue(new Error('DB unreachable')),
    };

    const results = await evaluateFreshness(repo, new Date());

    expect(results).toHaveLength(FRESHNESS_SLOS.length);
    expect(results.every((r) => !r.breached)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('evaluates every source declared in freshness-slo.ts', async () => {
    const repo = makeRepo({});
    const results = await evaluateFreshness(repo, new Date());
    const evaluatedSources = results.map((r) => r.source).sort();
    const expectedSources = FRESHNESS_SLOS.map((s) => s.source).sort();
    expect(evaluatedSources).toEqual(expectedSources);
  });
});
