import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * S-02 §5 (`ENABLE_DUE_STEP_SCHEDULER`): proves the one-shot `--source=all`
 * entrypoint routes through `runDueStepCycle()` (discovery/live/aggregator
 * gating) ONLY when the flag is on, and that with the flag OFF the legacy
 * per-source blocks (NSE/BSE/Moneycontrol/Chittorgarh/GMP unconditionally on
 * every cycle) are exactly what still runs — the rollback path.
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

const runNSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runBSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({ ...baseScraperResult, rateLimitUsed: 0, rateLimitRemaining: 100, triggerReason: 'manual' });
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({ success: true, gmpsProcessed: 0, gmpsCreated: 0, gmpsSkipped: 0, gmpsFailed: 0, errors: [] as string[] });
const runDemandBackfillMock = vi.fn().mockResolvedValue(undefined);
const updateListingPerformanceMock = vi.fn().mockResolvedValue({ totalListedIPOs: 0, existingRecords: 0, newRecordsCreated: 0, recordsUpdated: 0, failures: 0, duration: 1, timestamp: new Date(0).toISOString() });
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(false);
const dbReturningMock = vi.fn().mockResolvedValue([]);
const dbCountRowsMock = vi.fn().mockResolvedValue([{ c: 0 }]);

const isDiscoveryDueMock = vi.fn().mockReturnValue(false);
const isMarketHoursISTMock = vi.fn().mockReturnValue(false);
const mostRecentDiscoverySlotLabelMock = vi.fn().mockReturnValue('08:30 IST');
const mostRecentDiscoverySlotEpochMinuteMock = vi.fn().mockReturnValue(12345);
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(false);
const isCatchUpCadenceDueMock = vi.fn().mockResolvedValue(false);
const markCatchUpCadenceRanMock = vi.fn().mockResolvedValue(undefined);

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(true);
const lockExtendMock = vi.fn().mockResolvedValue(true);

// Issue #943: the per-slot discovery-attempts counter. Defaults to 1 so an
// existing test's single failing wake doesn't accidentally trip the cap.
const redisIncrMock = vi.fn().mockResolvedValue(1);
const redisExpireMock = vi.fn().mockResolvedValue(1);
const sendOwnerAlertMock = vi.fn().mockResolvedValue({ sent: false, reason: 'not configured' });

// Round-4 MEDIUM/LOW: stable mock refs (not a fresh object per `getRedisClient()`
// call) so tests can assert on `redis.set` calls (the discovery cadence stamp)
// across the whole `main()` run.
const redisGetMock = vi.fn().mockResolvedValue(null);
const redisSetMock = vi.fn().mockResolvedValue('OK');

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({ runNSEScraper: runNSEScraperMock }));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({ runBSEScraper: runBSEScraperMock }));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({ runMoneycontrolScraper: runMoneycontrolScraperMock }));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({ runChittorgarhScraper: runChittorgarhScraperMock }));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({ runIPOAlertsFallback: runIPOAlertsFallbackMock }));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({ runInvestorgainGMPScraper: runInvestorgainGMPScraperMock }));
vi.mock('../../src/scripts/backfill-demand-graph.js', () => ({ runDemandBackfill: runDemandBackfillMock }));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({ updateListingPerformance: updateListingPerformanceMock }));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({ shouldRunListingPerformanceUpdate: shouldRunListingPerformanceUpdateMock }));
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({
  runRegistrarHealthCheck: vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] }),
}));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({
  shouldRunRegistrarHealthCheck: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/services/registrar-reresolve.js', () => ({
  reresolveRegistrarIds: vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] }),
}));
vi.mock('../../src/scheduler/jobs/duplicate-sweep-job.js', () => ({
  runDuplicateSweepJob: vi.fn().mockResolvedValue({ totalIpos: 0, clusters: 0, dupClusters: [], applied: false }),
}));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} }),
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock,
  isCatchUpCadenceDue: isCatchUpCadenceDueMock,
  markCatchUpCadenceRan: markCatchUpCadenceRanMock,
}));
vi.mock('../../src/scheduler/due-step-cycle.js', () => ({
  isDiscoveryDue: isDiscoveryDueMock,
  isMarketHoursIST: isMarketHoursISTMock,
  mostRecentDiscoverySlotLabel: mostRecentDiscoverySlotLabelMock,
  mostRecentDiscoverySlotEpochMinute: mostRecentDiscoverySlotEpochMinuteMock,
}));
vi.mock('../../src/services/owner-notify.js', () => ({
  sendOwnerAlert: sendOwnerAlertMock,
  notifyOwner: vi.fn(),
  heartbeat: vi.fn(),
  flushOwnerNotify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: lockAcquireMock,
    release: lockReleaseMock,
    extendLock: lockExtendMock,
  })),
}));
vi.mock('../../src/services/freshness-monitor.js', () => ({ evaluateFreshness: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: vi.fn().mockResolvedValue([]),
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({
  checkCrossSourceDisagreements: vi.fn().mockResolvedValue({ openIpoCount: 0, disagreements: [], highValueCount: 0, otherCount: 0 }),
}));
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({ where: () => ({ returning: dbReturningMock }) }),
    select: () => ({ from: () => ({ where: dbCountRowsMock }) }),
  },
  getRedisClient: () => ({ get: redisGetMock, set: redisSetMock, incr: redisIncrMock, expire: redisExpireMock }),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: {},
  ipos: { status: 'status' },
  ipoStatusEnum: ipoStatusEnumMock,
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
  inArray: vi.fn((col: unknown, values: unknown) => ({ col, values })),
  count: vi.fn(() => 'count()'),
}));

describe('scraper/src/index.ts one-shot --source=all path (due-step scheduler wiring)', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    process.env.ADMIN_API_TOKEN = 'test-admin-token';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'tok-1' });
    isDiscoveryDueMock.mockReturnValue(false);
    isMarketHoursISTMock.mockReturnValue(false);
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(false);
    isCatchUpCadenceDueMock.mockResolvedValue(false);
    markCatchUpCadenceRanMock.mockResolvedValue(undefined);
    lockExtendMock.mockResolvedValue(true);
    dbCountRowsMock.mockResolvedValue([{ c: 0 }]);
    redisGetMock.mockReset().mockResolvedValue(null);
    redisSetMock.mockReset().mockResolvedValue('OK');
    redisIncrMock.mockReset().mockResolvedValue(1);
    redisExpireMock.mockReset().mockResolvedValue(1);
    sendOwnerAlertMock.mockReset().mockResolvedValue({ sent: false, reason: 'not configured' });
    mostRecentDiscoverySlotEpochMinuteMock.mockReset().mockReturnValue(12345);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    vi.resetModules();
  });

  describe('item 16 — --source=moneycontrol is no longer a valid CLI value', () => {
    it('rejects it through the SAME unrecognised-value path as any other bad string', async () => {
      process.argv = [...originalArgv.slice(0, 2), '--source=moneycontrol'];
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
      // and it never reaches the scraper it used to name
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
    });

    it('a genuinely unknown source behaves identically — the rejection is not special-cased', async () => {
      // If 'moneycontrol' were special-cased rather than simply absent from the
      // allow-list, these two would diverge and the retirement would be a
      // branch someone could re-enable by accident.
      process.argv = [...originalArgv.slice(0, 2), '--source=not-a-real-source'];
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('a source that IS still valid is not rejected', async () => {
      // Guards the obvious over-correction: trimming the allow-list must not
      // take a live source out with it.
      process.argv = [...originalArgv.slice(0, 2), '--source=chittorgarh'];
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  describe('flag OFF (default) — legacy path is UNCHANGED', () => {
    it('never touches the due-step lock or runDemandBackfill; runs every source unconditionally', async () => {
      delete process.env.ENABLE_DUE_STEP_SCHEDULER;
      const { main } = await import('../../src/index.js');
      await main();

      expect(lockAcquireMock).not.toHaveBeenCalled();
      expect(runDemandBackfillMock).not.toHaveBeenCalled();
      expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
      expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
      // Item 16: Moneycontrol is retired. The legacy `--source=all` fallback is
      // not how prod runs, but it is still reachable from a local run and must
      // stop reaching Moneycontrol too — otherwise "retired" means "retired on
      // the path we happened to look at".
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).toHaveBeenCalledTimes(1);
      expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
      expect(runIPOAlertsFallbackMock).toHaveBeenCalledTimes(1);
      // Legacy calls carry no restriction argument.
      expect(runNSEScraperMock).toHaveBeenCalledWith();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('flag ON — due-step cycle owns discovery/live/aggregators', () => {
    beforeEach(() => {
      process.env.ENABLE_DUE_STEP_SCHEDULER = 'true';
    });

    it('acquires the cycle lock and releases it on success', async () => {
      // The TTL is IMPORTED from its single definition, never re-typed here.
      // That literal used to live in three files; two were updated when the TTL
      // was raised to the 2-hour ceiling + slack and this one was missed, which
      // turned CI red. Asserting the RELATIONSHIP means the next ceiling change
      // cannot leave a stale copy behind.
      const { main, CYCLE_LOCK_TTL_MS, CYCLE_LOCK_CEILING_MS } = await import('../../src/index.js');
      await main();

      // The invariant, not just the number: the lock must outlive any run the
      // ceiling permits, so the CEILING ends a hung cycle, never a lock expiry.
      expect(CYCLE_LOCK_TTL_MS).toBeGreaterThan(CYCLE_LOCK_CEILING_MS);

      expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', { ttl: CYCLE_LOCK_TTL_MS });
      expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'tok-1');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('exits 0 doing nothing when the lock is already held (previous cycle still running)', async () => {
      lockAcquireMock.mockResolvedValueOnce({ acquired: false });
      const { main } = await import('../../src/index.js');
      await main();

      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('discovery: runs NSE+BSE when due, skips them when not due — never gated by top-level source blocks', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
      expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
      // T-478 (issue #225): the unrestricted discovery step wires includeOFS
      // to ENABLE_NSE_OFS (round 2: default false, unset in this test env) —
      // not the OPEN-only live restriction.
      expect(runNSEScraperMock).toHaveBeenCalledWith({ includeOFS: false });
    });

    it('discovery: NOT due -> NSE/BSE never called', async () => {
      isDiscoveryDueMock.mockReturnValue(false);
      isMarketHoursISTMock.mockReturnValue(false);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runBSEScraperMock).not.toHaveBeenCalled();
    });

    // Item 7 S1 (OD-27/OD-28): the live figures moved to `--job=live` under its
    // own lock (tests/unit/index-live-job-wiring.test.ts). The data cycle must
    // not fetch them too - not even in market hours with IPOs OPEN.
    it('live figures are NOT fetched by the data cycle, even in market hours with OPEN IPOs', async () => {
      isMarketHoursISTMock.mockReturnValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 3 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(runDemandBackfillMock).not.toHaveBeenCalled();
      expect(runNSEScraperMock).not.toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
      expect(runBSEScraperMock).not.toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
    });

    it('aggregators: cadence not due -> Moneycontrol/Chittorgarh never called', async () => {
      isCatchUpCadenceDueMock.mockResolvedValue(false);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    });

    it('aggregators: cadence due but zero UPCOMING/OPEN IPOs -> skipped (zero network calls)', async () => {
      isDiscoveryDueMock.mockReturnValue(true); // item 7 S2b: a data-job slot wake
      isCatchUpCadenceDueMock.mockResolvedValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 0 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    });

    it('aggregators: cadence due + UPCOMING/OPEN IPOs present -> Chittorgarh runs restricted, Moneycontrol NEVER', async () => {
      isDiscoveryDueMock.mockReturnValue(true); // item 7 S2b: a data-job slot wake
      isCatchUpCadenceDueMock.mockResolvedValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 5 }]);
      const { main } = await import('../../src/index.js');
      await main();
      // Item 16: this is the call site that actually fires in production, since
      // prod runs the due-step scheduler. Chittorgarh keeps the aggregator
      // branch; only the Moneycontrol call inside it goes.
      expect(runChittorgarhScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['UPCOMING', 'OPEN'] });
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
    });


    /**
     * Round-3 C3: with the flag ON the legacy per-source blocks are skipped for
     * 'all', and round 1 forgot to re-home the IPO Alerts API fallback — the
     * source never ran at all. It now runs inside the cycle on a 24h cadence.
     */
    it('C3: API fallback runs inside the cycle when its cadence is due, and stamps the key AFTER success', async () => {
      isDiscoveryDueMock.mockReturnValue(true); // item 7 S2b: a data-job slot wake
      isCatchUpCadenceDueMock.mockImplementation(async (_redis: unknown, jobName: string) => jobName === 'due-step-api-fallback');
      const { main } = await import('../../src/index.js');
      await main();

      expect(runIPOAlertsFallbackMock).toHaveBeenCalledTimes(1);
      expect(runIPOAlertsFallbackMock).toHaveBeenCalledWith('scheduled');
      expect(markCatchUpCadenceRanMock).toHaveBeenCalledWith(expect.anything(), 'due-step-api-fallback', 24 * 60, expect.any(Date));
    });

    it('C3: API fallback is skipped when its cadence is not due', async () => {
      isCatchUpCadenceDueMock.mockResolvedValue(false);
      const { main } = await import('../../src/index.js');
      await main();

      expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
    });

    it('C3/M2: a FAILING API fallback does not stamp the cadence key (it retries next cycle)', async () => {
      isDiscoveryDueMock.mockReturnValue(true); // item 7 S2b: a data-job slot wake
      isCatchUpCadenceDueMock.mockImplementation(async (_redis: unknown, jobName: string) => jobName === 'due-step-api-fallback');
      runIPOAlertsFallbackMock.mockRejectedValueOnce(new Error('rate limited'));
      const { main } = await import('../../src/index.js');
      await main();

      expect(markCatchUpCadenceRanMock).not.toHaveBeenCalledWith(expect.anything(), 'due-step-api-fallback', 24 * 60, expect.any(Date));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    /**
     * Round-3 H2: round 1 caught every step failure inside the cycle and
     * returned void, so a cycle in which NSE threw still exited 0.
     */
    it('H2: a throwing source under the flag makes the cycle fail — exit code 1', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      runNSEScraperMock.mockRejectedValueOnce(new Error('NSE returned 503'));
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
      // The other steps still ran — one bad source does not abort the cycle.
      expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
    });

    it('H2: a source that COMPLETES with success:false also fails the cycle', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, errors: ['BSE parse error'], iposMerged: 0, smeCount: 0, mainboardCount: 0 });
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('H2: an all-clean cycle still exits 0', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      const { main } = await import('../../src/index.js');
      await main();

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    /**
     * Round-4 MEDIUM: round 3 stamped `DISCOVERY_LAST_RUN_KEY` unconditionally
     * after the NSE + BSE steps — a thrown NSE at the 17:30 slot still marked
     * discovery "done", so the next `isDiscoveryDue` check stayed silent until
     * 08:30 even though NSE never actually ran.
     */
    it('R4-MEDIUM: NSE throws -> the discovery cadence key is never stamped', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      runNSEScraperMock.mockRejectedValueOnce(new Error('NSE returned 503'));
      const { main } = await import('../../src/index.js');
      await main();

      expect(redisSetMock).not.toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('R4-MEDIUM: NSE + BSE both succeed -> the discovery cadence key is stamped exactly once', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      const { main } = await import('../../src/index.js');
      await main();

      const stampCalls = redisSetMock.mock.calls.filter((call) => call[0] === 'due-step:last-discovery');
      expect(stampCalls).toHaveLength(1);
    });

    /**
     * Issue #943: BSE failing on every wake of the SAME slot must not hold
     * the slot open forever — the third failed attempt closes it anyway,
     * logs an error naming the slot + sources + attempts, and alerts (OD-72).
     */
    describe('issue #943 — per-slot discovery-attempts cap', () => {
      it('attempt 1 and 2 in the same slot: leaves the slot open, no alert, no error log', async () => {
        isDiscoveryDueMock.mockReturnValue(true);
        runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
        redisIncrMock.mockResolvedValueOnce(1);
        const { main: main1 } = await import('../../src/index.js');
        await main1();

        expect(redisSetMock).not.toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
        expect(sendOwnerAlertMock).not.toHaveBeenCalled();

        vi.resetModules();
        runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
        redisIncrMock.mockResolvedValueOnce(2);
        const { main: main2 } = await import('../../src/index.js');
        await main2();

        expect(redisSetMock).not.toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
        expect(sendOwnerAlertMock).not.toHaveBeenCalled();
      });

      it('attempt 3 (MAX_DISCOVERY_ATTEMPTS) in the same slot: stamps the slot closed, logs an error, and alerts', async () => {
        isDiscoveryDueMock.mockReturnValue(true);
        runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
        redisIncrMock.mockResolvedValueOnce(3);
        const { main } = await import('../../src/index.js');
        await main();

        expect(redisSetMock).toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
        expect(sendOwnerAlertMock).toHaveBeenCalledTimes(1);
        const [severity, title, opts] = sendOwnerAlertMock.mock.calls[0];
        expect(severity).toBe('P1');
        expect(title).toMatch(/slot closed/i);
        expect(opts.body).toContain('attempts=3');
      });

      it('success on attempt 1 stamps the slot as today and never touches the attempts counter', async () => {
        isDiscoveryDueMock.mockReturnValue(true);
        const { main } = await import('../../src/index.js');
        await main();

        const stampCalls = redisSetMock.mock.calls.filter((call) => call[0] === 'due-step:last-discovery');
        expect(stampCalls).toHaveLength(1);
        expect(redisIncrMock).not.toHaveBeenCalled();
        expect(sendOwnerAlertMock).not.toHaveBeenCalled();
      });

      it('a new slot resets the count: a fresh slot epoch minute starts INCR at 1 again', async () => {
        isDiscoveryDueMock.mockReturnValue(true);
        mostRecentDiscoverySlotEpochMinuteMock.mockReturnValue(99999);
        runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
        redisIncrMock.mockResolvedValueOnce(1);
        const { main } = await import('../../src/index.js');
        await main();

        expect(redisIncrMock).toHaveBeenCalledWith('due-step:discovery-attempts:99999');
        expect(redisSetMock).not.toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
        expect(sendOwnerAlertMock).not.toHaveBeenCalled();
      });

      it('Redis INCR failing keeps the old retry-next-wake behaviour (no stamp, no alert)', async () => {
        isDiscoveryDueMock.mockReturnValue(true);
        runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, success: false, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
        redisIncrMock.mockRejectedValueOnce(new Error('redis down'));
        const { main } = await import('../../src/index.js');
        await main();

        expect(redisSetMock).not.toHaveBeenCalledWith('due-step:last-discovery', expect.any(String));
        expect(sendOwnerAlertMock).not.toHaveBeenCalled();
      });
    });

    /**
     * Round-3 M1: TTL 55min > PM2's 30min restart meant a killed cycle blocked
     * the next one. TTL is now 25min, extended every 5min by the live cycle,
     * and released on SIGTERM.
     */
    it('M1: the cycle lock is extended every 5 minutes with its own token', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const { main } = await import('../../src/index.js');
      await main();

      const keepAlive = setIntervalSpy.mock.calls.find((call) => call[1] === 5 * 60 * 1000);
      expect(keepAlive).toBeDefined();

      // Fire the interval callback once — it must extend THIS cycle's lock.
      (keepAlive![0] as () => void)();
      await Promise.resolve();
      const { CYCLE_LOCK_TTL_MS: extendTtl } = await import('../../src/index.js');
      expect(lockExtendMock).toHaveBeenCalledWith('scraper:cycle', 'tok-1', extendTtl);
      setIntervalSpy.mockRestore();
    });

    it('M1: SIGTERM releases the cycle lock with the right token (PM2 sends SIGTERM first)', async () => {
      const { main } = await import('../../src/index.js');
      await main();
      lockReleaseMock.mockClear();

      process.emit('SIGTERM' as NodeJS.Signals);
      await new Promise((resolve) => setImmediate(resolve));

      expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'tok-1');
    });

    /**
     * Round-4 LOW: the SIGTERM handler used to hardcode `process.exit(0)`
     * regardless of whether a step had already failed — a signal landing
     * mid-cycle after a recorded error still reported "success" to PM2.
     */
    it('R4-LOW: SIGTERM after a recorded cycle error exits 1, not 0', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      runNSEScraperMock.mockRejectedValueOnce(new Error('NSE returned 503'));
      const { main } = await import('../../src/index.js');
      await main();
      exitSpy.mockClear();

      process.emit('SIGTERM' as NodeJS.Signals);
      await new Promise((resolve) => setImmediate(resolve));

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('R4-LOW: SIGTERM on a clean cycle exits 130 (terminated-by-signal), not 0', async () => {
      const { main } = await import('../../src/index.js');
      await main();
      exitSpy.mockClear();

      process.emit('SIGTERM' as NodeJS.Signals);
      await new Promise((resolve) => setImmediate(resolve));

      expect(exitSpy).toHaveBeenCalledWith(130);
    });

    /**
     * Round-4 LOW: a `false` return from `extendLock` (lock lost/expired to
     * another writer) was previously ignored entirely — only the rejection
     * path was handled. The cycle kept issuing further due-step writes under
     * a lock it no longer held.
     */
    it('R4-LOW: extendLock resolving false mid-cycle stops the NEXT due-step-cycle step', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      isDiscoveryDueMock.mockReturnValue(true);
      // The NSE step (discovery's first step) fires the keep-alive callback
      // itself, as a false-returning `extendLock` would mid-flight — proving
      // the flag it sets is observed by the VERY NEXT step (BSE), not just a
      // future cycle.
      runNSEScraperMock.mockImplementationOnce(async () => {
        lockExtendMock.mockResolvedValueOnce(false);
        const keepAlive = setIntervalSpy.mock.calls.find((call) => call[1] === 5 * 60 * 1000);
        expect(keepAlive).toBeDefined();
        (keepAlive![0] as () => void)();
        await Promise.resolve();
        await Promise.resolve();
        return { ...baseScraperResult, smeCount: 0, mainboardCount: 0 };
      });
      const { main } = await import('../../src/index.js');
      await main();

      expect(runBSEScraperMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
      setIntervalSpy.mockRestore();
    });

    /**
     * Item 7 S2b (F-142, spec §2.1, OD-19): #935 gated discovery (NSE+BSE) and
     * the document cycle to the data-job slots, but Chittorgarh and the API
     * fallback kept their own 24h catch-up cadence, which fires on ANY wake —
     * staging's 22:15 IST wake of 2026-09-23 fetched the Chittorgarh list and
     * created 8 IPOs. These run the REAL slot rule (isDataJobDue) against a
     * Redis stand-in, so the gate is proven on the dispatch, not on a mock verdict.
     */
    describe('item 7 S2b — website list scrapers run only in a data-job slot (OD-19)', () => {
      let store: Map<string, string>;
      const istToUtc = (isoIst: string) => new Date(`${isoIst}+05:30`);

      beforeEach(async () => {
        const { isDataJobDue } = await vi.importActual<typeof import('@ipodhan/shared/scheduler/data-job-slots')>(
          '@ipodhan/shared/scheduler/data-job-slots'
        );
        isDiscoveryDueMock.mockImplementation((now: Date, last: Date | null) => isDataJobDue(now, last));
        store = new Map();
        redisGetMock.mockImplementation(async (k: string) => store.get(k) ?? null);
        redisSetMock.mockImplementation(async (k: string, v: string) => { store.set(k, v); return 'OK'; });
        // Both 24h cadences due, IPOs UPCOMING/OPEN present: only the slot gate can stop them.
        isCatchUpCadenceDueMock.mockResolvedValue(true);
        dbCountRowsMock.mockResolvedValue([{ c: 5 }]);
        vi.useFakeTimers({ toFake: ['Date'] });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      const expectNoListScraper = () => {
        expect(runNSEScraperMock).not.toHaveBeenCalled();
        expect(runBSEScraperMock).not.toHaveBeenCalled();
        expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
        expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
      };

      it('F-142: a 22:15 IST wake after the 14:00 slot finished calls NO website list scraper', async () => {
        store.set('due-step:last-discovery', istToUtc('2026-09-23T14:05:00').toISOString());
        vi.setSystemTime(istToUtc('2026-09-23T22:15:00'));
        const { main } = await import('../../src/index.js');
        await main();

        expectNoListScraper();
        expect(markCatchUpCadenceRanMock).not.toHaveBeenCalled();
      });

      it('the date-based status update still runs on a non-slot wake', async () => {
        store.set('due-step:last-discovery', istToUtc('2026-09-23T14:05:00').toISOString());
        vi.setSystemTime(istToUtc('2026-09-23T22:15:00'));
        const { main } = await import('../../src/index.js');
        await main();

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/admin/status/update'))).toBe(true);
        expect(exitSpy).toHaveBeenCalledWith(0);
      });

      it('a slot wake (08:15 IST) runs discovery, Chittorgarh and the API fallback', async () => {
        store.set('due-step:last-discovery', istToUtc('2026-09-23T00:05:00').toISOString());
        vi.setSystemTime(istToUtc('2026-09-23T08:15:00'));
        const { main } = await import('../../src/index.js');
        await main();

        expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
        expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
        expect(runChittorgarhScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['UPCOMING', 'OPEN'] });
        expect(runIPOAlertsFallbackMock).toHaveBeenCalledWith('scheduled');
      });

      it('a missed slot is caught up once on the next wake, and the wake after it does nothing', async () => {
        // Last run 14:05 yesterday: the 00:00 and 08:00 slots were both missed.
        store.set('due-step:last-discovery', istToUtc('2026-09-22T14:05:00').toISOString());
        vi.setSystemTime(istToUtc('2026-09-23T10:30:00'));
        const first = await import('../../src/index.js');
        await first.main();
        expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
        expect(runChittorgarhScraperMock).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        vi.resetModules();
        isCatchUpCadenceDueMock.mockResolvedValue(true);
        vi.setSystemTime(istToUtc('2026-09-23T11:00:00'));
        const second = await import('../../src/index.js');
        await second.main();
        expectNoListScraper();
      });

      it('24h cadence keys are stamped at the SLOT boundary, so the same slot tomorrow is due and cannot slip a slot', async () => {
        store.set('due-step:last-discovery', istToUtc('2026-09-23T00:05:00').toISOString());
        vi.setSystemTime(istToUtc('2026-09-23T08:15:42'));
        const { main } = await import('../../src/index.js');
        await main();

        const slot = istToUtc('2026-09-23T08:00:00').getTime();
        for (const key of ['due-step-aggregators', 'due-step-api-fallback']) {
          const call = markCatchUpCadenceRanMock.mock.calls.find((c) => c[1] === key);
          expect(call, key).toBeDefined();
          expect((call![3] as Date).getTime(), key).toBe(slot);
        }
      });
    });

    it('never calls the legacy unconditional per-source blocks (NSE/BSE/MC/CG/GMP/fallback) directly on "all"', async () => {
      // With everything "not due", NOTHING should have been called at all.
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runBSEScraperMock).not.toHaveBeenCalled();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
    });
  });
});
