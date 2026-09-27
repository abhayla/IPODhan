import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * T-403 WP B wiring test. Proves, in the ONLY process PM2 runs
 * (`scraper/src/index.ts --source=all`), that:
 *
 *  1. `ENABLE_DOCUMENT_STATE_MACHINE` SELECTS between the two document
 *     implementations behind the single `primarySourceDiscovery` step — the new
 *     per-cycle state machine when on, the old daily backfill when off. Getting
 *     this wrong would run BOTH, or neither, with no visible symptom.
 *  2. The new step reports its counts into the ledger `reason`, so a cycle that
 *     did nothing is distinguishable from a cycle that found nothing.
 *  3. `documentPurge` is gated on the same flag and never fails the cycle.
 *
 * Mock preamble mirrors index-deploy-drift-monitor-wiring.test.ts.
 */

const baseScraperResult = {
  success: true,
  iposProcessed: 0,
  iposInserted: 0,
  iposUpdated: 0,
  iposFailed: 0,
  iposSkipped: 0,
  subscriptionsCreated: 0,
  subscriptionsSkipped: 0,
  fieldsProtected: 0,
  errors: [] as string[],
};

const runNSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runBSEScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  iposMerged: 0,
  smeCount: 0,
  mainboardCount: 0,
});
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  rateLimitUsed: 0,
  rateLimitRemaining: 100,
  triggerReason: 'manual',
});
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({
  success: true,
  gmpsProcessed: 0,
  gmpsCreated: 0,
  gmpsSkipped: 0,
  gmpsFailed: 0,
  errors: [] as string[],
});
const updateListingPerformanceMock = vi.fn().mockResolvedValue({
  totalListedIPOs: 0,
  existingRecords: 0,
  newRecordsCreated: 0,
  recordsUpdated: 0,
  failures: 0,
  duration: 1,
  timestamp: new Date(0).toISOString(),
});
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(false);
const runRegistrarHealthCheckMock = vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] });
const shouldRunRegistrarHealthCheckMock = vi.fn().mockReturnValue(false);
const reresolveRegistrarIdsMock = vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] });
const runDuplicateSweepJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, clusters: 0, dupClusters: [] as unknown[], applied: false });
const runStageReconcilerJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} });
const runPrimaryDocBackfillMock = vi.fn().mockResolvedValue(undefined);
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(true);
const checkDeployDriftMock = vi.fn().mockResolvedValue([]);
const dbReturningMock = vi.fn().mockResolvedValue([]);

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({
  runNSEScraper: runNSEScraperMock,
}));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({
  runBSEScraper: runBSEScraperMock,
}));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({
  runMoneycontrolScraper: runMoneycontrolScraperMock,
}));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({
  runChittorgarhScraper: runChittorgarhScraperMock,
}));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({
  runIPOAlertsFallback: runIPOAlertsFallbackMock,
}));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({
  runInvestorgainGMPScraper: runInvestorgainGMPScraperMock,
}));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({
  updateListingPerformance: updateListingPerformanceMock,
}));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({
  shouldRunListingPerformanceUpdate: shouldRunListingPerformanceUpdateMock,
}));
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({
  runRegistrarHealthCheck: runRegistrarHealthCheckMock,
}));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({
  shouldRunRegistrarHealthCheck: shouldRunRegistrarHealthCheckMock,
}));
vi.mock('../../src/services/registrar-reresolve.js', () => ({
  reresolveRegistrarIds: reresolveRegistrarIdsMock,
}));
vi.mock('../../src/scheduler/jobs/duplicate-sweep-job.js', () => ({
  runDuplicateSweepJob: runDuplicateSweepJobMock,
}));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: runStageReconcilerJobMock,
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: runPrimaryDocBackfillMock,
  // Item 7 S2 (LOW finding): the real implementation, not a stub — races the
  // real promise against a real timeout so the read-timeout test below can
  // prove a hang degrades to fail-open within its bound instead of hanging.
  withTimeout: async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  },
}));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock,
}));
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: checkDeployDriftMock,
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
}));
const evaluateFreshnessMock = vi.fn().mockResolvedValue([]);
const checkCrossSourceDisagreementsMock = vi.fn().mockResolvedValue({
  openIpoCount: 0,
  disagreements: [],
  highValueCount: 0,
  otherCount: 0,
});

vi.mock('../../src/services/freshness-monitor.js', () => ({
  evaluateFreshness: evaluateFreshnessMock,
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({
  checkCrossSourceDisagreements: checkCrossSourceDisagreementsMock,
}));
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: dbReturningMock,
      }),
    }),
  },
  getRedisClient: () => ({}),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: {},
  ipoStatusEnum: ipoStatusEnumMock,
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));


const runDocumentCycleMock = vi.fn().mockResolvedValue({
  ipos: 4, skipped: 2, found: 3, notYetFiled: 1, blocked: 0, networkCalls: 5, extractionBlocked: 0, extractionFailed: 0,
  durationMs: 1234, budgetExhausted: false,
  // Item 7 S2: a "healthy" mocked cycle finished every pass — every test
  // below that wants a stopped-early cycle overrides these explicitly.
  slotComplete: true, incompletePasses: [] as string[],
});
const runDocumentPurgeMock = vi.fn().mockResolvedValue({
  candidates: 2, purged: 1, filesDeleted: 3, bytesFreed: 4096,
});
vi.mock('../../src/services/document-cycle.js', async (importOriginal) => {
  // formatCycleReason is PURE and is the thing under test on the ledger line —
  // mocking it would make the assertion vacuous, so the real one is kept.
  const actual = await importOriginal<typeof import('../../src/services/document-cycle.js')>();
  return {
    ...actual,
    runDocumentCycle: runDocumentCycleMock,
    runDocumentPurge: runDocumentPurgeMock,
  };
});

describe('T-403 — document state machine wiring in the one-shot cycle', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY = 'true';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('runs the STATE MACHINE and not the old backfill when the flag is on', async () => {
    process.env.ENABLE_DOCUMENT_STATE_MACHINE = 'true';
    const { triggerPrimarySourceDiscovery } = await import('../../src/index.js');

    const result = await triggerPrimarySourceDiscovery();

    expect(runDocumentCycleMock).toHaveBeenCalledTimes(1);
    expect(runPrimaryDocBackfillMock).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    // The ledger reason carries the counts, so a cycle that did nothing is
    // distinguishable from a cycle that found nothing.
    expect(result.reason).toBe('ipos=4 skipped=2 found=3 not_yet=1 blocked=0 calls=5 extraction_blocked=0 extraction_failed=0');
  });

  it('runs the OLD backfill and not the state machine when the flag is off', async () => {
    delete process.env.ENABLE_DOCUMENT_STATE_MACHINE;
    const { triggerPrimarySourceDiscovery } = await import('../../src/index.js');

    const result = await triggerPrimarySourceDiscovery();

    expect(runPrimaryDocBackfillMock).toHaveBeenCalledTimes(1);
    expect(runDocumentCycleMock).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });

  it('skips both when ENABLE_PRIMARY_SOURCE_DISCOVERY is off, even with the new flag on', async () => {
    process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY = 'false';
    process.env.ENABLE_DOCUMENT_STATE_MACHINE = 'true';
    const { triggerPrimarySourceDiscovery } = await import('../../src/index.js');

    const result = await triggerPrimarySourceDiscovery();

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('ENABLE_PRIMARY_SOURCE_DISCOVERY');
    expect(runDocumentCycleMock).not.toHaveBeenCalled();
    expect(runPrimaryDocBackfillMock).not.toHaveBeenCalled();
  });

  it('documentPurge is gated on the same flag and reports what it deleted', async () => {
    process.env.ENABLE_DOCUMENT_STATE_MACHINE = 'true';
    const { triggerDocumentPurge } = await import('../../src/index.js');

    const result = await triggerDocumentPurge();

    expect(runDocumentPurgeMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.reason).toBe('candidates=2 purged=1 files=3 bytes=4096');
  });

  it('documentPurge is a documented SKIP, not a silent no-op, when the flag is off', async () => {
    delete process.env.ENABLE_DOCUMENT_STATE_MACHINE;
    const { triggerDocumentPurge } = await import('../../src/index.js');

    const result = await triggerDocumentPurge();

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('ENABLE_DOCUMENT_STATE_MACHINE');
    expect(runDocumentPurgeMock).not.toHaveBeenCalled();
  });

  it('a purge failure NEVER fails the cycle beyond its own step', async () => {
    process.env.ENABLE_DOCUMENT_STATE_MACHINE = 'true';
    runDocumentPurgeMock.mockRejectedValueOnce(new Error('disk gone'));
    const { triggerDocumentPurge } = await import('../../src/index.js');

    const result = await triggerDocumentPurge();

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('disk gone');
  });

  it('documentPurge is in STEP_NAMES, right after primarySourceDiscovery', async () => {
    const { STEP_NAMES } = await import('../../src/index.js');
    const i = STEP_NAMES.indexOf('primarySourceDiscovery');
    expect(STEP_NAMES[i + 1]).toBe('documentPurge');
  });
});

/**
 * Item 7 S2 (spec §2.1, OD-19): under the due-step scheduler, document
 * download + extraction + the pull walk (runDocumentCycle) are the DATA JOB
 * and run only in the 00:00 / 08:00 / 14:00 IST slots — not on every wake.
 * The real triggerPrimarySourceDiscovery and the real slot function run here;
 * only the cycle body and Redis are stand-ins.
 */
describe('item 7 S2 — the document cycle runs only when the data job is due', () => {
  const OLD_ENV = { ...process.env };
  const ist = (d: string, hh: number, mm: number) =>
    new Date(Date.parse(`${d}T00:00:00.000Z`) + (hh * 60 + mm - 330) * 60_000);

  function fakeRedis(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY = 'true';
    process.env.ENABLE_DOCUMENT_STATE_MACHINE = 'true';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('a 10:30 wake after the 08:00 slot finished runs NO document cycle', async () => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 8, 0).toISOString() });

    const result = await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 10, 30), dueStepScheduler: true, redis });

    expect(runDocumentCycleMock).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('data job not due');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('the 08:00 wake runs the document cycle and stamps the slot finished', async () => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 0, 0).toISOString() });
    const now = ist('2026-09-23', 8, 0);

    const result = await triggerPrimarySourceDiscovery({ now, dueStepScheduler: true, redis });

    expect(runDocumentCycleMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(redis.store.get(DOCUMENT_CYCLE_LAST_RUN_KEY)).toBe(now.toISOString());
  });

  it('a slot whose cycle ran out of wake budget stays open, and the next wake continues it', async () => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 0, 0).toISOString() });
    runDocumentCycleMock.mockResolvedValueOnce({
      ipos: 9, skipped: 0, found: 0, notYetFiled: 0, blocked: 0, networkCalls: 9, extractionBlocked: 0, extractionFailed: 0,
      durationMs: 1, budgetExhausted: true,
      slotComplete: false, incompletePasses: ['discovery'],
    });

    await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 8, 0), dueStepScheduler: true, redis });
    expect(redis.set).not.toHaveBeenCalled();

    await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 8, 30), dueStepScheduler: true, redis });
    expect(runDocumentCycleMock).toHaveBeenCalledTimes(2);
    expect(redis.store.get(DOCUMENT_CYCLE_LAST_RUN_KEY)).toBe(ist('2026-09-23', 8, 30).toISOString());

    await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 9, 0), dueStepScheduler: true, redis });
    expect(runDocumentCycleMock).toHaveBeenCalledTimes(2);
  });

  it('a thrown cycle leaves the slot open (never stamped)', async () => {
    const { triggerPrimarySourceDiscovery } = await import('../../src/index.js');
    const redis = fakeRedis();
    runDocumentCycleMock.mockRejectedValueOnce(new Error('db gone'));

    const result = await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 14, 0), dueStepScheduler: true, redis });

    expect(result.status).toBe('failed');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('with the due-step scheduler OFF (the rollback path) the cycle still runs on every wake', async () => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 8, 0).toISOString() });

    await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 10, 30), dueStepScheduler: false, redis });

    expect(runDocumentCycleMock).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
  });

  /**
   * Independent-review HIGH finding: PASS 1 (discovery) finishing inside its
   * own budget (`budgetExhausted: false`) must NOT be read as "the whole
   * cycle finished" when a LATER pass (extraction, field-plan generation,
   * the field-plan walk) stopped early. (F-151: LISTED deferral is no longer
   * a completion condition, so it is not a case here.) Each case below is a class member of "a pass stopped short of the
   * end of the wake budget"; `slotComplete: false` is what `document-cycle.ts`
   * itself computes for each (proven independently by
   * `document-cycle-slot-complete.test.ts`) — this file proves the CALLER
   * (`triggerPrimarySourceDiscovery`) honors that flag rather than
   * `budgetExhausted` alone.
   */
  it.each([
    ['extraction stopped early', ['extraction']],
    ['field-plan generation had no budget', ['field_plan_generation_no_budget']],
    ['field-plan generation exhausted mid-loop', ['field_plan_generation_exhausted']],
    ['the field-plan walk had no budget', ['field_plan_walk_no_budget']],
    ['the field-plan walk exhausted mid-loop', ['field_plan_walk_exhausted']],
  ])('a slot is NOT stamped finished when %s, even though discovery itself did not exhaust its budget', async (_label, incompletePasses) => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 0, 0).toISOString() });
    runDocumentCycleMock.mockResolvedValueOnce({
      ipos: 4, skipped: 0, found: 2, notYetFiled: 0, blocked: 0, networkCalls: 4, extractionBlocked: 0, extractionFailed: 0,
      durationMs: 1, budgetExhausted: false,
      slotComplete: false, incompletePasses,
    });

    const result = await triggerPrimarySourceDiscovery({ now: ist('2026-09-23', 8, 0), dueStepScheduler: true, redis });

    expect(result.status).toBe('ok');
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.get(DOCUMENT_CYCLE_LAST_RUN_KEY)).toBe(ist('2026-09-23', 0, 0).toISOString());
  });

  it('a slot IS stamped finished only when every pass completed (slotComplete true, incompletePasses empty)', async () => {
    const { triggerPrimarySourceDiscovery, DOCUMENT_CYCLE_LAST_RUN_KEY } = await import('../../src/index.js');
    const redis = fakeRedis({ [DOCUMENT_CYCLE_LAST_RUN_KEY]: ist('2026-09-23', 0, 0).toISOString() });
    const now = ist('2026-09-23', 8, 0);
    runDocumentCycleMock.mockResolvedValueOnce({
      ipos: 4, skipped: 0, found: 2, notYetFiled: 0, blocked: 0, networkCalls: 4, extractionBlocked: 0, extractionFailed: 0,
      durationMs: 1, budgetExhausted: false,
      slotComplete: true, incompletePasses: [],
    });

    await triggerPrimarySourceDiscovery({ now, dueStepScheduler: true, redis });

    expect(redis.store.get(DOCUMENT_CYCLE_LAST_RUN_KEY)).toBe(now.toISOString());
  });

  it('LOW finding: a hung Redis last-run read does not block the wake — it fails open within the read timeout', async () => {
    const { triggerPrimarySourceDiscovery } = await import('../../src/index.js');
    const redis = {
      get: vi.fn(() => new Promise<string | null>(() => {})), // never resolves
      set: vi.fn(async (_k: string, _v: string) => 'OK'),
    };

    const result = await triggerPrimarySourceDiscovery({
      now: ist('2026-09-23', 8, 0),
      dueStepScheduler: true,
      redis,
    });

    // Fail-open: treated as due, the cycle ran despite the hung read.
    expect(runDocumentCycleMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
  }, 10_000);
});
