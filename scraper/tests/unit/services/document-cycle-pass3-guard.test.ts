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
}));

vi.mock('@ipodhan/shared/repositories', () => ({
  IpoFieldPlanRepository: vi.fn().mockImplementation(() => ({
    claimNextDueField: (...args: unknown[]) => claimNextDueFieldMock(...args),
    recordOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
    releaseClaimUnrecorded: (...args: unknown[]) => releaseClaimUnrecordedMock(...args),
  })),
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  recordBseDiscoveryMetadata: vi.fn().mockResolvedValue(undefined),
  recordDocumentSourceHints: vi.fn().mockResolvedValue(undefined),
  recordDiscoveredLeadManagers: vi.fn().mockResolvedValue(undefined),
}));

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
vi.mock('../../../src/services/field-plan-walk-deps.js', () => ({
  buildFieldPlanWalkFetchers: (...args: unknown[]) => buildFieldPlanWalkFetchersMock(...args),
  buildFieldPlanWalkOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: vi.fn(),
    consolidatedUpsertChildRows: vi.fn(),
  })),
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
});
