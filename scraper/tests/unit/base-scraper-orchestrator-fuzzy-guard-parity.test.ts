import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FEATURE_FLAGS } from '../../src/config/feature-flags.js';

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
const mockCreate = vi.fn();

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
      create: mockCreate,
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

// Stub the consolidation-math internals (field-source lookups, conflict
// tracking) so the ENABLE_DATA_CONSOLIDATION=true case below can drive the
// REAL DataConsolidationOrchestrator.consolidatedUpsertIPO (unmocked -- see
// below) without needing a live field-sources/data-conflicts repository.
// This isolates the test on what T-307C2 actually flagged: whether the
// Step-2-resolved row is threaded into the consolidation call site (:449),
// not whether field-level consolidation math is correct (that is covered
// elsewhere -- data-consolidation-service tests).
const mockConsolidateIPOData = vi.fn();
vi.mock('../../src/services/data-consolidation-service.js', () => ({
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: mockConsolidateIPOData,
  })),
}));

describe('BaseScraperOrchestrator.processIPO() — guard/write parity on the fuzzy (typo) tier (T-307, §1.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() wipes call history but leaves any UNCONSUMED
    // mockResolvedValueOnce() queued from the previous test in place --
    // mockReset() drops that queue so no test's leftover once-value can
    // leak into whichever test runs next, regardless of ordering.
    mockFindBySlug.mockReset();
    mockFindByNormalizedName.mockReset();
    mockFindByFuzzyName.mockReset();
  });

  afterEach(() => {
    // Belt-and-braces: no test in this file is allowed to leak the
    // consolidation flag into a sibling test.
    FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION = false;
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

  it('threads the guard-resolved row down to the write instead of re-resolving (T-307C Finding 1) -- write targets the FIRST resolution, not a second independent one', async () => {
    // T-307C (independent checker) found that the DoD's second test called
    // resolveIpoRow() twice, directly, with the same mock -- true by
    // construction for any pure function, and it stayed green even after
    // the checker removed the `preResolvedIPO` threading from all 3 call
    // sites in BaseScraperOrchestrator.ts (mutant 2: the guard and the write
    // resolve independently again -- exactly the B7 failure mode Phase 1
    // exists to prevent). This test drives the REAL production wiring
    // (processIPO() -> upsertIPO()) and proves the threading is load-bearing:
    // findByFuzzyName is mocked to resolve the canonical row on its FIRST
    // call (the guard's Step 2 resolution) and to miss (return null) on any
    // SECOND call -- simulating another writer altering the row between the
    // guard's resolve and the write, which the pre-resolved-row threading
    // exists to make impossible to observe.
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      {
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

    mockFindBySlug.mockResolvedValue(null);
    mockFindByNormalizedName.mockResolvedValue(null);
    mockFindByFuzzyName
      .mockResolvedValueOnce({ id: 'hybrid-canonical-id', companyName: 'Hybrid Seeds Limited' })
      .mockResolvedValueOnce(null);
    // Not locked -- the write is allowed to proceed, so it can actually land
    // and reveal which row (or none) it targeted.
    mockIsIPOLocked.mockResolvedValue(false);
    mockFilterProtectedFields.mockResolvedValue({
      filtered: { companyName: rawIPOs[0].companyName, offeringType: 'SME' },
    });
    mockUpdate.mockResolvedValue({ id: 'hybrid-canonical-id' });
    mockCreate.mockResolvedValue({ id: 'wrongly-created-duplicate-id' });

    const orchestrator = new TestOrchestrator();
    await orchestrator.run();

    // Threading intact: the write path's `preResolvedIPO !== undefined`
    // check short-circuits its own resolveIpoRow call, so findByFuzzyName is
    // called exactly ONCE (the guard's Step 2 resolution) and the write is
    // an UPDATE targeting that SAME row -- never a second, independently
    // (and here, differently) resolved one.
    expect(mockFindByFuzzyName).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith('hybrid-canonical-id', expect.anything());
    // If the threading regresses (mutant 2), upsertIPO re-resolves
    // independently, findByFuzzyName's SECOND call returns null, existingIPO
    // is null, and the write silently becomes a CREATE of a duplicate row
    // instead of an update of the row the guard just cleared.
    expect(mockCreate).not.toHaveBeenCalled();
  }, 20000);

  it('threads the guard-resolved row into consolidatedUpsertIPO when ENABLE_DATA_CONSOLIDATION=true (T-307C2 Finding 1) -- the branch that actually runs in production', async () => {
    // T-307C2 (independent checker, round 2) found that the test above only
    // ever exercises call site :499 (legacy upsertIPO fallback) because it
    // forces ENABLE_DATA_CONSOLIDATION=false. Production runs with that flag
    // TRUE (docs/04-data-flow/PHASE-2-POST-DEPLOYMENT-STATUS.md), so the
    // branch that actually executes is :449 -> consolidationOrchestrator
    // .consolidatedUpsertIPO() -> its OWN threading check at
    // data-consolidation-orchestrator.ts ("preResolvedIPO !== undefined ?
    // preResolvedIPO : await resolveIpoRow(...)"). That check was completely
    // uncovered -- the checker proved it by stripping existingIPO from the
    // :449 call site alone and watching the full 1140-test suite stay green
    // (mutant 2a). This test drives the REAL production wiring
    // (processIPO() -> the ENABLE_DATA_CONSOLIDATION branch ->
    // consolidatedUpsertIPO(), itself unmocked -- only its internal
    // DataConsolidationService dependency is stubbed, see the module mock
    // above) with the REAL resolveIpoRow, and the same
    // once-then-null findByFuzzyName trick as the legacy-path test: if the
    // pre-resolved row is not threaded through, consolidatedUpsertIPO
    // re-resolves independently, the second findByFuzzyName call misses, and
    // the write silently becomes a CREATE of a duplicate row instead of an
    // UPDATE of the row the guard already cleared.
    FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION = true;

    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      {
        companyName: 'Hybird Seeds Limited',
        offeringType: 'SME',
        segment: 'SME',
        issueSize: 100,
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

    mockFindBySlug.mockResolvedValue(null);
    mockFindByNormalizedName.mockResolvedValue(null);
    mockFindByFuzzyName
      .mockResolvedValueOnce({ id: 'hybrid-canonical-id', companyName: 'Hybrid Seeds Limited' })
      .mockResolvedValueOnce(null);
    mockIsIPOLocked.mockResolvedValue(false);
    mockFilterProtectedFields.mockResolvedValue({
      filtered: { companyName: rawIPOs[0].companyName, offeringType: 'SME', issueSize: 100 },
    });
    mockUpdate.mockResolvedValue({ id: 'hybrid-canonical-id' });
    mockCreate.mockResolvedValue({ id: 'wrongly-created-duplicate-id' });
    mockConsolidateIPOData.mockResolvedValue({
      ipoId: 'hybrid-canonical-id',
      fieldsProcessed: 0,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [],
      consolidatedData: {},
      errors: [],
      performanceMs: 1,
    });

    const orchestrator = new TestOrchestrator();
    await orchestrator.run();

    // consolidatedUpsertIPO received the guard-resolved row -- its own
    // resolveIpoRow call never fired a second time.
    expect(mockFindByFuzzyName).toHaveBeenCalledTimes(1);
    // The write UPDATES the guard-cleared row...
    expect(mockUpdate).toHaveBeenCalledWith('hybrid-canonical-id', expect.anything());
    // ...and never CREATEs a duplicate.
    expect(mockCreate).not.toHaveBeenCalled();
  }, 20000);
});
