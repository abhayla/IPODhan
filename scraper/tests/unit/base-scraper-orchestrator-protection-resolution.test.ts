import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-287F3 — confirmed mechanism: `BaseScraperOrchestrator.processIPO()`
 * gated field-level protection on `existingIPO = findBySlug(slug)` alone.
 * Chittorgarh's raw title for Citius Transnet Investment Trust always
 * carries a trailing parenthetical ("Citius Transnet Investment Trust
 * (Citius Transnet InvIT IPO)") that `generateSlug()`/`generateIPOSlug()`
 * does NOT strip, so this cycle's slug never equals the row's stored slug
 * and `findBySlug` returns null -- skipping the protection block entirely
 * (`if (ipoId) {...}`). The write path moments later
 * (`consolidatedUpsertIPO`/`upsertIPO`) resolves the SAME row via
 * `findByNormalizedName`, which DOES strip the parenthetical and stays
 * stable -- so the write lands on the protected row, unfiltered
 * (confirmed against prod field_sources: source=CHITTORGARH,
 * ipo_id=40affeea-..., updated_at matching the cron cycle timestamp).
 *
 * Fix: Step 2's existingIPO resolution now uses the SAME two-step lookup
 * as the write path (normalized-name first, slug fallback), so protection
 * is anchored to the row identity the write actually targets. This test
 * proves protection still applies when findBySlug misses but
 * findByNormalizedName resolves the existing row.
 *
 * Mocking follows the established pattern in
 * `base-scraper-orchestrator-expected-rejection.test.ts`.
 */

const mockFindBySlug = vi.fn();
const mockFindByNormalizedName = vi.fn();
const mockIsIPOLocked = vi.fn();
const mockFilterProtectedFields = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@ipodhan/shared', async (importOriginal) => {
  // T-307: keep the REAL resolveIpoRow (the single source of truth for
  // "which row is this?") rather than re-implementing its tier logic in
  // this mock — a hand-copied mock of resolveIpoRow would be exactly the
  // class of divergence this task closes.
  const actual = await importOriginal<typeof import('@ipodhan/shared')>();
  return {
    ...actual,
    db: {},
    getRedisClient: () => ({}),
    IPORepository: vi.fn().mockImplementation(() => ({
      findBySlug: mockFindBySlug,
      findByNormalizedName: mockFindByNormalizedName,
      // resolveIpoRow's fuzzy tier is only reached when the two tiers above
      // both miss; no test in this file exercises that path.
      findByFuzzyName: vi.fn().mockResolvedValue(null),
      // T-339: consolidation is the only write path now; processIPO() goes
      // through consolidatedUpsertIPO, which lands on ipoRepository.update()
      // for this same existing row. Without this mock the call throws,
      // upsertIPO retries 3x and fails, processIPO's exception propagates to
      // the outer catch in run() -- which never aggregates
      // processResult.fieldsProtected into result.fieldsProtected, masking
      // the exact protection-accounting behavior this test verifies.
      update: mockUpdate,
    })),
    SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
    ScraperLogRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn().mockResolvedValue({}),
      getRecentLogs: vi.fn().mockResolvedValue([]),
    })),
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    createFieldProtectionService: vi.fn().mockReturnValue({
      isIPOLocked: mockIsIPOLocked,
      filterProtectedFields: mockFilterProtectedFields,
      isFieldProtected: vi.fn().mockResolvedValue({ isProtected: false }),
    }),
  };
});

vi.mock('../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateAfterScrape: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn().mockImplementation(() => ({
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    shouldSendAlert: vi.fn().mockResolvedValue({ sendAlert: false, reason: null }),
    getMetrics: vi.fn().mockResolvedValue({ success: 0, failure: 0, rate: 100 }),
    getConsecutiveFailures: vi.fn().mockResolvedValue(0),
    markAlertSent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/alerting-service.js', () => ({
  AlertingService: vi.fn().mockImplementation(() => ({
    getRecentErrors: vi.fn().mockReturnValue([]),
    sendAlert: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: vi.fn().mockResolvedValue({
      ipoId: 'citius-canonical-id',
      isNew: false,
      skipped: false,
      locked: false,
    }),
  })),
}));

vi.mock('../../src/services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

vi.mock('../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({
      coldStart: true,
      degraded: false,
      reasons: [],
    }),
  };
});

describe('BaseScraperOrchestrator.processIPO() — protection resolution matches the write path (T-287F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies field protection when findBySlug misses but findByNormalizedName resolves the existing row', async () => {
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      {
        companyName: 'Citius Transnet Investment Trust (Citius Transnet InvIT IPO)',
        offeringType: 'INVITS',
        segment: 'MAINBOARD',
      },
    ];

    class TestOrchestrator extends BaseScraperOrchestrator<any> {
      protected getScraperName() {
        return 'CHITTORGARH' as const;
      }
      protected async scrapeData() {
        return { ipos: rawIPOs, subscriptions: [] };
      }
      protected validateIPO(ipo: any) {
        return { success: true as const, data: ipo };
      }
    }

    // findBySlug misses -- this cycle's raw title produces a slug that
    // never matches the row's stored slug ("citius-transnet-investment-trust").
    mockFindBySlug.mockResolvedValue(null);
    // findByNormalizedName resolves the SAME row every cycle (the
    // parenthetical is stripped before normalization).
    mockFindByNormalizedName.mockResolvedValue({
      id: 'citius-canonical-id',
      companyName: 'Citius Transnet Investment Trust',
    });
    mockIsIPOLocked.mockResolvedValue(false);
    // segment is protected -- filtered out of the write.
    mockFilterProtectedFields.mockResolvedValue({
      filtered: { companyName: rawIPOs[0].companyName, offeringType: 'INVITS' },
    });
    mockUpdate.mockResolvedValue({ id: 'citius-canonical-id' });

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    // The bug: with a slug-only lookup, findBySlug()=null means ipoId is
    // undefined and the whole protection block (isIPOLocked +
    // filterProtectedFields) is skipped. The fix must call it.
    expect(mockFindByNormalizedName).toHaveBeenCalled();
    expect(mockIsIPOLocked).toHaveBeenCalledWith('citius-canonical-id');
    expect(mockFilterProtectedFields).toHaveBeenCalledWith(
      'citius-canonical-id',
      'ipos',
      expect.objectContaining({ companyName: rawIPOs[0].companyName }),
      'CHITTORGARH'
    );
    expect(result.fieldsProtected).toBeGreaterThan(0);
  }, 20000);
});
