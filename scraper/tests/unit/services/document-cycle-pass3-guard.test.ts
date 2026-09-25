/**
 * PASS 3's empty-registry REFUSAL — item 6.
 *
 * THE CLASS THIS EXISTS FOR, stated plainly: a comment is not a guard.
 *
 * `field-plan-walk-deps.ts` asserts, in prose, that "PASS 3 refuses to run at
 * all while the registry is empty". That sentence cannot fail. If someone
 * deletes the `fieldPlanWalkHasFetchers()` branch in `document-cycle.ts`, the
 * comment still reads as true, every other test still passes, and the walk
 * starts claiming rows with nothing to ask them of.
 *
 * WHAT HAPPENS IF THE GUARD IS GONE — measured, not assumed, from the code as
 * shipped (`field-plan-walk.ts`):
 *   - a source named in the plan with no registered fetcher pushes
 *     `rank<N>:<SOURCE>:NO_FETCHER_REGISTERED` into `failures` and moves to
 *     the next rank (line ~302);
 *   - all three ranks fall through, so the field reaches the all-ranks-failed
 *     branch (line ~379), which calls `recordOutcome` with
 *     `state: 'EXHAUSTED'` and `writeHappened: true`;
 *   - `recordOutcome` on a real attempt does `attempts = attempts + 1`, stamps
 *     `last_attempt_at`, AND — because 'EXHAUSTED' is in the repository's
 *     `TERMINAL_STATES` — sets `next_due_at = NULL`.
 *
 * So the cost of losing the guard is not a wasted cycle: it is EVERY field in
 * the plan being permanently retired, terminally, without one source ever
 * being asked. That is why the refusal is at the cycle's PASS 3 entry, before
 * a claim is taken, rather than inside the walk — claiming and then failing
 * still stamps `claimed_at` and burns backoff.
 *
 * These tests assert the OBSERVABLE CONSEQUENCE (no claim is ever taken, so no
 * attempt can be charged and no state can change), never the log text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecuteMock = vi.fn();
const dbInsertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

/**
 * The claim. If PASS 3 ever runs, this is the FIRST thing it touches — so
 * "was this called" is the exact observable that separates "refused" from
 * "ran and found nothing".
 */
const claimNextDueFieldMock = vi.fn().mockResolvedValue(null);
const recordOutcomeMock = vi.fn().mockResolvedValue({ written: true });
const releaseClaimUnrecordedMock = vi.fn().mockResolvedValue({ released: true });

vi.mock('@ipodhan/shared', () => ({
  db: {
    execute: (...args: unknown[]) => dbExecuteMock(...args),
    insert: (...args: unknown[]) => dbInsertMock(...args),
  },
  getRedisClient: () => ({}),
  DocumentRepository: vi.fn().mockImplementation(() => ({
    findByIPO: vi.fn().mockResolvedValue([]),
  })),
  DocumentFetchStateRepository: vi.fn().mockImplementation(() => ({
    listForIpo: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  IpoPipelineStepsRepository: vi.fn().mockImplementation(() => ({
    findByIpo: vi.fn().mockResolvedValue([]),
  })),
  IpoFieldPlanRepository: vi.fn().mockImplementation(() => ({
    claimNextDueField: (...args: unknown[]) => claimNextDueFieldMock(...args),
    recordOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
    releaseClaimUnrecorded: (...args: unknown[]) => releaseClaimUnrecordedMock(...args),
    // Item 5 s4's PASS 2.5 constructs the SAME class from the SAME barrel,
    // so the mock must answer for the generation path too or every test in
    // this file dies at import time rather than on an assertion.
    upsertGeneratedRows: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
  })),
}));


/**
 * The logger is mocked so the SUMMARY PAYLOAD can be inspected directly.
 * That payload is the layer that matters: it is where a counter becomes
 * something a reader can act on. Asserting the walk's return object instead
 * -- one layer below -- is what let the counter-with-no-consumer defect be
 * "fixed" with a proof that could not have failed for the claim.
 */
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
vi.mock('../../../src/utils/logger.js', () => {
  const fake = {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { default: fake, logger: fake };
});

vi.mock('../../../src/services/data-persister.js', () => ({
  recordBseDiscoveryMetadata: vi.fn().mockResolvedValue(undefined),
  recordDocumentSourceHints: vi.fn().mockResolvedValue(undefined),
  recordDiscoveredLeadManagers: vi.fn().mockResolvedValue(undefined),
}));

/**
 * #727: a partial mock, not a full replacement. Every describe block ABOVE
 * this one (the empty-registry refusal, the eleven-counter summary, the
 * once-per-cycle builders) exercises the REAL `walkFieldPlanForIPO` and
 * depends on it driving `claimNextDueFieldMock` — so the default
 * implementation call-throughs to the real function. Only the new
 * "PASS 3 summary carries dropped-write/exhausted-field identities" describe
 * block below overrides it per-call (`mockImplementationOnce`), to hand the
 * cycle a canned `droppedWrites`/`exhaustedFields` array per IPO without
 * reconstructing a real multi-rank fetcher scenario for each one.
 */
const walkFieldPlanForIPOMock = vi.fn();
vi.mock('../../../src/services/field-plan-walk.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/field-plan-walk.js')>();
  walkFieldPlanForIPOMock.mockImplementation(actual.walkFieldPlanForIPO);
  return {
    ...actual,
    walkFieldPlanForIPO: (...args: Parameters<typeof actual.walkFieldPlanForIPO>) =>
      walkFieldPlanForIPOMock(...args),
  };
});

const runIpoMock = vi.fn().mockImplementation((ipo: { id: string }) => ({
  ipoId: ipo.id,
  companyName: 'Test Co',
  stage: 'PRE_OPEN',
  skipped: false,
  skipReason: '',
  due: [],
  found: [],
  notYetFiled: [],
  notFound: [],
  blocked: [],
  notApplicable: [],
  superseded: [],
  leadManagers: [],
  attempts: [],
  networkCalls: 0,
}));

vi.mock('../../../src/services/document-discovery-runner.js', () => ({
  DocumentDiscoveryRunner: vi.fn().mockImplementation(() => ({
    runIpo: (...args: unknown[]) => runIpoMock(...args),
  })),
  defaultFetcher: {},
  toStateRow: (r: unknown) => r,
}));

vi.mock('../../../src/utils/network-counter.js', () => ({
  NetworkCounter: vi.fn().mockImplementation(() => ({ byHost: () => ({}) })),
}));

vi.mock('../../../src/services/company-host-source.js', () => ({
  isVerifierUrl: () => false,
  resetRegistrarDocumentHostsCache: () => {},
  loadRegistrarDocumentHosts: async () => new Set<string>(),
}));

vi.mock('../../../src/scheduler/stage-reconciler.js', () => ({
  deriveLifecycleStage: () => 'PRE_OPEN',
}));

vi.mock('../../../src/services/document-store.js', () => ({
  hasStoredFile: () => true,
  getStoreDir: () => '.',
  decidePurge: vi.fn(),
  purgeIpoDocuments: vi.fn(),
  getRetentionDays: () => 7,
  getMaxRetentionDays: () => 30,
}));

const FEATURE_FLAGS: {
  ENABLE_FILING_AUTO_PERSIST: boolean;
  ENABLE_UPCOMING_DISCOVERY_RESERVATION: boolean;
  ENABLE_FIELD_PLAN_WALK: boolean;
} = {
  ENABLE_FILING_AUTO_PERSIST: false,
  ENABLE_UPCOMING_DISCOVERY_RESERVATION: false,
  ENABLE_FIELD_PLAN_WALK: true,
};
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS }));

vi.mock('../../../src/services/step-ledger.js', () => ({
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDocumentRunSteps: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/filing-auto-persist.js', () => ({
  processPendingFilings: vi.fn(),
  buildAutoPersistDeps: vi.fn().mockImplementation(() => ({})),
  DEFAULT_MAX_SPAWNS_PER_CYCLE: 3,
  anchorMaxSpawnsPerCycle: () => 1,
  FILING_EXTRACTION_LOCK_TTL_MS: 45 * 60 * 1000,
  // `document-cycle.ts` imports EXTRACTOR_VERSION from this module (passed to
  // `buildFieldPlanGapKeySource`) — same "supply every real export" failure
  // class as the field-plan-walk-deps mock above.
  EXTRACTOR_VERSION: 'extract_filing.py@2026-09-03',
}));

vi.mock('../../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' }),
    release: vi.fn().mockResolvedValue(undefined),
  })),
}));

/**
 * The registry under test. `hasFetchers` is flipped per test so BOTH arms are
 * exercised: an empty registry must refuse, a populated one must proceed —
 * a guard that refuses unconditionally would pass a one-sided test and break
 * the feature.
 */
let hasFetchers = false;
const buildFieldPlanWalkFetchersMock = vi.fn(() => (hasFetchers ? { NSE: async () => ({ outcome: 'NOT_PRINTED' }) } : {}));
const buildFieldPlanWalkOrchestratorMock = vi.fn().mockImplementation(() => ({
  consolidatedUpsertIPO: vi.fn(),
  consolidatedUpsertChildRows: vi.fn(),
}));
// S3b-2: hoisted once per cycle alongside the two builders above (document-cycle.ts) — a
// full-replacement vi.mock needs every export the real module has, or a caller destructuring
// one this mock omits gets `undefined` and throws when it's invoked as a function.
const buildFieldPlanWalkWitnessVerdictWriterMock = vi.fn().mockImplementation(() => vi.fn());
// Round 3: `buildFieldPlanGapKeySource` is a real export of the mocked module
// (#884 round 2 added it) — a full-replacement `vi.mock` must supply every
// export the real module has, or a caller destructuring one this mock omits
// gets `undefined` and throws when it's invoked as a function (same failure
// class the S3b-2 comment above already documents for the witness writer).
const buildFieldPlanGapKeySourceMock = vi.fn().mockImplementation(() => ({
  forIpo: vi.fn().mockResolvedValue({ byField: {} }),
}));
vi.mock('../../../src/services/field-plan-walk-deps.js', () => ({
  buildFieldPlanWalkFetchers: (...args: unknown[]) => buildFieldPlanWalkFetchersMock(...args),
  buildFieldPlanWalkOrchestrator: (...args: unknown[]) => buildFieldPlanWalkOrchestratorMock(...args),
  buildFieldPlanWalkWitnessVerdictWriter: (...args: unknown[]) => buildFieldPlanWalkWitnessVerdictWriterMock(...args),
  buildFieldPlanWalkReopenDeps: () => ({}),
  buildFieldPlanGapKeySource: (...args: unknown[]) => buildFieldPlanGapKeySourceMock(...args),
  fieldPlanWalkHasFetchers: (fetchers?: Record<string, unknown>) =>
    Object.keys(fetchers ?? buildFieldPlanWalkFetchersMock()).length > 0,
}));

function candidateRow(id: string, status = 'OPEN') {
  return {
    id,
    company_name: `Company ${id}`,
    slug: id,
    symbol: null,
    segment: 'MAINBOARD',
    status,
    price_range_min: null,
    price_range_max: null,
    listing_date: null,
    bse_ipo_no: null,
    company_website: null,
    verifier_url: null,
  };
}

const { runDocumentCycle } = await import('../../../src/services/document-cycle.js');

beforeEach(() => {
  vi.clearAllMocks();
  hasFetchers = false;
  FEATURE_FLAGS.ENABLE_FIELD_PLAN_WALK = true;
  FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = false;
  claimNextDueFieldMock.mockResolvedValue(null);
  dbExecuteMock.mockResolvedValue({ rows: [candidateRow('ipo-1'), candidateRow('ipo-2')] });
});

describe('PASS 3 refuses to run on an empty fetcher registry', () => {
  it('takes NO claim — so no attempt can be charged and no state can change', async () => {
    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    // THE assertion. A claim is the only door to `recordOutcome`; if the walk
    // never claims, `attempts` cannot be incremented and `state` cannot move.
    // Asserting the consequence, not the log line, is what makes this test
    // survive a rewording of the warning.
    expect(claimNextDueFieldMock).not.toHaveBeenCalled();
    expect(recordOutcomeMock).not.toHaveBeenCalled();
    expect(releaseClaimUnrecordedMock).not.toHaveBeenCalled();
  });

  it('refuses even with a full wake budget — budget is not what is missing', async () => {
    await runDocumentCycle({ wakeBudgetMs: 60 * 60 * 1000 });
    expect(claimNextDueFieldMock).not.toHaveBeenCalled();
  });

  it('refuses for EVERY candidate, not just the first', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [candidateRow('ipo-1'), candidateRow('ipo-2'), candidateRow('ipo-3')],
    });
    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });
    expect(claimNextDueFieldMock).not.toHaveBeenCalled();
  });

  it('the flag being ON is not enough — the adapters are the second half', async () => {
    FEATURE_FLAGS.ENABLE_FIELD_PLAN_WALK = true;
    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });
    expect(claimNextDueFieldMock).not.toHaveBeenCalled();
  });
});

describe('PASS 3 summary log carries EVERY counter (signal-ownership R1/R3)', () => {
  /**
   * WHY THIS TEST IS AT THIS LAYER, and the pattern it exists to stop.
   *
   * Three consecutive review rounds on this PR produced a fix carrying the
   * defect's own weakness:
   *   round 1 -- a guard described in a COMMENT, with no test;
   *   round 2 -- a counter wired into the result, with no CONSUMER;
   *   round 3 -- a consumer wired into walkTotals, with no TEST.
   * Each fix was correct code and each proof could not have failed for the
   * claim it was making. The round-2 tests asserted hasOwnProperty on the
   * WALK'S RETURN OBJECT; the defect lived in document-cycle's walkTotals and
   * its summary log line, one layer up. Deleting fieldsCheckFailed from both
   * the initializer and the accumulation left 71 of 71 tests green.
   *
   * So this asserts the SUMMARY LOG PAYLOAD -- the place a number becomes
   * something a reader can act on. If a counter is dropped anywhere between
   * the walk's return and that payload, this goes red.
   */
  const EVERY_COUNTER = [
    'iposWalked',
    'fieldsAttempted',
    'fieldsSupplied',
    'fieldsExhausted',
    'fieldsCheckFailed',
    'fieldsNotAvailableYet',
    'fieldsProvisional',
    'fieldsWriteSkipped',
    'fieldsSkippedProtected',
    'outcomesRefused',
    'outcomesFailed',
  ];

  function summaryPayload(): Record<string, unknown> | undefined {
    const call = loggerInfoMock.mock.calls.find(
      (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('PASS 3 field-plan walk summary')
    );
    return call?.[0] as Record<string, unknown> | undefined;
  }

  it('logs the summary with all eleven counters present', async () => {
    hasFetchers = true;

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    const payload = summaryPayload();
    expect(payload).toBeDefined();
    for (const counter of EVERY_COUNTER) {
      // A counter missing HERE never reaches a reader, whatever the walk
      // returned. That is the whole defect class.
      expect(Object.prototype.hasOwnProperty.call(payload, counter)).toBe(true);
      expect(typeof payload![counter]).toBe('number');
    }
  });

  it('names fieldsCheckFailed and outcomesFailed specifically — the two that say the pass went badly', async () => {
    hasFetchers = true;

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    const payload = summaryPayload();
    // fieldsCheckFailed distinguishes "healthy" from "every field failing
    // transiently and re-asked forever on a doubling backoff". outcomesFailed
    // is the DB-unreachable signal. Neither has any other line that reports
    // it, so they are asserted by name rather than only as part of the set.
    expect(payload).toHaveProperty('fieldsCheckFailed');
    expect(payload).toHaveProperty('outcomesFailed');
  });

  it('logs the summary even when the walk did nothing — a silent pass is still a reading', async () => {
    hasFetchers = true;
    claimNextDueFieldMock.mockResolvedValue(null);

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    // An all-zero summary is evidence the walk ran and found nothing due,
    // which is a different fact from the walk never running. Dropping the log
    // on a quiet cycle would make those two indistinguishable.
    const payload = summaryPayload();
    expect(payload).toBeDefined();
    expect(payload!.fieldsAttempted).toBe(0);
  });
});

describe('PASS 3 DOES run once the registry is populated (the guard is not a blanket off-switch)', () => {
  it('claims once the registry has a fetcher', async () => {
    hasFetchers = true;

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    // The other arm: a guard that refused unconditionally would satisfy every
    // test above and silently disable the feature forever.
    expect(claimNextDueFieldMock).toHaveBeenCalled();
  });

  it('still does not run when the FLAG is off, however full the registry', async () => {
    hasFetchers = true;
    FEATURE_FLAGS.ENABLE_FIELD_PLAN_WALK = false;

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    expect(claimNextDueFieldMock).not.toHaveBeenCalled();
  });

  // Review round 3, MINOR-3 (real cost): buildFieldPlanWalkOrchestrator() and
  // buildFieldPlanWalkFetchers() used to be called INSIDE
  // `for (const ipo of candidates)`, so the BSE board / Chittorgarh list
  // fetch each IPO's walk re-triggers (ruling 33's per-cycle memo is
  // defeated -- 40x per cycle instead of once). Both builders must be
  // invoked exactly ONCE per cycle, however many IPOs are walked.
  it('builds the orchestrator and the fetchers ONCE per cycle, not once per IPO', async () => {
    hasFetchers = true;
    dbExecuteMock.mockResolvedValue({
      rows: [candidateRow('ipo-1'), candidateRow('ipo-2'), candidateRow('ipo-3')],
    });

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    expect(claimNextDueFieldMock).toHaveBeenCalled();
    expect(buildFieldPlanWalkOrchestratorMock).toHaveBeenCalledTimes(1);
    // 2, not 3+: ONE call is `fieldPlanWalkHasFetchers()`'s own default-arg
    // guard check (`buildFieldPlanWalkFetchers()` called with no args before
    // the loop even starts, unrelated to this bug), the OTHER is the single
    // per-cycle build the loop now reuses for every IPO. Never N+1 for N
    // candidate IPOs, which is what the per-IPO rebuild bug produced (5 for
    // 3 IPOs: 1 guard-check + 1-per-IPO).
    expect(buildFieldPlanWalkFetchersMock).toHaveBeenCalledTimes(2);
  });
});

describe('#727: PASS 3 summary carries the droppedWrites/exhaustedFields identity lines and their cap', () => {
  /**
   * A full `FieldPlanWalkResult`, mirroring the real shape (`field-plan-walk.ts`'s
   * `FieldPlanWalkResult`), with every counter zeroed except the two identity
   * arrays under test — those come from the caller.
   */
  function walkResult(overrides: {
    ipoId: string;
    droppedWrites?: Array<{ tableName: string; rowKey: string; fieldName: string; source: string; skipReason: string }>;
    exhaustedFields?: Array<{ tableName: string; rowKey: string; fieldName: string }>;
  }) {
    return {
      ipoId: overrides.ipoId,
      fieldsAttempted: 0,
      fieldsSupplied: 0,
      fieldsExhausted: 0,
      fieldsCheckFailed: 0,
      fieldsSkippedProtected: 0,
      fieldsWriteSkipped: 0,
      fieldsNotAvailableYet: 0,
      fieldsProvisional: 0,
      outcomesRefused: 0,
      outcomesFailed: 0,
      stoppedReason: 'NO_DUE_FIELDS' as const,
      droppedWrites: overrides.droppedWrites ?? [],
      exhaustedFields: overrides.exhaustedFields ?? [],
    };
  }

  function summaryPayload(): Record<string, unknown> | undefined {
    const call = loggerInfoMock.mock.calls.find(
      (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('PASS 3 field-plan walk summary')
    );
    return call?.[0] as Record<string, unknown> | undefined;
  }

  it('a dropped write and an exhausted field from a single IPO walk appear in the summary arrays', async () => {
    hasFetchers = true;
    dbExecuteMock.mockResolvedValue({ rows: [candidateRow('ipo-1')] });
    walkFieldPlanForIPOMock.mockImplementationOnce(async (ipoId: string) =>
      walkResult({
        ipoId,
        droppedWrites: [
          { tableName: 'ipos', rowKey: ipoId, fieldName: 'lotSize', source: 'NSE', skipReason: 'CHECK_FAILED' },
        ],
        exhaustedFields: [{ tableName: 'ipos', rowKey: ipoId, fieldName: 'registrar' }],
      })
    );

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    const payload = summaryPayload();
    expect(payload).toBeDefined();
    expect(payload!.droppedWrites).toEqual(['ipo-1:ipos.lotSize (source=NSE, CHECK_FAILED)']);
    expect(payload!.exhaustedFields).toEqual(['ipo-1:ipos.registrar']);
  });

  it('aggregates identities from MULTIPLE IPOs in one cycle into the same two arrays', async () => {
    hasFetchers = true;
    dbExecuteMock.mockResolvedValue({ rows: [candidateRow('ipo-1'), candidateRow('ipo-2')] });
    walkFieldPlanForIPOMock
      .mockImplementationOnce(async (ipoId: string) =>
        walkResult({
          ipoId,
          droppedWrites: [{ tableName: 'ipos', rowKey: ipoId, fieldName: 'lotSize', source: 'NSE', skipReason: 'CHECK_FAILED' }],
        })
      )
      .mockImplementationOnce(async (ipoId: string) =>
        walkResult({
          ipoId,
          droppedWrites: [{ tableName: 'ipos', rowKey: ipoId, fieldName: 'issueSize', source: 'BSE', skipReason: 'CHECK_FAILED' }],
        })
      );

    await runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 });

    const payload = summaryPayload();
    expect(payload!.droppedWrites).toEqual([
      'ipo-1:ipos.lotSize (source=NSE, CHECK_FAILED)',
      'ipo-2:ipos.issueSize (source=BSE, CHECK_FAILED)',
    ]);
  });

  // The cap boundary (#727 item 2): 12 IPOs x 5 dropped writes each = 60 real
  // drops in the cycle, spread the way a real cycle spreads them (a handful
  // of fields per IPO, never one IPO dumping 50+ at once). The per-IPO guard
  // (`if (droppedWriteLines.length < MAX_WALK_IDENTITY_LINES)`) checks the
  // running total BEFORE each IPO's batch, so 5-per-IPO lands exactly on the
  // 50-line cap after IPO #10 (45 + 5 = 50) and IPOs #11-12 contribute
  // nothing further — the summary array has exactly 50 entries, not 60, and
  // the cycle does not throw.
  it('caps the aggregated identity lines at 50 across many IPOs, never throwing or growing past it', async () => {
    hasFetchers = true;
    const ipoIds = Array.from({ length: 12 }, (_, i) => `ipo-${i + 1}`);
    dbExecuteMock.mockResolvedValue({ rows: ipoIds.map((id) => candidateRow(id)) });

    for (const ipoId of ipoIds) {
      walkFieldPlanForIPOMock.mockImplementationOnce(async () =>
        walkResult({
          ipoId,
          droppedWrites: Array.from({ length: 5 }, (_, j) => ({
            tableName: 'ipos',
            rowKey: ipoId,
            fieldName: `field${j}`,
            source: 'NSE',
            skipReason: 'CHECK_FAILED',
          })),
        })
      );
    }

    await expect(runDocumentCycle({ wakeBudgetMs: 30 * 60 * 1000 })).resolves.not.toThrow();

    const payload = summaryPayload();
    expect(payload).toBeDefined();
    expect(Array.isArray(payload!.droppedWrites)).toBe(true);
    expect((payload!.droppedWrites as unknown[]).length).toBe(50);
  });
});
