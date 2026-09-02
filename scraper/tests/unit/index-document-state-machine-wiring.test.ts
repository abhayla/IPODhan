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
  ipos: 4, skipped: 2, found: 3, notYetFiled: 1, blocked: 0, networkCalls: 5,
  durationMs: 1234, budgetExhausted: false,
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
    expect(result.reason).toBe('ipos=4 skipped=2 found=3 not_yet=1 blocked=0 calls=5');
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
