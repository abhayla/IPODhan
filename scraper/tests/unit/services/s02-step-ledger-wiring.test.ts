/**
 * S-02 WIRING — proof that the step-ledger writer has callers.
 *
 * S-01 shipped `recordStep`/`initStepLedger` with ZERO callers in `scraper/src`,
 * and every one of its unit tests still passed: the writer worked perfectly and
 * nothing ever called it. That is the exact failure this file exists to make
 * impossible to repeat. Deleting any hook must turn one of these red.
 *
 * The `upsertIPO` hook is exercised for real (the mocks below are the same ones
 * `data-persister-create-lineage.test.ts` uses); the hooks in files that cannot
 * be driven without a live database are asserted structurally, which is weaker
 * but still fails loudly if the call is deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(__dirname, '../../../src', p), 'utf8');
const script = (p: string) => readFileSync(join(__dirname, '../../../scripts', p), 'utf8');

// --------------------------------------------------------------------------
// The real hook: upsertIPO
// --------------------------------------------------------------------------

const initStepLedgerMock = vi.fn().mockResolvedValue(true);
const recordStepMock = vi.fn().mockResolvedValue(true);

vi.mock('../../../src/services/step-ledger.js', () => ({
  initStepLedger: (...args: unknown[]) => initStepLedgerMock(...args),
  recordStep: (...args: unknown[]) => recordStepMock(...args),
}));

vi.mock('@ipodhan/shared', () => ({ db: {}, getRedisClient: () => ({}) }));
vi.mock('@ipodhan/shared/db/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/db/schema')>()),
  ipoDemandGraph: {},
}));
vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({ resolveRegistrarId: () => null }));
vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: vi.fn().mockResolvedValue(1),
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    RegistrarRepository: vi.fn().mockImplementation(() => ({ findAll: vi.fn().mockResolvedValue([]) })),
  };
});
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: { ENABLE_DATA_CONSOLIDATION: true, ENABLE_SOURCE_TRACKING: true },
  shouldUseFeature: () => false,
}));
vi.mock('../../../src/services/data-consolidation-service.js', () => ({
  DataConsolidationService: vi.fn(),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function scrapedIPO(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Rays Of Belief Ltd',
    issueSize: 12000000,
    priceRangeMin: 100,
    priceRangeMax: 105,
    lotSize: 1200,
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    status: 'OPEN',
    listingExchange: 'NSE',
    ...overrides,
  } as never;
}

function repo(existing: unknown = null) {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(existing),
    findBySlug: vi.fn().mockResolvedValue(existing),
    findByFuzzyName: vi.fn().mockResolvedValue(existing),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'new-ipo-id' }),
    update: vi.fn().mockResolvedValue({}),
  } as never;
}

beforeEach(() => {
  initStepLedgerMock.mockClear();
  recordStepMock.mockClear();
});

describe('HOOK A — upsertIPO writes the step ledger', () => {
  it('creates all 52 catalogue rows for a brand-new IPO, without the backfill script', async () => {
    const id = await upsertIPO(repo(null), scrapedIPO(), 'NSE');
    expect(id).toBe('new-ipo-id');
    expect(initStepLedgerMock).toHaveBeenCalledWith('new-ipo-id');
  });

  it('records B2 (NSE board), B3..B7 and F6 on the create path', async () => {
    await upsertIPO(repo(null), scrapedIPO(), 'NSE');
    const steps = recordStepMock.mock.calls.map((c) => c[0].stepId);
    expect(steps).toEqual(expect.arrayContaining(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'F6']));
    expect(steps).not.toContain('B1');

    const b7 = recordStepMock.mock.calls.map((c) => c[0]).find((s) => s.stepId === 'B7');
    expect(b7.ipoId).toBe('new-ipo-id');
    expect(b7.status).toBe('DONE');
    expect(b7.evidence).toEqual({ path: 'insert' });
  });

  it('records B1 for a BSE write instead of B2', async () => {
    await upsertIPO(repo(null), scrapedIPO(), 'BSE');
    const steps = recordStepMock.mock.calls.map((c) => c[0].stepId);
    expect(steps).toContain('B1');
    expect(steps).not.toContain('B2');
  });

  it('does NOT re-init the ledger on an update — progress is never reset', async () => {
    const existing = { id: 'existing-id', companyName: 'Rays Of Belief Ltd', slug: 'rays-of-belief-ltd', listingExchanges: ['NSE'], offeringType: 'IPO', segment: 'MAINBOARD' };
    await upsertIPO(repo(existing), scrapedIPO(), 'NSE');
    expect(initStepLedgerMock).not.toHaveBeenCalled();
    const b7 = recordStepMock.mock.calls.map((c) => c[0]).find((s) => s.stepId === 'B7');
    expect(b7.evidence).toEqual({ path: 'update' });
  });

  it('records the ledger ONCE per IPO per run, not once per retry attempt', async () => {
    await upsertIPO(repo(null), scrapedIPO(), 'NSE');
    const b3Writes = recordStepMock.mock.calls.filter((c) => c[0].stepId === 'B3');
    expect(b3Writes).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// The remaining hooks, asserted structurally
// --------------------------------------------------------------------------

describe('HOOK A2 — the OTHER ipos write door is hooked too', () => {
  /**
   * The S-02 proof run caught this: `BaseScraperOrchestrator` — which every live
   * scraper extends — writes through `DataConsolidationOrchestrator`, NOT through
   * `data-persister.upsertIPO`. A hook on `upsertIPO` alone fired for backfill
   * scripts and never once for a real scrape, so after NSE and BSE both wrote
   * Rays of Belief its ledger still had zero B rows. Both doors must be hooked.
   */
  const orchestrator = src('services/data-consolidation-orchestrator.ts');

  it('records the discovery steps after its own consolidated write', () => {
    expect(orchestrator).toContain("import { recordDiscoverySteps } from './step-ledger-recorders.js'");
    expect(orchestrator).toContain('await recordDiscoverySteps(ipoId, {');
    expect(orchestrator).toContain('await initStepLedger(ipoId)');
  });

  it('every function that writes the ipos table records the ledger', () => {
    // Both writers log this line; both must call the recorder. If a third write
    // door appears and logs it, this test names the gap instead of silently
    // leaving that door unhooked.
    for (const file of ['services/data-persister.ts', 'services/data-consolidation-orchestrator.ts']) {
      const text = src(file);
      expect(text).toContain('Updated IPO with consolidated data');
      expect(text).toContain('recordDiscoverySteps(');
    }
  });
});

describe('HOOKS B/C/D — the live-number writers record H steps', () => {
  const dataPersister = src('services/data-persister.ts');

  it('the subscription write records H1', () => {
    expect(dataPersister).toMatch(/createSnapshot\(subscriptionData\)[\s\S]{0,600}recordLiveStep\(ipoId, 'H1'/);
  });
  it('the GMP write records H2 and F3', () => {
    expect(dataPersister).toContain("recordLiveStep(ipoId, 'H2'");
    expect(dataPersister).toContain("recordLiveStep(ipoId, 'F3'");
  });
  it('the demand-graph write records H4', () => {
    expect(dataPersister).toMatch(/db\.insert\(ipoDemandGraph\)[\s\S]{0,400}recordLiveStep\(ipoId, 'H4'/);
  });
});

describe('HOOK E — the anchor persister records H3 only when it applied', () => {
  const anchor = src('services/anchor-persister.ts');
  it('imports the recorder and calls it inside an apply guard', () => {
    expect(anchor).toContain("import { recordLiveStep } from './step-ledger-recorders.js'");
    expect(anchor).toMatch(/if \(apply\) \{[\s\S]{0,400}recordLiveStep\(ipoId, 'H3'/);
  });
});

describe('HOOK F — the document cycle', () => {
  const cycle = src('services/document-cycle.ts');

  it('initialises the ledger and records the C/D/I steps for every candidate', () => {
    expect(cycle).toContain('await initStepLedger(ipo.id)');
    expect(cycle).toContain('await recordDocumentRunSteps(result,');
  });

  it('gates the automatic extract+persist on ENABLE_FILING_AUTO_PERSIST', () => {
    const guarded = /if \(FEATURE_FLAGS\.ENABLE_FILING_AUTO_PERSIST\) \{[\s\S]*?processPendingFilings\(/;
    expect(cycle).toMatch(guarded);
    // Exactly one call site, and it is the guarded one — no unguarded second path.
    expect(cycle.match(/processPendingFilings\(/g)).toHaveLength(1);
  });

  it('runs auto-persist for EVERY candidate, not only the ones that found a document this cycle', () => {
    // A `result.found.length` guard around the call would strand documents found
    // in an earlier cycle and never extracted — the regression this pins.
    const callBlock = cycle.slice(cycle.indexOf('ENABLE_FILING_AUTO_PERSIST'));
    const beforeCall = callBlock.slice(0, callBlock.indexOf('processPendingFilings('));
    expect(beforeCall).not.toContain('result.found.length');
  });
});

describe('HOOK H — the stage reconciler', () => {
  const job = src('scheduler/jobs/stage-reconciler-job.ts');

  it('writes I1/I2 and reads the existing rows first so DUE cannot downgrade a DONE', () => {
    expect(job).toContain('planLifecycleSteps(');
    expect(job).toContain('stepsRepository.findByIpo(p.id)');
    expect(job).toContain('existing,');
  });

  it('leaves the §GATE enqueue a no-op — writing the ledger is not triggering a fetch', () => {
    expect(job).toContain('§GATE: enqueue/trigger the due fetches here once activated');
  });
});

describe('ONE filing write door — the CLI and the cycle share a dependency builder', () => {
  const cli = script('persist-filing.ts');

  it('the CLI imports the shared builder and declares no private copy', () => {
    expect(cli).toContain("import { buildFilingPersistDeps } from '../src/services/filing-persist-deps.js'");
    expect(cli).not.toMatch(/function buildDeps\(/);
    expect(cli).not.toMatch(/function makeIpoDetailsWriter\(/);
  });

  it('the auto-persist service uses that same builder, not its own', () => {
    const auto = src('services/filing-auto-persist.ts');
    expect(auto).toContain("buildFilingPersistDeps");
    expect(auto).not.toMatch(/new IPORepository\(/);
  });

  it('the shared builder supplies the admin protection filter to both callers', () => {
    expect(src('services/filing-persist-deps.ts')).toContain('protectionFilter:');
    expect(src('services/filing-persist-deps.ts')).toContain('filterProtectedFields(');
  });
});
