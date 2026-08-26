import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T-340 regression test: proves the one-shot production path
 * (`scraper/src/index.ts --source=all`) writes ONE `scraper_steps` row per
 * STEP_NAMES entry, every cycle, with a status that reflects what actually
 * happened -- 'ok' / 'skipped' (with a reason) / 'failed' (with a reason) --
 * and that every row shares the same cycleId. Pre-fix, every post-scrape
 * step was a silent non-fatal try/catch with no persisted trace at all.
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
const runBSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({ ...baseScraperResult, rateLimitUsed: 0, rateLimitRemaining: 100, triggerReason: 'manual' });
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({ success: true, gmpsProcessed: 0, gmpsCreated: 0, gmpsSkipped: 0, gmpsFailed: 0, errors: [] as string[] });
const updateListingPerformanceMock = vi.fn().mockResolvedValue({ totalListedIPOs: 0, existingRecords: 0, newRecordsCreated: 0, recordsUpdated: 0, failures: 0, duration: 1, timestamp: new Date(0).toISOString() });
// Deliberately false: proves a SKIPPED step gets a reason, not silence.
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(false);
const runRegistrarHealthCheckMock = vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] });
const shouldRunRegistrarHealthCheckMock = vi.fn().mockReturnValue(false);
const reresolveRegistrarIdsMock = vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] });
// Deliberately throws: proves a FAILED step gets its error message as the reason.
const runDuplicateSweepJobMock = vi.fn().mockRejectedValue(new Error('duplicate sweep boom'));
const runStageReconcilerJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} });
const runPrimaryDocBackfillMock = vi.fn().mockResolvedValue(undefined);
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(true);
const dbReturningMock = vi.fn().mockResolvedValue([]);
const insertValuesMock = vi.fn().mockResolvedValue(undefined);
const insertMock = vi.fn().mockReturnValue({ values: insertValuesMock });
const evaluateFreshnessMock = vi.fn().mockResolvedValue([]);
const checkCrossSourceDisagreementsMock = vi.fn().mockResolvedValue({ openIpoCount: 0, disagreements: [], highValueCount: 0, otherCount: 0 });
const heartbeatMock = vi.fn();
const flushOwnerNotifyMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({ runNSEScraper: runNSEScraperMock }));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({ runBSEScraper: runBSEScraperMock }));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({ runMoneycontrolScraper: runMoneycontrolScraperMock }));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({ runChittorgarhScraper: runChittorgarhScraperMock }));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({ runIPOAlertsFallback: runIPOAlertsFallbackMock }));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({ runInvestorgainGMPScraper: runInvestorgainGMPScraperMock }));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({ updateListingPerformance: updateListingPerformanceMock }));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({ shouldRunListingPerformanceUpdate: shouldRunListingPerformanceUpdateMock }));
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({ runRegistrarHealthCheck: runRegistrarHealthCheckMock }));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({ shouldRunRegistrarHealthCheck: shouldRunRegistrarHealthCheckMock }));
vi.mock('../../src/services/registrar-reresolve.js', () => ({ reresolveRegistrarIds: reresolveRegistrarIdsMock }));
vi.mock('../../src/scheduler/jobs/duplicate-sweep-job.js', () => ({ runDuplicateSweepJob: runDuplicateSweepJobMock }));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({ runStageReconcilerJob: runStageReconcilerJobMock }));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({ runPrimaryDocBackfill: runPrimaryDocBackfillMock }));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({ shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock }));
vi.mock('../../src/services/freshness-monitor.js', () => ({ evaluateFreshness: evaluateFreshnessMock }));
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: vi.fn().mockResolvedValue([]),
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({ checkCrossSourceDisagreements: checkCrossSourceDisagreementsMock }));
vi.mock('../../src/services/keyless-coverage-monitor.js', () => ({
  getKeylessCoverage: vi.fn().mockResolvedValue({ totalCount: 0, keylessCount: 0, keylessPct: 0 }),
}));
vi.mock('../../src/services/owner-notify.js', () => ({ heartbeat: heartbeatMock, flushOwnerNotify: flushOwnerNotifyMock }));
vi.mock('@ipodhan/shared/repositories', () => ({
  DataConflictsRepository: vi.fn().mockImplementation(() => ({ pruneResolved: vi.fn().mockResolvedValue(0) })),
}));
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({ where: () => ({ returning: dbReturningMock }) }),
    insert: insertMock,
  },
  getRedisClient: () => ({}),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: { __table: 'scraper_steps' },
}));
vi.mock('drizzle-orm', () => ({ lt: vi.fn() }));

describe('scraper/src/index.ts one-shot --source=all path (T-340 step ledger)', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(true);
    shouldRunListingPerformanceUpdateMock.mockReturnValue(false);
    shouldRunRegistrarHealthCheckMock.mockReturnValue(false);
    insertMock.mockReturnValue({ values: insertValuesMock });
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    process.env.ADMIN_API_TOKEN = 'test-admin-token';
    delete process.env.ENABLE_STAGE_RECONCILER;
    delete process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
  });

  it('writes exactly one scraper_steps row per STEP_NAMES entry, all sharing one cycleId', async () => {
    const { main, STEP_NAMES } = await import('../../src/index.js');

    await main();

    expect(insertValuesMock).toHaveBeenCalledTimes(STEP_NAMES.length);
    const rows = insertValuesMock.mock.calls.map((c) => c[0]);
    const steps = rows.map((r) => r.step).sort();
    expect(steps).toEqual([...STEP_NAMES].sort());

    const cycleIds = new Set(rows.map((r) => r.cycleId));
    expect(cycleIds.size).toBe(1);

    for (const row of rows) {
      expect(typeof row.durationMs).toBe('number');
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
      expect(['ok', 'skipped', 'failed']).toContain(row.status);
    }
  });

  it('records status=skipped WITH a reason for a step whose cadence guard says no', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    const rows = insertValuesMock.mock.calls.map((c) => c[0]);
    const listingRow = rows.find((r) => r.step === 'listingPerformanceUpdate');
    expect(listingRow).toMatchObject({ status: 'skipped' });
    expect(listingRow.reason).toBeTruthy();
  });

  it('records status=failed WITH the error message for a step that throws', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    const rows = insertValuesMock.mock.calls.map((c) => c[0]);
    const dupRow = rows.find((r) => r.step === 'duplicateSweep');
    expect(dupRow).toMatchObject({ status: 'failed' });
    expect(dupRow.reason).toContain('duplicate sweep boom');
  });

  it('records status=ok for a step that completes normally', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    const rows = insertValuesMock.mock.calls.map((c) => c[0]);
    const heartbeatRow = rows.find((r) => r.step === 'heartbeat');
    expect(heartbeatRow).toMatchObject({ status: 'ok' });
  });

  it('a ledger-write failure (DB down) never fails the cycle', async () => {
    insertValuesMock.mockRejectedValue(new Error('DB unreachable'));
    const { main } = await import('../../src/index.js');

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
