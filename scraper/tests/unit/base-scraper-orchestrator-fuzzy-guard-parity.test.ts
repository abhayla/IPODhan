import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-307 (write-path hardening Phase 1) — FAILING-FIRST for the user-visible
 * symptom described in docs/architecture/write-path-hardening.md §1.4:
 *
 * T-293 added a fuzzy (typo) tier to the WRITE path only
 * (data-persister.ts's three-tier lookup: normalized-name -> slug -> fuzzy).
 * `BaseScraperOrchestrator.processIPO()`'s protection guard never got that
 * third tier, so a scraper payload whose company name has a spelling typo
 * (e.g. "Hybird Seeds Limited" for the stored "Hybrid Seeds Limited") is
 * INVISIBLE to the guard's two-tier lookup -- `existingIPO` resolves to
 * null, `ipoId` is undefined, and `isIPOLocked()` is never even called --
 * while the write path's own three-tier lookup (with fuzzy) still resolves
 * the SAME canonical row and updates it. An admin-locked IPO gets silently
 * overwritten by a payload that merely misspells the company name.
 *
 * Fix (this task): both the guard and the write now resolve identity via
 * the single shared `resolveIpoRow` (packages/shared/src/repositories/
 * ipo-identity.ts), so the guard sees exactly what the write will see --
 * including the fuzzy tier -- and the lock is honored.
 *
 * RED on origin/main (pre-T-307): mockUpdate gets called -- the guard misses
 * the locked row (no fuzzy tier) so isIPOLocked() is skipped, and the write
 * path's own independent fuzzy resolution still lands the update.
 * GREEN on this branch: mockUpdate is NEVER called -- the guard's
 * resolveIpoRow finds the same row via the fuzzy tier, isIPOLocked() returns
 * true, and processIPO() skips the entire write.
 */

const mockFindBySlug = vi.fn();
const mockFindByNormalizedName = vi.fn();
const mockFindByFuzzyName = vi.fn();
const mockIsIPOLocked = vi.fn();
const mockFilterProtectedFields = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@ipodhan/shared', async (importOriginal) => {
  // Keep the REAL resolveIpoRow -- a hand-copied mock of its tier logic
  // would be exactly the class of divergence this task closes.
  const actual = await importOriginal<typeof import('@ipodhan/shared')>();
  return {
    ...actual,
    db: {},
    getRedisClient: () => ({}),
    IPORepository: vi.fn().mockImplementation(() => ({
      findBySlug: mockFindBySlug,
      findByNormalizedName: mockFindByNormalizedName,
      findByFuzzyName: mockFindByFuzzyName,
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

// Deliberately NOT mocked: '../../src/services/data-consolidation-orchestrator.js'
// and '../../src/services/data-persister.js' -- this test needs the REAL
// write path (upsertIPO) so its independent fuzzy resolution can actually
// execute and expose the divergence.
vi.mock('../../src/config/feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/feature-flags.js')>();
  return {
    ...actual,
    FEATURE_FLAGS: {
      ...actual.FEATURE_FLAGS,
      ENABLE_DATA_CONSOLIDATION: false, // exercise the legacy upsertIPO fallback directly
    },
  };
});

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

describe('BaseScraperOrchestrator.processIPO() — guard/write parity on the fuzzy (typo) tier (T-307, §1.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('honors an IPO lock when only the fuzzy tier resolves the row (a typo in the company name) — locked value survives', async () => {
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      {
        // A spelling typo the exact + compact-whitespace tiers (findBySlug,
        // findByNormalizedName) cannot catch -- only a similarity/fuzzy
        // check can. Mirrors the real prod pair from T-293
        // ("Dhanwel Hybird Seeds Limited" vs "Dhanwel Hybrid Seeds Ltd.").
        companyName: 'Hybird Seeds Limited',
        offeringType: 'SME',
        segment: 'SME',
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

    // Exact tiers both miss -- the typo changes the slug AND the normalized
    // key.
    mockFindBySlug.mockResolvedValue(null);
    mockFindByNormalizedName.mockResolvedValue(null);
    // Only the fuzzy (similarity) tier resolves the canonical, LOCKED row.
    mockFindByFuzzyName.mockResolvedValue({
      id: 'hybrid-canonical-id',
      companyName: 'Hybrid Seeds Limited',
    });
    // This row is admin-locked -- the entire write must be skipped once the
    // guard correctly identifies it.
    mockIsIPOLocked.mockImplementation(async (id: string) => id === 'hybrid-canonical-id');
    mockFilterProtectedFields.mockResolvedValue({
      filtered: { companyName: rawIPOs[0].companyName, offeringType: 'SME' },
    });
    mockUpdate.mockResolvedValue({ id: 'hybrid-canonical-id' });

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    // The guard must have resolved the SAME row the write would have hit
    // (via the fuzzy tier) and asked about its lock status.
    expect(mockFindByFuzzyName).toHaveBeenCalled();
    expect(mockIsIPOLocked).toHaveBeenCalledWith('hybrid-canonical-id');

    // The locked value survives: the write is never even attempted.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.iposSkipped).toBeGreaterThan(0);
  }, 20000);

  it('guard-side and write-side resolution agree on the same row id for a typo shape (unit-level, no divergent copies)', async () => {
    const { resolveIpoRow } = await import('@ipodhan/shared');

    mockFindBySlug.mockResolvedValue(null);
    mockFindByNormalizedName.mockResolvedValue(null);
    mockFindByFuzzyName.mockResolvedValue({ id: 'hybrid-canonical-id', companyName: 'Hybrid Seeds Limited' });

    const identity = {
      companyName: 'Hybird Seeds Limited',
      normalizedName: 'hybird seeds limited',
      slug: 'hybird-seeds-limited',
    };
    const fakeRepo = {
      findBySlug: mockFindBySlug,
      findByNormalizedName: mockFindByNormalizedName,
      findByFuzzyName: mockFindByFuzzyName,
    } as any;

    // The guard and the write each call resolveIpoRow independently in
    // production (guard at Step 2, write only when no pre-resolved row was
    // threaded through) -- but because both now go through the SAME
    // function with the SAME tiers, they can never return a different row
    // for the identical identity.
    const guardResolved = await resolveIpoRow(fakeRepo, identity);
    const writeResolved = await resolveIpoRow(fakeRepo, identity);

    expect(guardResolved?.id).toBe('hybrid-canonical-id');
    expect(writeResolved?.id).toBe('hybrid-canonical-id');
    expect(guardResolved?.id).toBe(writeResolved?.id);
  });
});
