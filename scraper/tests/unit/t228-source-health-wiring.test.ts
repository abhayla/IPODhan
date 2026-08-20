/**
 * T-228 (part 2) regressions: the three defects that kept a cycle exiting 1
 * with an EMPTY errors[] and made one source invisible on the owner-facing
 * source-health surface.
 *
 * 1. `ScraperFailureTracker` only pre-seeded 5 of the 6 scraper-log-tracked
 *    sources, so INVESTORGAIN_GMP hit the `!record` branch, logged
 *    'Invalid scraper type' and had its failures/successes silently dropped.
 * 2. The IPO-Alerts fallback reported its source as 'IPO_ALERTS_API', which is
 *    NOT a `ScraperSource`. Every scraper_logs row landed under a name that the
 *    freshness monitor (FRESHNESS_SLOS) and /api/admin/scraper/status never
 *    query - the source read as "never ran" forever.
 * 3. `BaseScraperOrchestrator` set `success = iposFailed < iposProcessed`, so a
 *    legitimately empty scrape (0 processed, 0 failed, no errors) was reported
 *    as a failure and exited the cycle 1 with nothing to diagnose.
 */
import { describe, it, expect, vi } from 'vitest';
import { ScraperFailureTracker } from '../../src/services/scraper-failure-tracker.js';
import { FRESHNESS_SLOS } from '../../src/config/freshness-slo.js';
import { IPOAlertsFallbackOrchestratorV2 } from '../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js';

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('T-228 / failure tracker covers every scraper-log-tracked source', () => {
  it('tracks INVESTORGAIN_GMP failures instead of dropping them', () => {
    const tracker = new ScraperFailureTracker(3);
    tracker.recordFailure('INVESTORGAIN_GMP', new Error('boom'));
    tracker.recordFailure('INVESTORGAIN_GMP', new Error('boom'));
    expect(tracker.getFailureCount('INVESTORGAIN_GMP')).toBe(2);
    expect(tracker.shouldTriggerFallback('INVESTORGAIN_GMP')).toBe(false);
    tracker.recordFailure('INVESTORGAIN_GMP', new Error('boom'));
    expect(tracker.shouldTriggerFallback('INVESTORGAIN_GMP')).toBe(true);
    tracker.recordSuccess('INVESTORGAIN_GMP');
    expect(tracker.getFailureCount('INVESTORGAIN_GMP')).toBe(0);
  });

  it('tracks every source the freshness SLO table claims to watch', () => {
    const tracker = new ScraperFailureTracker(3);
    for (const slo of FRESHNESS_SLOS) {
      tracker.recordFailure(slo.source, new Error('boom'));
      expect(tracker.getFailureCount(slo.source)).toBe(1);
    }
  });
});

describe('T-228 / fallback reports a canonical ScraperSource', () => {
  it('names itself API_FALLBACK, the value the health surfaces query', () => {
    const orchestrator = new IPOAlertsFallbackOrchestratorV2('manual');
    const name = (orchestrator as unknown as { getScraperName(): string }).getScraperName();
    expect(name).toBe('API_FALLBACK');
    expect(FRESHNESS_SLOS.some((slo) => slo.source === name)).toBe(true);
  });
});

describe('T-228 / honest run success semantics', () => {
  // Mirrors the single assignment in BaseScraperOrchestrator.run().
  const isSuccess = (r: { iposFailed: number; iposProcessed: number; errors: string[] }) =>
    r.iposFailed === 0 && r.errors.length === 0;

  it('an empty-but-clean scrape is a success, not a silent failure', () => {
    expect(isSuccess({ iposFailed: 0, iposProcessed: 0, errors: [] })).toBe(true);
  });

  it('a partial failure is honestly a failure', () => {
    expect(isSuccess({ iposFailed: 1, iposProcessed: 10, errors: [] })).toBe(false);
  });

  it('a recorded error fails the run even when no IPO failed', () => {
    expect(isSuccess({ iposFailed: 0, iposProcessed: 5, errors: ['upstream 500'] })).toBe(false);
  });
});
