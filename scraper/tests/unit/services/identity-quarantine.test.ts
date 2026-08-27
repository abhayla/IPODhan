import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * T-339 item 2 - "key beats name" identity quarantine.
 *
 * Two layers under test:
 *   A. `recordIdentityQuarantine` - the HOLD row + the P1 page, and its
 *      non-fatal behaviour when either side fails.
 *   B. `BaseScraperOrchestrator.processIPO` - on an ISIN/symbol-vs-name
 *      disagreement the IPO is SKIPPED and NOTHING is written (both
 *      disagreement directions, plus the no-disagreement control that must
 *      still write).
 *
 * (B) is the one that matters: before this task the disagreement was logged
 * and the write proceeded onto the name-tier row.
 */

const mockFindByIsin = vi.fn();
const mockFindBySymbol = vi.fn();
const mockFindBySlug = vi.fn();
const mockFindByNormalizedName = vi.fn();
const mockUpsertConflict = vi.fn();
const mockConsolidatedUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockNotifyOwner = vi.fn();

vi.mock('@ipodhan/shared', async (importOriginal) => {
  // Keep the REAL resolveIpoRow + IdentityQuarantineError - a hand-copied
  // mock of the tier logic is exactly the divergence class T-307 closed.
  const actual = await importOriginal<typeof import('@ipodhan/shared')>();
  return {
    ...actual,
    db: {},
    getRedisClient: () => ({}),
    IPORepository: vi.fn().mockImplementation(() => ({
      findByIsin: mockFindByIsin,
      findBySymbol: mockFindBySymbol,
      findBySlug: mockFindBySlug,
      findByNormalizedName: mockFindByNormalizedName,
      findByFuzzyName: vi.fn().mockResolvedValue(null),
      update: mockUpdate,
    })),
    SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
    ScraperLogRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn().mockResolvedValue({}),
      getRecentLogs: vi.fn().mockResolvedValue([]),
    })),
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({
      upsertConflict: mockUpsertConflict,
    })),
    createFieldProtectionService: vi.fn().mockReturnValue({
      isIPOLocked: vi.fn().mockResolvedValue(false),
      filterProtectedFields: vi.fn().mockImplementation(async (_id: unknown, _t: unknown, data: unknown) => ({ filtered: data })),
      isFieldProtected: vi.fn().mockResolvedValue({ isProtected: false }),
    }),
  };
});

vi.mock('../../../src/services/owner-notify.js', () => ({
  notifyOwner: mockNotifyOwner,
}));

vi.mock('../../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateAfterScrape: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn().mockImplementation(() => ({
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    shouldSendAlert: vi.fn().mockResolvedValue({ sendAlert: false, reason: null }),
    getMetrics: vi.fn().mockResolvedValue({ success: 0, failure: 0, rate: 100 }),
    getConsecutiveFailures: vi.fn().mockResolvedValue(0),
    recordZeroYieldCycle: vi.fn().mockResolvedValue(undefined),
    markAlertSent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/alerting-service.js', () => ({
  AlertingService: vi.fn().mockImplementation(() => ({
    getRecentErrors: vi.fn().mockReturnValue([]),
    sendAlert: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: mockConsolidatedUpsert,
  })),
}));

vi.mock('../../../src/services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: { recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));

vi.mock('../../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({ coldStart: true, degraded: false, reasons: [] }),
  };
});

// ---------------------------------------------------------------------------
// Module loading is hoisted OUT of every per-test budget.
//
// vitest.config.ts sets testTimeout: 20_000. Each `await import(...)` below used
// to sit INSIDE a test, so whichever test ran first paid the cold transform of
// the whole orchestrator/service graph (measured: ~14s idle) against its own 20s
// timeout. Under load that tips over, and a timed-out vitest test is NOT
// cancelled - its pending run() completes during the NEXT test and lands a call
// on these module-level mocks, failing `not.toHaveBeenCalled()` with the
// PREVIOUS test's payload. Measured 5 failures / 20 cold runs before this hoist.
// beforeAll has its own (generous) hook timeout, so no test can be orphaned.
// ---------------------------------------------------------------------------
let QuarantineMod: typeof import('../../../src/services/identity-quarantine.js');
let SharedMod: typeof import('@ipodhan/shared');
let OrchestratorBase: typeof import('../../../src/base/BaseScraperOrchestrator.js')['BaseScraperOrchestrator'];

beforeAll(async () => {
  [QuarantineMod, SharedMod] = await Promise.all([
    import('../../../src/services/identity-quarantine.js'),
    import('@ipodhan/shared'),
  ]);
  ({ BaseScraperOrchestrator: OrchestratorBase } =
    await import('../../../src/base/BaseScraperOrchestrator.js'));
}, 180000);

async function makeError(overrides: Record<string, unknown> = {}) {
  const { IdentityQuarantineError } = SharedMod;
  return new IdentityQuarantineError({
    keyTier: 'ISIN',
    companyName: 'Acme Ltd',
    normalizedName: 'acme',
    isin: 'INE123A01011',
    symbol: null,
    keyMatchId: 'row-A',
    keyMatchCompanyName: 'Acme Ltd',
    nameMatchId: 'row-B',
    nameMatchCompanyName: 'Acme Limited',
    ...overrides,
  } as never);
}

describe('recordIdentityQuarantine - HOLD row + P1 page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes an UNRESOLVED data_conflicts HOLD row carrying BOTH candidate ids, the source and CRITICAL severity', async () => {
    const { recordIdentityQuarantine, IDENTITY_QUARANTINE_REASON, IDENTITY_QUARANTINE_FIELD } = QuarantineMod;
    mockUpsertConflict.mockResolvedValue({ id: 'conflict-1' });

    const outcome = await recordIdentityQuarantine(
      { dataConflictsRepository: { upsertConflict: mockUpsertConflict } as never, notify: mockNotifyOwner as never },
      await makeError(),
      'NSE'
    );

    expect(outcome).toMatchObject({ recorded: true, alerted: true, conflictId: 'conflict-1' });
    expect(mockUpsertConflict).toHaveBeenCalledWith(expect.objectContaining({
      ipoId: 'row-A',
      tableName: 'ipos',
      fieldName: IDENTITY_QUARANTINE_FIELD,
      source1: 'NSE',
      source2: 'NSE',
      value1: 'row-A',
      value2: 'row-B',
      resolutionReason: IDENTITY_QUARANTINE_REASON,
      severity: 'CRITICAL',
    }));
    // Not resolved: no resolvedSource is set, so the row stays unresolved
    // and the nightly k_identity_quarantine check can see it.
    expect(mockUpsertConflict.mock.calls[0][0]).not.toHaveProperty('resolvedSource');
  });

  it('pages the owner at P1 with both candidate ids and a stable per-pair dedupeKey', async () => {
    const { recordIdentityQuarantine } = QuarantineMod;
    mockUpsertConflict.mockResolvedValue({ id: 'conflict-1' });

    await recordIdentityQuarantine(
      { dataConflictsRepository: { upsertConflict: mockUpsertConflict } as never, notify: mockNotifyOwner as never },
      await makeError(),
      'NSE'
    );

    expect(mockNotifyOwner).toHaveBeenCalledWith(
      'P1',
      expect.stringContaining('identity quarantine'),
      expect.objectContaining({
        type: 'identity-quarantine',
        dedupeKey: 'identity-quarantine:row-A:row-B',
        body: expect.stringContaining('row-B'),
      })
    );
  });

  it('still pages (and never throws) when the HOLD row cannot be written', async () => {
    const { recordIdentityQuarantine } = QuarantineMod;
    mockUpsertConflict.mockRejectedValue(new Error('db down'));

    const outcome = await recordIdentityQuarantine(
      { dataConflictsRepository: { upsertConflict: mockUpsertConflict } as never, notify: mockNotifyOwner as never },
      await makeError(),
      'NSE'
    );

    expect(outcome.recorded).toBe(false);
    expect(outcome.alerted).toBe(true);
    expect(mockNotifyOwner.mock.calls[0][2].body).toContain('could NOT be written');
  });

  it('maps a source outside the data_conflicts enum onto API_FALLBACK instead of failing the insert', async () => {
    const { toConflictSource } = QuarantineMod;
    expect(toConflictSource('NSE')).toBe('NSE');
    expect(toConflictSource('INVESTORGAIN_GMP')).toBe('API_FALLBACK');
  });
});

describe('BaseScraperOrchestrator.processIPO - quarantine means NO write', () => {
  // The first dynamic import of BaseScraperOrchestrator pulls in the whole
  // orchestrator dependency graph and costs ~14s on a cold transform. Paid
  // inside a test's own 20s budget (as it was), the FIRST test in this block
  // sat at 70% of its timeout on an idle machine and tipped over it under CI
  // load. A timed-out vitest test does not cancel its pending work: the
  // orphaned run() completed during the NEXT test and landed a
  // mockConsolidatedUpsert call there, failing `not.toHaveBeenCalled()` with
  // the PREVIOUS test's payload. Hoisting the import into beforeAll pays that
  // cost once, outside every per-test timeout, so no test can be orphaned.
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIsin.mockResolvedValue(null);
    mockFindBySymbol.mockResolvedValue(null);
    mockFindBySlug.mockResolvedValue(null);
    mockFindByNormalizedName.mockResolvedValue(null);
    mockUpsertConflict.mockResolvedValue({ id: 'conflict-1' });
    mockConsolidatedUpsert.mockResolvedValue({ ipoId: 'row-X', isNew: false, skipped: false, locked: false });
  });

  async function runWith(ipo: Record<string, unknown>) {
    class TestOrchestrator extends OrchestratorBase<Record<string, unknown>> {
      protected getScraperName() { return 'NSE' as const; }
      protected async scrapeData() { return { ipos: [ipo], subscriptions: [] }; }
      protected validateIPO(i: Record<string, unknown>) { return { success: true as const, data: i }; }
    }
    return new TestOrchestrator().run();
  }

  it('direction 1 (ISIN key row A vs name row B): skips the IPO, writes nothing, records a quarantine', async () => {
    mockFindByIsin.mockResolvedValue({ id: 'row-A', companyName: 'Acme Ltd' });
    mockFindByNormalizedName.mockResolvedValue({ id: 'row-B', companyName: 'Acme Limited' });

    const result = await runWith({
      companyName: 'Acme Ltd', offeringType: 'IPO', segment: 'MAINBOARD', isin: 'INE123A01011',
    });

    expect(mockConsolidatedUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpsertConflict).toHaveBeenCalledWith(expect.objectContaining({ value1: 'row-A', value2: 'row-B' }));
    expect(mockNotifyOwner).toHaveBeenCalledWith('P1', expect.stringContaining('identity quarantine'), expect.anything());
    expect(result.iposSkipped).toBeGreaterThan(0);
  }, 20000);

  it('direction 2 (SYMBOL key row C vs name row D): skips the IPO, writes nothing', async () => {
    mockFindBySymbol.mockResolvedValue({ id: 'row-C', companyName: 'Acme Industries' });
    mockFindByNormalizedName.mockResolvedValue({ id: 'row-D', companyName: 'Acme Ltd' });

    const result = await runWith({
      companyName: 'Acme Ltd', offeringType: 'IPO', segment: 'MAINBOARD', symbol: 'ACME',
    });

    expect(mockConsolidatedUpsert).not.toHaveBeenCalled();
    expect(mockUpsertConflict).toHaveBeenCalledWith(expect.objectContaining({ value1: 'row-C', value2: 'row-D' }));
    expect(result.iposSkipped).toBeGreaterThan(0);
  }, 20000);

  it('CONTROL (no disagreement): the write still happens and no quarantine is recorded', async () => {
    const sameRow = { id: 'row-A', companyName: 'Acme Ltd' };
    mockFindByIsin.mockResolvedValue(sameRow);
    mockFindByNormalizedName.mockResolvedValue(sameRow);

    await runWith({
      companyName: 'Acme Ltd', offeringType: 'IPO', segment: 'MAINBOARD', isin: 'INE123A01011',
    });

    expect(mockConsolidatedUpsert).toHaveBeenCalled();
    expect(mockUpsertConflict).not.toHaveBeenCalled();
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  }, 20000);
});
