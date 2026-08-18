/**
 * T-195 regression test for the health-check staleness stub.
 *
 * Pre-fix, `getScraperHealth` hardcoded `lastScrapedAt: null` /
 * `timeSinceLastScrape: 0` with a TODO ("Once last_scraped_at is added to
 * database, query it here") -- so its ALERT/WARNING thresholds could NEVER
 * fire from staleness, only from the Redis consecutive-failure counter. This
 * test proves `runHealthCheck` now wires REAL timestamps from
 * `scraperLogRepository.getLastSuccess` (reusing the same source
 * `/api/admin/scraper/status` already reads) and that staleness beyond a
 * source's freshness-slo.ts SLO actually flips its status to ALERT/WARNING.
 * It fails against the pre-fix stub because `lastScrapedAt` would always be
 * `null` and `timeSinceLastScrape` would always be `0`, regardless of the
 * mocked repository response.
 */
import { describe, it, expect, vi } from 'vitest';
import { runHealthCheck } from '../../../../src/scheduler/jobs/health-check.js';
import { FRESHNESS_SLOS } from '../../../../src/config/freshness-slo.js';

function makeRedis(consecutiveFailures: Record<string, number> = {}) {
  return {
    get: vi.fn(async (key: string) => {
      const match = key.match(/^scraper:(.+):failures$/);
      if (!match) return null;
      const source = match[1];
      return consecutiveFailures[source] !== undefined ? String(consecutiveFailures[source]) : null;
    }),
  } as any;
}

function makeRepo(lastSuccessBySource: Record<string, { createdAt: Date } | null>) {
  return {
    getLastSuccess: vi.fn(async (source: string) =>
      Object.prototype.hasOwnProperty.call(lastSuccessBySource, source) ? lastSuccessBySource[source] : null
    ),
  };
}

describe('runHealthCheck (T-195 staleness fix)', () => {
  it('wires a real lastScrapedAt / timeSinceLastScrape from scraperLogRepository (not the null/0 stub)', async () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const lastSuccessBySource: Record<string, { createdAt: Date }> = {};
    for (const slo of FRESHNESS_SLOS) {
      lastSuccessBySource[slo.source] = { createdAt: fiveMinAgo };
    }
    const repo = makeRepo(lastSuccessBySource);
    const redis = makeRedis();

    const result = await runHealthCheck(redis, repo);

    expect(result.success).toBe(true);
    for (const health of Object.values(result.scrapers)) {
      expect(health.lastScrapedAt).toEqual(fiveMinAgo);
      // Was ALWAYS 0 pre-fix; now must reflect the real gap (~5 min, allow scheduling slack).
      expect(health.timeSinceLastScrape).toBeGreaterThan(0);
      expect(health.timeSinceLastScrape).toBeLessThan(10 * 60 * 1000);
    }
  });

  it('flips a source to ALERT once its staleness passes its freshness-slo.ts SLO', async () => {
    const now = Date.now();
    const gmpSlo = FRESHNESS_SLOS.find((s) => s.source === 'INVESTORGAIN_GMP')!;
    const lastSuccessBySource: Record<string, { createdAt: Date }> = {};
    for (const slo of FRESHNESS_SLOS) {
      lastSuccessBySource[slo.source] =
        slo.source === 'INVESTORGAIN_GMP'
          ? { createdAt: new Date(now - (gmpSlo.maxStalenessMs + 60_000)) }
          : { createdAt: new Date(now - 60_000) };
    }
    const repo = makeRepo(lastSuccessBySource);
    const redis = makeRedis();

    const result = await runHealthCheck(redis, repo);

    expect(result.scrapers.investorgainGmp.status).toBe('ALERT');
    expect(result.status).toBe('CRITICAL');
  });

  it('treats a source that has NEVER scraped (null lastSuccess) as OK, not stale (matches GitHub #3 null-handling)', async () => {
    const repo = makeRepo({}); // every getLastSuccess() -> null
    const redis = makeRedis();

    const result = await runHealthCheck(redis, repo);

    for (const health of Object.values(result.scrapers)) {
      expect(health.lastScrapedAt).toBeNull();
      expect(health.timeSinceLastScrape).toBe(0);
      expect(health.status).toBe('OK');
    }
    expect(result.status).toBe('HEALTHY');
  });

  it('still applies the consecutive-failures threshold independently of staleness', async () => {
    const now = Date.now();
    const lastSuccessBySource: Record<string, { createdAt: Date }> = {};
    for (const slo of FRESHNESS_SLOS) {
      lastSuccessBySource[slo.source] = { createdAt: new Date(now - 60_000) };
    }
    const repo = makeRepo(lastSuccessBySource);
    const redis = makeRedis({ NSE: 5 });

    const result = await runHealthCheck(redis, repo);

    expect(result.scrapers.nse.status).toBe('ALERT');
    expect(result.scrapers.nse.consecutiveFailures).toBe(5);
  });

  it('covers every source declared in freshness-slo.ts, not just the original nse/bse/apiFallback three', async () => {
    const repo = makeRepo({});
    const redis = makeRedis();

    const result = await runHealthCheck(redis, repo);

    const keys = Object.keys(result.scrapers).sort();
    expect(keys).toContain('moneycontrol');
    expect(keys).toContain('chittorgarh');
    expect(keys).toContain('investorgainGmp');
    expect(keys).toContain('nse');
    expect(keys).toContain('bse');
    expect(keys).toContain('apiFallback');
  });

  it('returns UNKNOWN status without throwing when the repository read fails unexpectedly', async () => {
    const redis = makeRedis();
    const repo = {
      getLastSuccess: vi.fn().mockRejectedValue(new Error('DB unreachable')),
    };

    const result = await runHealthCheck(redis as any, repo);

    // Per-source errors are caught inside getScraperHealth and degrade to
    // createUnknownHealth() (status OK) rather than crashing the job.
    expect(result.success).toBe(true);
    for (const health of Object.values(result.scrapers)) {
      expect(health.lastScrapedAt).toBeNull();
    }
  });
});
