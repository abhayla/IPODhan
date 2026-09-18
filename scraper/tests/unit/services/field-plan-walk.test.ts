// implements: item 6 -- the pull walk over ipo_field_plan (design §2.4, §2.2)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  walkFieldPlanForIPO,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { logger } from '../../../src/utils/logger.js';
import {
  fieldResult,
  consolidatedUpsertResultFixture,
  consolidatedChildRowsResultFixture,
} from '../../helpers/consolidation-result-fixture.js';

/**
 * Item 6 -- the walk that asks ONE field at a time and commits each field's
 * outcome before attempting the next.
 *
 * THE CLASS these guard (every one of them is SILENT in production if wrong):
 *
 *  (a) A write that was DROPPED recorded as SUPPLIED. `consolidatedUpsertIPO`
 *      returns `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'` with no throw
 *      and no log the walk sees. A plan row marked SUPPLIED against a write
 *      that never happened is a false-clean state EVERY downstream check --
 *      coverage gate, PULL-NOOP, the staging read -- reads as success.
 *
 *  (b) A `recordOutcome` REFUSAL ignored. The repository returns
 *      `{ written: false, reason: 'CLAIM_SUPERSEDED' }` rather than throwing.
 *      A caller that does not read the return counts an outcome that was
 *      never persisted, and the walk's own tallies then describe work that
 *      does not exist in the table.
 *
 *  (c) An outcome branch with NO `recordOutcome` call at all. A field claimed
 *      and never recorded keeps `claimed_at` set until the staleness window
 *      expires -- the exact "row left with a non-null claimed_at" the staging
 *      proof reads as a crashed walk.
 *
 *  (d) A budget check that never fires. The walk shares ONE wake budget with
 *      discovery and extraction; a walk that does not stop starves the purge
 *      step that runs after it in the same wake.
 *
 * Covers BOTH row shapes the plan can hold: the singleton `row_key` '' rows
 * (`ipo_details`) and keyed rows (`financial_statements`, fiscal-year key),
 * because the two take different write paths (`consolidatedUpsertIPO` vs
 * `consolidatedUpsertChildRows`) and only one of them was wired first.
 */

const IPO_ID = '00000000-0000-4000-8000-0000000660a1';

type PlanRowOverrides = Partial<{
  id: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  attempts: number;
}>;

let rowSeq = 0;

function planRow(overrides: PlanRowOverrides = {}) {
  rowSeq += 1;
  return {
    id: `plan-${rowSeq}`,
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'issue_size',
    rank1Source: 'NSE',
    rank2Source: 'BSE',
    rank3Source: null,
    state: 'PENDING' as const,
    chosenSource: null,
    chosenRank: null,
    chosenDocumentId: null,
    chosenDocumentType: null,
    chosenSha256: null,
    chosenPage: null,
    attempts: 0,
    lastAttemptAt: null,
    nextDueAt: null,
    claimedAt: new Date(),
    claimToken: `token-${rowSeq}`,
    manifestVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A repository stub that hands out a fixed queue of rows, one per claim. */
function makeRepo(queue: ReturnType<typeof planRow>[]) {
  const recorded: any[] = [];
  const released: any[] = [];
  // Tracked so the test-default `resolvePolicy` (below) can echo the ranks of whichever row
  // `walkFieldPlanForIPO` most recently claimed -- see echoPlanRanksAsPolicy's doc comment.
  const lastClaimed: { current: any } = { current: null };
  return {
    recorded,
    released,
    lastClaimed,
    claimNextDueField: vi.fn(async () => {
      const row = queue.shift() ?? null;
      lastClaimed.current = row;
      return row;
    }),
    recordOutcome: vi.fn(async (params: any) => {
      recorded.push(params);
      return { written: true, row: undefined };
    }),
    releaseClaimUnrecorded: vi.fn(async (params: any) => {
      released.push(params);
      return { released: true };
    }),
  };
}

/**
 * Review round 5, item A: the walk now records SUPPLIED only when the
 * consolidator's OWN result agrees -- `chosenSource` matches the source the
 * walk supplied from and `finalValue` matches the supplied value (never
 * trust the absence of `skipped: true` as agreement). To keep the ~15
 * PRE-EXISTING tests exercising unrelated behaviour (budget, claim
 * supersession, protection, resume) green without a per-call-site rewrite,
 * the DEFAULT mock echoes back whatever field/value/source it was actually
 * called with -- a real "the consolidator agreed" answer, not a blank
 * passthrough. A test that wants to exercise DISAGREEMENT passes an
 * explicit `ipoResult`/`childResult` (or `fieldResultsOverride`), which
 * takes priority over the echo.
 */
function makeOrchestrator(
  ipoResult?: any,
  childResult?: any
) {
  const consolidatedUpsertIPO = vi.fn(async (scraped: any, source: any, _confidence?: any, _preResolved?: any, onlyFields?: string[]) => {
    if (ipoResult !== undefined) return ipoResult;
    const field = onlyFields?.[0];
    return consolidatedUpsertResultFixture({
      ipoId: IPO_ID,
      fieldResults: field ? [fieldResult(field, scraped[field], source)] : [],
    });
  });
  const consolidatedUpsertChildRows = vi.fn(async (_ipoId: string, _tableName: any, rows: any[], source: any) => {
    if (childResult !== undefined) return childResult;
    const row = rows[0];
    const field = Object.keys(row.data)[0];
    return consolidatedChildRowsResultFixture(row.rowKey, [fieldResult(field, row.data[field], source)], {
      consolidatedData: row.data,
    });
  });
  return { consolidatedUpsertIPO, consolidatedUpsertChildRows };
}

const supplied: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 10, documentType: 'RHP', page: 4 });
const notPrinted: FieldFetcher = async () => ({ outcome: 'NOT_PRINTED' });
const checkFailed: FieldFetcher = async () => ({ outcome: 'CHECK_FAILED', reason: 'regex did not match' });

/** A resolved IPO row with the identity fields consolidatedUpsertIPO's
 *  unconditional computeIpoIdentitySlug() call and the pre-resolved-row
 *  contract both need. */
function makeExistingIpo(overrides: Record<string, unknown> = {}) {
  return {
    id: IPO_ID,
    companyName: 'Test Company Limited',
    symbol: 'TESTCO',
    isin: 'INE000A00001',
    offeringType: 'IPO',
    openDate: '2026-09-01',
    closeDate: '2026-09-03',
    priceRangeMin: 100,
    segment: 'MAINBOARD',
    ...overrides,
  };
}

function makeIpoRepository(existing: unknown = makeExistingIpo()) {
  return { findById: vi.fn(async () => existing) };
}

/**
 * item 3 slice S1a: production resolves the ask order from ONE
 * `resolvePolicy` call per field per walk, never from the plan row's own
 * rank columns. These ~15 PRE-EXISTING tests build their fixtures the OLD
 * way (`planRow({ rank1Source, ... })`) and exercise unrelated behaviour
 * (budget, claim supersession, protection, resume) -- rewriting every one of
 * them to also stub `resolvePolicy` would be pure churn with no coverage
 * gain. So the default test-only `resolvePolicy` below reads whichever row
 * `repo.lastClaimed` names (the one `attemptOneField` is currently
 * processing -- `makeRepo`'s `claimNextDueField` stub records it) and echoes
 * ITS rank columns back as the policy's ranks. Production's real default
 * (`defaultResolvePolicy`, the manifest resolver) is untouched -- only this
 * test file's harness changes. A test that wants to prove the walk actually
 * FOLLOWS the resolver (not the plan row) passes an explicit `resolvePolicy`
 * override via `deps({ resolvePolicy })`, which wins.
 */
function echoPlanRanksAsPolicy(repo: ReturnType<typeof makeRepo>) {
  return () => {
    const row = repo.lastClaimed.current;
    // A null in the MIDDLE (rank1 absent, rank2 present) is a real manifest shape (§2.3.5:
    // "no source at this rank for this type"), so nulls are preserved positionally -- only a
    // trailing run of nulls is trimmed, matching how generateFieldPlan itself never plans a
    // rank2/rank3 without a rank1 value from the SAME manifest array.
    const raw: (string | null)[] = row ? [row.rank1Source, row.rank2Source, row.rank3Source] : [];
    while (raw.length > 0 && raw[raw.length - 1] == null) raw.pop();
    return {
      ranks: raw as any,
      documentType: undefined,
      origin: { kind: 'registry' as const, version: 1 },
      na: false,
    };
  };
}

function deps(over: Partial<FieldPlanWalkDeps> = {}): FieldPlanWalkDeps {
  const repo = (over.fieldPlanRepository as ReturnType<typeof makeRepo> | undefined) ?? makeRepo([]);
  return {
    fieldPlanRepository: repo as any,
    orchestrator: makeOrchestrator() as any,
    sourceFetchers: { NSE: supplied, BSE: supplied, CHITTORGARH: supplied } as any,
    ipoRepository: makeIpoRepository() as any,
    resolvePolicy: echoPlanRanksAsPolicy(repo) as any,
    ...over,
  } as FieldPlanWalkDeps;
}

/** A budget that never expires. */
function openBudget() {
  return { deadlineMs: 1_000_000, now: () => 0 };
}

beforeEach(() => {
  rowSeq = 0;
});

describe('field-plan walk -- the SUPPLIED path', () => {
  it('records SUPPLIED with rank-1 evidence and writes through the IPO path exactly once', async () => {
    const repo = makeRepo([planRow()]);
    const orch = makeOrchestrator();
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].writeHappened).toBe(true);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
    expect(repo.recorded[0].chosen.source).toBe('NSE');
    expect(repo.recorded[0].chosen.rank).toBe(1);
    expect(result.fieldsSupplied).toBe(1);
    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');
  });

  it('writes a KEYED row (financial_statements, fiscal-year row_key) through the child-row path', async () => {
    const repo = makeRepo([
      planRow({ tableName: 'financial_statements', rowKey: 'FY2025', fieldName: 'revenue' }),
    ]);
    const orch = makeOrchestrator();
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertChildRows).toHaveBeenCalledTimes(1);
    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    const [, tableName, rows] = orch.consolidatedUpsertChildRows.mock.calls[0];
    expect(tableName).toBe('financial_statements');
    expect(rows[0].rowKey).toBe('FY2025');
    expect(repo.recorded[0].state).toBe('SUPPLIED');
  });

  it('passes evidence as ONE complete object, never a partial merge onto stale columns', async () => {
    const repo = makeRepo([planRow()]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => ({ outcome: 'SUPPLIED', value: 1, documentId: undefined, sha256: 'abc' }),
      } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    const chosen = repo.recorded[0].chosen;
    // Every one of the six evidence keys is present on the object handed to
    // recordOutcome -- absent facts are explicit nulls, not omitted keys that
    // would leave a previous source's document/sha256 standing.
    for (const key of ['source', 'rank', 'documentId', 'documentType', 'sha256', 'page']) {
      expect(Object.prototype.hasOwnProperty.call(chosen, key)).toBe(true);
    }
    expect(chosen.documentId).toBeNull();
  });
});

describe('field-plan walk -- the dropped-write branch (the false-clean-state guard)', () => {
  it('leaves the row PENDING with attempts UNTOUCHED when the write returns skipped', async () => {
    const repo = makeRepo([planRow()]);
    const orch = makeOrchestrator({
      ipoId: '',
      isNew: false,
      locked: false,
      skipped: true,
      skipReason: 'LOCK_NOT_ACQUIRED',
    });
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(1);
    // writeHappened:false is the repository's own contract for "state stays
    // PENDING, attempts untouched, only the claim released".
    expect(repo.recorded[0].writeHappened).toBe(false);
    expect(repo.recorded[0].skipReason).toBe('LOCK_NOT_ACQUIRED');
    expect(repo.recorded[0].state).toBeUndefined();
    expect(repo.recorded[0].chosen).toBeUndefined();
    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsWriteSkipped).toBe(1);
    // Review round 2 (signal-ownership R1: a count is not a reading) — the
    // dropped write must be identifiable, not just counted.
    expect(result.droppedWrites).toEqual([
      { tableName: 'ipos', rowKey: '', fieldName: 'issue_size', source: 'NSE', skipReason: 'LOCK_NOT_ACQUIRED' },
    ]);
  });

  it('treats a skipped CHILD-ROW write the same way (both row shapes, one rule)', async () => {
    const repo = makeRepo([
      planRow({ tableName: 'financial_statements', rowKey: 'FY2025', fieldName: 'revenue' }),
    ]);
    const orch = makeOrchestrator(undefined, {
      rowsProcessed: 1,
      rowsUpdated: 0,
      rowsSkipped: 1,
      conflictsDetected: 0,
      rows: [
        {
          rowKey: 'FY2025',
          consolidatedData: {},
          fieldsProcessed: 0,
          fieldsUpdated: 0,
          conflictsDetected: 0,
          skipped: true,
          skipReason: 'MISSING_ROW_KEY',
        },
      ],
    });
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded[0].writeHappened).toBe(false);
    expect(repo.recorded[0].skipReason).toBe('MISSING_ROW_KEY');
    expect(result.fieldsWriteSkipped).toBe(1);
  });
});

describe('field-plan walk -- rank fallback', () => {
  it('rank 1 NOT_PRINTED then rank 2 SUPPLIED: credits rank 2, records no error for rank 1', async () => {
    const repo = makeRepo([planRow()]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: notPrinted, BSE: supplied } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
    expect(repo.recorded[0].chosen.source).toBe('BSE');
    expect(repo.recorded[0].chosen.rank).toBe(2);
  });

  it('every rank DEFINITIVELY CHECK_FAILED: records EXHAUSTED once, and never writes a value', async () => {
    const repo = makeRepo([planRow({ rank3Source: 'CHITTORGARH' })]);
    const orch = makeOrchestrator();
    const definitive: FieldFetcher = async () => ({
      outcome: 'CHECK_FAILED',
      reason: 'the page parsed and the field is not in it',
      transient: false,
    });
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: orch as any,
      sourceFetchers: { NSE: definitive, BSE: definitive, CHITTORGARH: definitive } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(orch.consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(repo.recorded).toHaveLength(1);
    // EXHAUSTED is TERMINAL. It is only correct when every source ANSWERED.
    expect(repo.recorded[0].state).toBe('EXHAUSTED');
    expect(result.fieldsExhausted).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);
    // Review round 2 (signal-ownership R1): an EXHAUSTED field must be
    // identifiable, not just counted — this is exactly the class RCA2's 13
    // wrongly-retired rows sat in.
    expect(result.exhaustedFields).toEqual([{ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' }]);
  });

  it('a null rank source is skipped, not fetched (the IPO type has no source at that rank)', async () => {
    const repo = makeRepo([planRow({ rank1Source: null, rank2Source: 'BSE' })]);
    const nse = vi.fn(supplied);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, BSE: supplied } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(nse).not.toHaveBeenCalled();
    expect(repo.recorded[0].chosen.rank).toBe(2);
  });

  it('a source with no registered fetcher is a CHECK_FAILED for that rank, not a crash', async () => {
    const repo = makeRepo([planRow({ rank1Source: 'NO_SUCH_SOURCE', rank2Source: 'BSE' })]);
    const d = deps({ fieldPlanRepository: repo as any, sourceFetchers: { BSE: supplied } as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded[0].state).toBe('SUPPLIED');
    expect(repo.recorded[0].chosen.rank).toBe(2);
  });
});

describe('field-plan walk -- NOT_AVAILABLE_YET', () => {
  it('records NOT_AVAILABLE_YET and TRIES the lower rank for a provisional value (card 2.4)', async () => {
    const repo = makeRepo([planRow()]);
    const orch = makeOrchestrator();
    const bse = vi.fn(supplied);
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: orch as any,
      sourceFetchers: { NSE: async () => ({ outcome: 'NOT_AVAILABLE_YET' }), BSE: bse } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // The assertion the first version of this test was MISSING: it created
    // this spy and never checked it, so the walk's deviation from the card
    // (returning without trying rank 2) was codified instead of caught.
    expect(bse).toHaveBeenCalledTimes(1);
    expect(orch.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect(result.fieldsProvisional).toBe(1);

    // The ask STAYS OPEN: the state is the non-terminal NOT_AVAILABLE_YET,
    // never SUPPLIED -- a provisional value must not close the ask against a
    // figure we already know is second-best.
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].state).toBe('NOT_AVAILABLE_YET');
    expect(repo.recorded[0].writeHappened).toBe(true);
    expect(result.fieldsSupplied).toBe(0);
  });

  it('a provisional fetch that fails costs the value and nothing else', async () => {
    const repo = makeRepo([planRow()]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => ({ outcome: 'NOT_AVAILABLE_YET' }),
        BSE: async () => {
          throw new Error('provisional source down');
        },
      } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsProvisional).toBe(0);
    expect(repo.recorded[0].state).toBe('NOT_AVAILABLE_YET');
    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');
  });

  it('never re-asks the AUTHORITATIVE rank, nor any rank above it, as provisional', async () => {
    const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: 'CHITTORGARH' })]);
    // Rank 1 (above the authoritative rank) and rank 2 (the authoritative one
    // that just declined) are BOTH spies. The boundary this guards is
    // `> authoritativeRank`: it is the only thing stopping the provisional
    // loop re-asking the source that just said NOT_AVAILABLE_YET.
    const nse = vi.fn(async () => ({ outcome: 'NOT_PRINTED' }) as any);
    const bse = vi.fn(async () => ({ outcome: 'NOT_AVAILABLE_YET' }) as any);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, BSE: bse, CHITTORGARH: supplied } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // Rank 1 is asked once by the MAIN loop and never again.
    expect(nse).toHaveBeenCalledTimes(1);
    // THE assertion the first version of this test was missing: the
    // authoritative rank is asked EXACTLY ONCE. Asserting only that rank 1
    // was called once, and that a provisional was found, both stay true when
    // the boundary is widened to `>=` -- rank 2 gets re-asked, returns
    // NOT_AVAILABLE_YET again, and rank 3 still supplies. The old test was
    // green under the exact mutation it was named for.
    expect(bse).toHaveBeenCalledTimes(1);
    expect(result.fieldsProvisional).toBe(1);
  });

  it('asks each candidate rank at most once across the main and provisional loops', async () => {
    // The general form of the boundary, independent of which rank happens to
    // be authoritative: no source is ever consulted twice for one field.
    const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: 'CHITTORGARH' })]);
    const nse = vi.fn(async () => ({ outcome: 'NOT_AVAILABLE_YET' }) as any);
    const bse = vi.fn(async () => ({ outcome: 'NOT_PRINTED' }) as any);
    const chit = vi.fn(supplied);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, BSE: bse, CHITTORGARH: chit } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(nse).toHaveBeenCalledTimes(1);
    expect(bse).toHaveBeenCalledTimes(1);
    expect(chit).toHaveBeenCalledTimes(1);
  });

  // S1a review MAJOR-1: `tryProvisional`'s lower-rank ask order must come
  // from the RESOLVER's `policy.ranks`, never from `plan.rank1Source..` —
  // proven by deliberately making the plan row's OWN rank columns disagree
  // with the stubbed resolver's order and checking which one the provisional
  // loop actually followed.
  it('tryProvisional asks the RESOLVER order, not the plan row\'s own rank columns', async () => {
    // Plan row says NSE / BSE / CHITTORGARH (rank1..3). The stubbed resolver
    // disagrees: DOC (authoritative) / CHITTORGARH / BSE. If the provisional
    // loop read `plan.rank2Source`/`rank3Source` instead of `policy.ranks`,
    // it would ask BSE before CHITTORGARH -- the opposite of what the
    // resolver said.
    const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: 'CHITTORGARH' })]);
    const doc = vi.fn(async () => ({ outcome: 'NOT_AVAILABLE_YET' }) as any);
    const chit = vi.fn(async () => ({ outcome: 'SUPPLIED', value: 42 }) as any);
    const bse = vi.fn(async () => ({ outcome: 'SUPPLIED', value: 99 }) as any);
    const resolvePolicy = () => ({
      ranks: ['DOC', 'CHITTORGARH', 'BSE'] as any,
      documentType: undefined,
      origin: { kind: 'registry' as const, version: 2 },
      na: false,
    });
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { DOC: doc, CHITTORGARH: chit, BSE: bse } as any,
      resolvePolicy: resolvePolicy as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // The resolver's rank 2 (CHITTORGARH) is what actually got asked, and
    // won the provisional value -- rank 3 (BSE, resolver order) or the plan
    // row's own rank2Source (BSE) never got a chance.
    expect(chit).toHaveBeenCalledTimes(1);
    expect(bse).not.toHaveBeenCalled();
    expect(result.fieldsProvisional).toBe(1);
  });

  // Mutation proof (S1a review MAJOR-1): the test above is red when
  // `tryProvisional`'s ask order is reverted to `plan.rank1Source..` — run
  // manually to confirm the test can fail (see PR body "Fix round 1" section
  // for the red/green transcript), then the source is restored by hand.
});

describe('field-plan walk -- admin protection (§2.7: skip, do NOT store a state)', () => {
  it('releases the claim unrecorded and never calls recordOutcome', async () => {
    const repo = makeRepo([planRow({ fieldName: 'issuePrice' })]);
    const orch = makeOrchestrator();
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: orch as any,
      protectionFilter: async () => true,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.released).toHaveLength(1);
    expect(repo.released[0].planRowId).toBe('plan-1');
    expect(repo.recordOutcome).not.toHaveBeenCalled();
    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(result.fieldsSkippedProtected).toBe(1);
  });
});

describe('field-plan walk -- CLAIM_SUPERSEDED must be handled, never ignored', () => {
  it('does not count a refused recordOutcome as a supplied field, and stops the walk', async () => {
    const repo = makeRepo([planRow(), planRow()]);
    repo.recordOutcome = vi.fn(async () => ({ written: false, reason: 'CLAIM_SUPERSEDED' })) as any;
    const d = deps({ fieldPlanRepository: repo as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.outcomesRefused).toBe(1);
    // A superseded claim means another walker owns this IPO's plan now --
    // continuing would race it for every remaining field.
    expect(result.stoppedReason).toBe('CLAIM_SUPERSEDED');
    expect(repo.claimNextDueField).toHaveBeenCalledTimes(1);
  });

  it('counts a refusal on the SKIPPED branch too (the branch that records nothing else)', async () => {
    const repo = makeRepo([planRow()]);
    repo.recordOutcome = vi.fn(async () => ({ written: false, reason: 'CLAIM_SUPERSEDED' })) as any;
    const orch = makeOrchestrator({ ipoId: '', isNew: false, locked: false, skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' });
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.outcomesRefused).toBe(1);
    expect(result.stoppedReason).toBe('CLAIM_SUPERSEDED');
  });
});

describe('field-plan walk -- every branch records an outcome (no stranded claim)', () => {
  it('a fetcher that THROWS still records an outcome rather than abandoning the claim', async () => {
    const repo = makeRepo([planRow({ rank2Source: null })]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => {
          throw new Error('socket hang up');
        },
      } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(1);
    // A THROW is transient, so the field is NOT retired.
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsExhausted).toBe(0);
  });

  it('a WRITE that throws still records an outcome rather than abandoning the claim', async () => {
    const repo = makeRepo([planRow()]);
    const orch = makeOrchestrator();
    orch.consolidatedUpsertIPO = vi.fn(async () => {
      throw new Error('deadlock detected');
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].writeHappened).toBe(false);
    expect(repo.recorded[0].skipReason).toContain('deadlock');
  });

  it('records exactly one outcome per claimed field across a mixed five-field plan', async () => {
    const repo = makeRepo([planRow(), planRow(), planRow(), planRow(), planRow()]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: supplied, BSE: supplied } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(5);
    expect(new Set(repo.recorded.map((r: any) => r.planRowId)).size).toBe(5);
    // Every recorded outcome carries the token it was CLAIMED with -- a walk
    // that reused one token would write another field's row.
    for (const r of repo.recorded) {
      expect(r.claimToken).toMatch(/^token-\d+$/);
    }
  });
});

describe('field-plan walk -- a re-claimable row must not livelock the walk', () => {
  it('stops instead of re-claiming a row it just left PENDING (the dropped-write branch)', async () => {
    // The real claim SQL orders by next_due_at NULLS FIRST, so a row the walk
    // just released as PENDING is the very next row it claims. Found live
    // against the real repository: three integration tests timed out at 60s.
    const row = planRow();
    const repo = makeRepo([]);
    repo.claimNextDueField = vi.fn(async () => {
      repo.lastClaimed.current = row;
      return { ...row };
    }) as any;
    const orch = makeOrchestrator({ ipoId: '', isNew: false, locked: false, skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' });
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');
    expect(result.fieldsWriteSkipped).toBe(1);
    // Claimed twice at most: once to do the work, once to discover the only
    // row left due is the one it already handled.
    expect((repo.claimNextDueField as any).mock.calls.length).toBeLessThanOrEqual(2);
    // And the second claim was RELEASED, not left stuck.
    expect(repo.released).toHaveLength(1);
  });

  it('stops instead of re-claiming a row it just released as admin-protected', async () => {
    const row = planRow();
    const repo = makeRepo([]);
    repo.claimNextDueField = vi.fn(async () => {
      repo.lastClaimed.current = row;
      return { ...row };
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any, protectionFilter: async () => true });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');
    expect(result.fieldsSkippedProtected).toBe(1);
    expect((repo.claimNextDueField as any).mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('field-plan walk -- a transient failure must NOT retire a field (F1)', () => {
  it('survives THREE consecutive passes of all-ranks transient failure and is still due', async () => {
    // The defect this proves is gone: EXHAUSTED is in TERMINAL_STATES, so the
    // old code turned three network timeouts in one pass into a permanently
    // retired field. Nobody decided to retire it; a flaky minute did.
    const states: string[] = [];
    for (let pass = 1; pass <= 3; pass++) {
      const repo = makeRepo([planRow({ rank3Source: 'CHITTORGARH' })]);
      const d = deps({
        fieldPlanRepository: repo as any,
        sourceFetchers: {
          NSE: async () => {
            throw new Error('ETIMEDOUT');
          },
          BSE: async () => {
            throw new Error('socket hang up');
          },
          CHITTORGARH: async () => {
            throw new Error('503 from upstream');
          },
        } as any,
      });

      const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

      expect(result.fieldsExhausted).toBe(0);
      expect(result.fieldsCheckFailed).toBe(1);
      states.push(repo.recorded[0].state);
    }

    // CHECK_FAILED is deliberately NOT in the repository's TERMINAL_STATES,
    // so next_due_at is set to the backoff and the row stays askable. Three
    // bad passes cost delay, never the field.
    expect(states).toEqual(['CHECK_FAILED', 'CHECK_FAILED', 'CHECK_FAILED']);
  });

  it('a missing adapter is transient too — registering it must make the field askable again', async () => {
    const repo = makeRepo([planRow()]);
    const d = deps({ fieldPlanRepository: repo as any, sourceFetchers: {} as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
    expect(result.fieldsExhausted).toBe(0);
  });

  it('a CHECK_FAILED answer defaults to TRANSIENT when the fetcher does not say', async () => {
    // The two mistakes are not symmetric: a definitive failure treated as
    // transient costs a re-ask; a transient failure treated as definitive
    // costs the field forever. The default must be the recoverable one.
    const repo = makeRepo([planRow({ rank2Source: null })]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: async () => ({ outcome: 'CHECK_FAILED', reason: 'unclear' }) } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });

  it('ONE transient rank among definitive ones is enough to keep the field alive', async () => {
    const repo = makeRepo([planRow({ rank3Source: 'CHITTORGARH' })]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => ({ outcome: 'CHECK_FAILED', reason: 'not in the page', transient: false }),
        BSE: async () => ({ outcome: 'NOT_PRINTED' }),
        CHITTORGARH: async () => {
          throw new Error('ECONNRESET');
        },
      } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // Retirement requires EVERY source to have answered. One that did not
    // answer at all is enough to keep the ask open.
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
    expect(result.fieldsExhausted).toBe(0);
  });

  it('NOT_PRINTED from every rank is DEFINITIVE — that field really is retired', async () => {
    const repo = makeRepo([planRow({ rank3Source: 'CHITTORGARH' })]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: notPrinted, BSE: notPrinted, CHITTORGARH: notPrinted } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // The other arm: if nothing could ever reach EXHAUSTED the fix would have
    // replaced one wrong answer with another.
    expect(repo.recorded[0].state).toBe('EXHAUSTED');
    expect(result.fieldsExhausted).toBe(1);
  });
});

describe('field-plan walk -- a THROWING settle must not strand the claim (F4)', () => {
  it('releases the claim when recordOutcome throws, then propagates', async () => {
    const repo = makeRepo([planRow()]);
    repo.recordOutcome = vi.fn(async () => {
      throw new Error('field_sources unreachable: ECONNREFUSED');
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any });

    // The error still reaches document-cycle's per-IPO catch -- it is a real
    // failure and must not be swallowed -- but the row is released first.
    await expect(walkFieldPlanForIPO(IPO_ID, d, openBudget())).rejects.toThrow('ECONNREFUSED');

    expect(repo.released).toHaveLength(1);
    expect(repo.released[0].planRowId).toBe('plan-1');
    expect(repo.released[0].claimToken).toBe('token-1');
  });

  it('a release that ALSO throws is swallowed, so the original cause survives', async () => {
    const repo = makeRepo([planRow()]);
    repo.recordOutcome = vi.fn(async () => {
      throw new Error('the original cause');
    }) as any;
    repo.releaseClaimUnrecorded = vi.fn(async () => {
      throw new Error('the repair also failed');
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any });

    // The repair's error must never replace the real one.
    await expect(walkFieldPlanForIPO(IPO_ID, d, openBudget())).rejects.toThrow('the original cause');
  });

  it('a throwing protected-field release propagates instead of looking like a clean skip', async () => {
    const repo = makeRepo([planRow()]);
    repo.releaseClaimUnrecorded = vi.fn(async () => {
      throw new Error('release failed');
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any, protectionFilter: async () => true });

    await expect(walkFieldPlanForIPO(IPO_ID, d, openBudget())).rejects.toThrow('release failed');
  });
});

describe('field-plan walk -- every counter it reports has a consumer (signal-ownership R1/R3)', () => {
  it('the budget-exhaustion reading is COMPLETE, including the two that say the pass went badly', async () => {
    // A counter with no consumer is not detection, it is a variable. These
    // four were added by the F1/F3/F4 fixes and reached no log line and no
    // aggregate, so the single number distinguishing "healthy" from "every
    // field failing transiently forever" was invisible.
    const repo = makeRepo([planRow()]);
    const d = deps({ fieldPlanRepository: repo as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // The RESULT is the contract document-cycle's walkTotals sums. If a field
    // is dropped from it, the aggregate silently loses that signal.
    for (const key of [
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
    ]) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
      expect(typeof (result as any)[key]).toBe('number');
    }
  });

  it('fieldsCheckFailed is actually incremented — the health number is not always zero', async () => {
    // A counter that exists but can never move reads identical to a healthy
    // walk. This is the positive control for the F1 signal.
    const repo = makeRepo([planRow({ rank2Source: null })]);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => {
          throw new Error('ETIMEDOUT');
        },
      } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsCheckFailed).toBe(1);
  });

  it('outcomesFailed is actually incremented — the DB-unreachable signal can move', async () => {
    const repo = makeRepo([planRow()]);
    repo.recordOutcome = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    const d = deps({ fieldPlanRepository: repo as any });

    await expect(walkFieldPlanForIPO(IPO_ID, d, openBudget())).rejects.toThrow('ECONNREFUSED');
    // The throw carries the count out via the walk's own result object only
    // when it does not propagate; document-cycle's per-IPO catch is what sees
    // this case, so the assertion that matters here is that the counter moved
    // before the rethrow rather than after it.
    expect(repo.released).toHaveLength(1);
  });
});

describe('field-plan walk -- the shared wake budget', () => {
  it('stops after the field in flight when the deadline passes, leaving the rest unclaimed', async () => {
    const repo = makeRepo([planRow(), planRow(), planRow(), planRow(), planRow()]);
    let clock = 0;
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => {
          clock += 60;
          return { outcome: 'SUPPLIED', value: 1 } as any;
        },
      } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, { deadlineMs: 100, now: () => clock });

    expect(result.stoppedReason).toBe('BUDGET_EXHAUSTED');
    expect(repo.recorded).toHaveLength(2);
    // Fields 3-5 were never claimed -- nothing half-written, nothing to reclaim.
    expect(repo.claimNextDueField).toHaveBeenCalledTimes(2);
  });

  it('claims nothing at all when the budget is already spent before the first claim', async () => {
    const repo = makeRepo([planRow()]);
    const d = deps({ fieldPlanRepository: repo as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, { deadlineMs: 0, now: () => 5 });

    expect(repo.claimNextDueField).not.toHaveBeenCalled();
    expect(result.stoppedReason).toBe('BUDGET_EXHAUSTED');
    expect(result.fieldsAttempted).toBe(0);
  });

  it('a claim is always followed by an outcome -- no field is left holding a claim', async () => {
    const repo = makeRepo([planRow(), planRow(), planRow()]);
    let clock = 0;
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: {
        NSE: async () => {
          clock += 40;
          return { outcome: 'SUPPLIED', value: 1 } as any;
        },
      } as any,
    });

    await walkFieldPlanForIPO(IPO_ID, d, { deadlineMs: 100, now: () => clock });

    const claims = (repo.claimNextDueField as any).mock.calls.length;
    const settled = repo.recorded.length + repo.released.length;
    expect(settled).toBe(claims);
  });
});

// Review round 1, C1 (CRITICAL): plan.fieldName is the manifest's raw snake_case
// key ('issue_size'); consolidatedUpsertIPO/consolidatedUpsertChildRows expect
// camelCase (issueSize) -- data-consolidation-orchestrator.ts reads
// scrapedIPO.issueSize, never scrapedIPO['issue_size']. A snake_case write key
// writes NOTHING the orchestrator's mapper reads, while runWrite still sees no
// throw and no skipped:true -- so a dropped write is recorded as SUPPLIED, the
// exact false-clean-state class this module's own header warns about.
describe('field-plan walk -- writes the CAMELCASE key, never the plan row\'s raw snake_case key', () => {
  it('ipos (singleton) path: converts issue_size -> issueSize in the write payload', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' })]);
    const orch = makeOrchestrator();
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    const [payload, , , , onlyFields] = orch.consolidatedUpsertIPO.mock.calls[0];
    expect(payload).toHaveProperty('issueSize', 10);
    expect(payload).not.toHaveProperty('issue_size');
    // Review round 3 (MAJOR): the 5th arg narrows consolidation to exactly
    // the one field this write actually supplied — the identity fields
    // spread into the payload (review round 2, RCA1) are for the lock slug
    // and resolveIpoRow ONLY, never a claim this write is making.
    expect(onlyFields).toEqual(['issueSize']);
  });

  it('child-row (keyed) path: converts fresh_issue -> freshIssue in the row data', async () => {
    const repo = makeRepo([
      planRow({ tableName: 'ipo_details', rowKey: '', fieldName: 'fresh_issue' }),
    ]);
    const orch = makeOrchestrator();
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertChildRows).toHaveBeenCalledTimes(1);
    const [, , rows] = orch.consolidatedUpsertChildRows.mock.calls[0];
    expect(rows[0].data).toHaveProperty('freshIssue', 10);
    expect(rows[0].data).not.toHaveProperty('fresh_issue');
  });
});

// Review round 2, RCA1 (CRITICAL, staging wake 619660c3): `{ id: ipoId,
// [camelField]: value }` carries no identity fields (companyName, symbol,
// isin, ...), so consolidatedUpsertIPO's unconditional
// computeIpoIdentitySlug(scrapedIPO) call gets an undefined companyName and
// resolveIpoRow (never given a preResolvedIPO) resolves nothing -> CREATE
// path -> `Failed to create IPO` on a NOT NULL violation. Fixed: the walk
// loads the existing row once (IPORepository.findById, cached) and sends
// BOTH the identity fields off that row AND the row itself as the 4th
// (preResolvedIPO) argument, so consolidatedUpsertIPO can never independently
// re-resolve or fall into CREATE for an existing IPO.
describe('field-plan walk -- writes through the pre-resolved IPO identity (review round 2, RCA1)', () => {
  it('the ipos write payload carries the existing row\'s identity fields, and the 4th arg is the pre-resolved row', async () => {
    const existing = makeExistingIpo();
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' })]);
    const orch = makeOrchestrator();
    const ipoRepository = makeIpoRepository(existing);
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, ipoRepository: ipoRepository as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    const [payload, , , preResolvedIPO] = orch.consolidatedUpsertIPO.mock.calls[0];
    expect(payload.companyName).toBe(existing.companyName);
    expect(payload.symbol).toBe(existing.symbol);
    expect(payload.isin).toBe(existing.isin);
    expect(payload.issueSize).toBe(10);
    expect(preResolvedIPO).toBe(existing);
  });

  it('a stub orchestrator that THROWS when preResolvedIPO is absent only goes green with the fix', async () => {
    const existing = makeExistingIpo();
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' })]);
    const strictOrchestrator = {
      consolidatedUpsertIPO: vi.fn(async (scraped: any, source: any, _confidence: any, preResolvedIPO: any, onlyFields?: string[]) => {
        if (preResolvedIPO === undefined || preResolvedIPO === null) {
          throw new Error('consolidatedUpsertIPO called with no preResolvedIPO -- would re-resolve identity independently');
        }
        const field = onlyFields?.[0];
        return {
          ipoId: IPO_ID,
          isNew: false,
          locked: true,
          skipped: false,
          consolidation: field
            ? { fieldResults: [{ fieldName: field, finalValue: scraped[field], chosenSource: source, hadConflict: false }] }
            : undefined,
        };
      }),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const ipoRepository = makeIpoRepository(existing);
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: strictOrchestrator as any,
      ipoRepository: ipoRepository as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(1);
    expect(strictOrchestrator.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
  });

  // S1a review MINOR-1: `resolvePolicyForPlan` now resolves the IPO's type
  // BEFORE calling any `resolvePolicy` (its own `ipoType` argument requires
  // it), so a missing IPO row short-circuits there for EVERY caller,
  // including one with a `resolvePolicy` override that would not otherwise
  // have needed `findById`. That moves this test's failure point earlier
  // than `runWrite`'s own "ipo row missing" guard -- the CHECK_FAILED test
  // right below this one is the one that now exercises `runWrite`'s guard
  // directly (echoPlanRanksAsPolicy's ipoType input is simply never reached
  // when the row cannot be read at all).
  it('the existing IPO row missing (findById returns null) is caught at POLICY RESOLUTION, never reaches runWrite\'s own guard', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' })]);
    const orch = makeOrchestrator();
    const ipoRepository = makeIpoRepository(null);
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, ipoRepository: ipoRepository as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(repo.recorded).toHaveLength(1);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded[0].writeHappened).toBe(true);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });

  // S1a review MINOR-1: this test's `resolvePolicy` override
  // (`echoPlanRanksAsPolicy`) never calls `ipoRepository.findById` itself, so
  // the ABOVE test's null-row case is only reachable inside `runWrite`, past
  // policy resolution. With the REAL default resolver (no override), a
  // missing IPO row is caught EARLIER, in `resolvePolicyForPlan` itself,
  // before any rank is walked — proven here with `resolvePolicy` unset so
  // `defaultResolvePolicy` would run if reached at all (it must not be).
  it('with no resolvePolicy override, a missing IPO row is CHECK_FAILED from policy resolution — never falls back to MAINBOARD ranks', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'NSE', rank2Source: 'BSE' })]);
    const orch = makeOrchestrator();
    const ipoRepository = makeIpoRepository(null);
    const resolvePolicy = vi.fn();
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: orch as any,
      ipoRepository: ipoRepository as any,
      resolvePolicy: resolvePolicy as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // Never guessed MAINBOARD ranks and asked the resolver with them.
    expect(resolvePolicy).not.toHaveBeenCalled();
    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].writeHappened).toBe(true);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });
});

describe('field-plan walk -- one IPO-type read per walk, not per field (S1a review MINOR-2)', () => {
  it('findById for POLICY RESOLUTION is called exactly once for a walk over three fields of the same IPO', async () => {
    // All three fields answer NOT_PRINTED, so `runWrite` (which does its OWN
    // separate, unrelated `findById` for write identity, review round 2
    // RCA1) is never reached -- this isolates the ONE read this finding is
    // about: the memoized IPO-type lookup inside `resolvePolicyForPlan`.
    const repo = makeRepo([
      planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' }),
      planRow({ tableName: 'ipos', rowKey: '', fieldName: 'fresh_issue' }),
      planRow({ tableName: 'financial_statements', rowKey: 'FY2025', fieldName: 'revenue' }),
    ]);
    const existing = makeExistingIpo();
    const ipoRepository = makeIpoRepository(existing);
    // A stubbed `resolvePolicy` (no real manifest lookup needed for these
    // field names) that still runs through the REAL `resolvePolicyForPlan` /
    // `makeIpoTypeResolver` chain -- that chain is what calls
    // `ipoRepository.findById`, independent of which resolver answers the
    // rank query. The test-only `echoPlanRanksAsPolicy` harness bypasses
    // `findById` entirely, so this test must supply its own `resolvePolicy`
    // rather than use `deps()`'s default.
    const resolvePolicy = () => ({
      ranks: ['NSE'] as any,
      documentType: undefined,
      origin: { kind: 'registry' as const, version: 1 },
      na: false,
    });
    const d: FieldPlanWalkDeps = {
      fieldPlanRepository: repo as any,
      orchestrator: makeOrchestrator() as any,
      sourceFetchers: { NSE: notPrinted } as any,
      ipoRepository: ipoRepository as any,
      resolvePolicy: resolvePolicy as any,
    };

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsExhausted).toBe(3);
    expect(ipoRepository.findById).toHaveBeenCalledTimes(1);
  });
});

// Review round 5, item A (CRITICAL, 7 false-SUPPLIED rows on staging): the
// walk used to record SUPPLIED as soon as `consolidatedUpsertIPO` returned
// `skipped: false` -- but the consolidated writer can accept the WRITE
// (no lock/create error) while KEEPING a higher-priority source's already-
// stored value (T-453: CHITTORGARH outranks BSE for issue_size). The walk
// must read the consolidator's OWN `fieldResults` and only record SUPPLIED
// when `chosenSource`+`finalValue` actually match what THIS write supplied.
describe('field-plan walk -- records SUPPLIED only when the consolidator\'s OWN result agrees (review round 5, item A)', () => {
  it('WIN: chosenSource and finalValue match the supplied source/value -- SUPPLIED', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        consolidation: { fieldResults: [{ fieldName: 'issueSize', finalValue: 10, chosenSource: 'BSE', hadConflict: false }] },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
  });

  it('LOST-TO-PRIORITY: the matrix kept a different source\'s value (the exact staging class -- BSE lost to CHITTORGARH) -- CHECK_FAILED transient, never SUPPLIED', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        // The matrix kept CHITTORGARH's already-stored value over our BSE answer.
        consolidation: { fieldResults: [{ fieldName: 'issueSize', finalValue: 999, chosenSource: 'CHITTORGARH', hadConflict: true }] },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
    expect(repo.recorded[0].writeHappened).toBe(true);
    // Never carries `chosen` -- the field was NOT sourced from BSE.
    expect(repo.recorded[0].chosen).toBeUndefined();
  });

  it('MISSING RESULT (fallback/degenerate path with no fieldResults) -- CHECK_FAILED transient, cause "no field result returned"', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        // No `consolidation` at all -- the degenerate/fallback path.
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });

  it('DOC maps to DRHP for the agreement check: a DOC-sourced write whose consolidator result says chosenSource DRHP is a WIN, not a mismatch', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'DOC' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        consolidation: { fieldResults: [{ fieldName: 'issueSize', finalValue: 10, chosenSource: 'DRHP', hadConflict: false }] },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { DOC: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(1);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
  });

  it('CHILD-ROW path: the same lost-to-priority check applies to consolidatedUpsertChildRows\' per-row fieldResults', async () => {
    const repo = makeRepo([
      planRow({ tableName: 'financial_statements', rowKey: 'FY2025', fieldName: 'revenue', rank1Source: 'BSE' }),
    ]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(),
      consolidatedUpsertChildRows: vi.fn(async () => ({
        rowsProcessed: 1,
        rowsUpdated: 1,
        rowsSkipped: 0,
        conflictsDetected: 1,
        rows: [
          {
            rowKey: 'FY2025',
            consolidatedData: { revenue: 999 },
            fieldResults: [{ fieldName: 'revenue', finalValue: 999, chosenSource: 'CHITTORGARH', hadConflict: true }],
            fieldsProcessed: 1,
            fieldsUpdated: 1,
            conflictsDetected: 1,
            skipped: false,
          },
        ],
      })),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });
});

describe('field-plan walk -- the value-half of the guard is pinned by a mutation-provable test (review round 6, item 1)', () => {
  it('a DIFFERENT finalValue with the SAME chosenSource is still a LOSS -- CHECK_FAILED, cause names both values', async () => {
    // chosenSource DOES match (BSE) but finalValue does NOT (999 vs the
    // supplied 10) -- this is the exact case that stays green if the
    // `|| result.finalValue !== suppliedValue` half of the guard is ever
    // deleted, because `result.chosenSource !== wantedSource` alone would
    // read `false` and the row would be wrongly marked SUPPLIED.
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        consolidation: {
          fieldResults: [{ fieldName: 'issueSize', finalValue: 999, chosenSource: 'BSE', hadConflict: false }],
        },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const warnSpy = vi.spyOn(logger, 'warn');
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
    // The CHECK_FAILED cause (never persisted to the plan row -- only
    // logged, per PASS 3's existing convention) must name BOTH values so a
    // human reading the log can tell a value-mismatch loss from a
    // source-mismatch loss.
    const lostCall = warnSpy.mock.calls.find(
      (c: any) => typeof c[1] === 'string' && c[1].includes('LOST to a higher-priority source')
    );
    expect(lostCall).toBeDefined();
    expect((lostCall as any)[0].reason).toContain('999');
    expect((lostCall as any)[0].reason).toContain('10');
    warnSpy.mockRestore();
  });
});

describe('field-plan walk -- the win/loss comparison normalizes before comparing (review round 6, item 2: false loss)', () => {
  it('WIN: finalValue is the pg round-trip STRING form of the supplied number ("10.00" vs 10) -- SUPPLIED, not a false loss', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        // A NUMERIC(15,2) column round-trips as a string -- this is exactly
        // what data-consolidation-service.ts's CONFIRMED_UNTRACKED path
        // returns (finalValue: storedValue, chosenSource: incomingSource)
        // for a genuine win.
        consolidation: {
          fieldResults: [{ fieldName: 'issueSize', finalValue: '10.00', chosenSource: 'BSE', hadConflict: false }],
        },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
  });

  it('LOSS: finalValue is a genuinely DIFFERENT stored value ("1000.00" vs supplied 10) -- CHECK_FAILED, a real mismatch survives normalization', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', rank1Source: 'BSE' })]);
    const orch = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        consolidation: {
          fieldResults: [{ fieldName: 'issueSize', finalValue: '1000.00', chosenSource: 'BSE', hadConflict: true }],
        },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, sourceFetchers: { BSE: supplied } as any });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(repo.recorded[0].state).toBe('CHECK_FAILED');
  });
});

// implements: item 3 slice S1a -- the walk's ask order comes from ONE `resolvePolicy` call per
// field per walk (`policy.ranks`), never from the plan row's own rank columns.
describe('field-plan walk -- the resolver decides the ask order, not the plan row (item 3 S1a)', () => {
  it('asks CHITTORGARH before DOC when resolvePolicy is stubbed to a swapped order, even though the plan row says DOC, CHITTORGARH', async () => {
    // The plan row's OWN rank columns say DOC first -- if the walk built its ask order from
    // `plan.rank1Source`/`rank2Source` (the pre-S1a behaviour), it would ask DOC first and this
    // test would go red. Mutation check M1 (reviewer checklist): temporarily reverting the
    // walk's rank-build back to `plan.rank1Source` must fail this exact assertion.
    //
    // S3a (docs/design/s3a-collect-witnesses-plan.md): DOC is CHITTORGARH's rank 2 here, and
    // CHITTORGARH answers SUPPLIED at rank 1 -- under collect-all, rank 2 is still asked so its
    // answer can be logged alongside rank 1's, even though only rank 1's value gets written.
    // `doc` returning NOT_PRINTED WAS the assertion this test used to pin "the resolver's order
    // wins, not the plan row's" -- that is now pinned by `callOrder[0]` (CHITTORGARH answers
    // first) instead of by DOC never being called at all.
    const repo = makeRepo([planRow({ rank1Source: 'DOC', rank2Source: 'CHITTORGARH', rank3Source: null })]);
    const callOrder: string[] = [];
    const doc = vi.fn(async () => {
      callOrder.push('DOC');
      return { outcome: 'NOT_PRINTED' as const };
    });
    const chittorgarh = vi.fn(async () => {
      callOrder.push('CHITTORGARH');
      return { outcome: 'SUPPLIED' as const, value: 10 };
    });
    const resolvePolicy = vi.fn(() => ({
      ranks: ['CHITTORGARH', 'DOC'],
      documentType: 'PRICE_BAND_AD' as const,
      origin: { kind: 'registry' as const, version: 2 },
      na: false,
    }));
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { DOC: doc, CHITTORGARH: chittorgarh } as any,
      resolvePolicy: resolvePolicy as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(callOrder[0]).toBe('CHITTORGARH');
    expect(result.fieldsSupplied).toBe(1);
    expect(repo.recorded[0].chosen.source).toBe('CHITTORGARH');
    expect(repo.recorded[0].chosen.rank).toBe(1);
    // Mutation check M2 (reviewer checklist): dropping `policyOrigin` from the recorded
    // params must fail this assertion.
    expect(repo.recorded[0].policyOrigin).toBe('registry:2');
  });
});

describe('field-plan walk -- CRITICAL-1 fix (S4 review round 2): the DEFAULT resolver (no resolvePolicy override) is override-aware', () => {
  it('with no resolvePolicy override, an active deps.overrides row changes the ask order the walk actually uses -- proves the walk is wired to layer 2, not just the registry', async () => {
    // ipos.issue_size real MAINBOARD registry ranks are NSE-first (field-manifest.json).
    // An active override for (ipos, issue_size) reranks to CHITTORGARH-first. If the walk
    // is NOT wired to deps.overrides, this test asks NSE first and goes red on callOrder.
    const repo = makeRepo([planRow({ tableName: 'ipos', fieldName: 'issue_size', rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: null })]);
    const callOrder: string[] = [];
    const nse = vi.fn(async () => {
      callOrder.push('NSE');
      return { outcome: 'NOT_PRINTED' as const };
    });
    const chittorgarh = vi.fn(async () => {
      callOrder.push('CHITTORGARH');
      return { outcome: 'SUPPLIED' as const, value: 999 };
    });
    const overridesReader = {
      resolve: vi.fn(async (q: { table: string; column: string }) => {
        if (q.table === 'ipos' && q.column === 'issue_size') {
          return [{ id: 'ov-test-1', ranks: ['CHITTORGARH'], expiresAt: '2099-01-01T00:00:00.000Z', ipoScoped: false }];
        }
        return [];
      }),
    };
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, CHITTORGARH: chittorgarh } as any,
      overrides: overridesReader,
      resolvePolicy: undefined,
    } as any);

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(overridesReader.resolve).toHaveBeenCalled();
    expect(callOrder).toEqual(['CHITTORGARH']);
    expect(nse).not.toHaveBeenCalled();
    expect(result.fieldsSupplied).toBe(1);
    expect(repo.recorded[0].chosen.source).toBe('CHITTORGARH');
    expect(repo.recorded[0].policyOrigin).toBe('override:ov-test-1');
  });

  it('with no resolvePolicy override and NO active override row, the walk still resolves via the real registry (safe when the table is absent/empty -- unchanged prod behaviour)', async () => {
    // Real manifest MAINBOARD ranks for ipos.issue_size are DOC, CHITTORGARH (field-manifest.json)
    // -- DOC fails NOT_PRINTED here so the walk falls through to rank2 CHITTORGARH, proving the
    // FULL registry rank order (not just rank1) still drives the walk with no override active.
    const repo = makeRepo([planRow({ tableName: 'ipos', fieldName: 'issue_size', rank1Source: 'DOC', rank2Source: 'CHITTORGARH', rank3Source: null })]);
    const callOrder: string[] = [];
    const doc = vi.fn(async () => {
      callOrder.push('DOC');
      return { outcome: 'NOT_PRINTED' as const };
    });
    const chittorgarh = vi.fn(async () => {
      callOrder.push('CHITTORGARH');
      return { outcome: 'SUPPLIED' as const, value: 111 };
    });
    const overridesReader = { resolve: vi.fn(async () => []) };
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { DOC: doc, CHITTORGARH: chittorgarh } as any,
      overrides: overridesReader,
      resolvePolicy: undefined,
    } as any);

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(overridesReader.resolve).toHaveBeenCalled();
    expect(callOrder).toEqual(['DOC', 'CHITTORGARH']);
    expect(result.fieldsSupplied).toBe(1);
    expect(repo.recorded[0].chosen.source).toBe('CHITTORGARH');
    expect(repo.recorded[0].policyOrigin).toMatch(/^registry:/);
  });
});

/**
 * S3a -- collect every witness's answer; still write the rank-1 winner.
 *
 * docs/design/s3a-collect-witnesses-plan.md. attemptOneField's rank loop is
 * find-first today: the SUPPLIED branch RETURNS after rank 1, so a second
 * capable source is never asked. Consensus (S3b) needs every ranked source's
 * answer collected in the SAME pass; S3a only adds the collection plus one
 * log line -- the value written, its source, and every counter on
 * FieldPlanWalkResult must stay byte-identical to today.
 */
describe('field-plan walk -- S3a collects every witness answer (A1)', () => {
  it('two fetchers both SUPPLIED: both are collected (N=2, both source names), written value is rank 1s', async () => {
    const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: null })]);
    const nse = vi.fn(async () => ({ outcome: 'SUPPLIED' as const, value: 10 }));
    const bse = vi.fn(async () => ({ outcome: 'SUPPLIED' as const, value: 20 }));
    const infoSpy = vi.spyOn(logger, 'info');
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, BSE: bse } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    // Both witnesses were actually asked -- this is RED today because the
    // find-first loop returns after rank 1 and never calls the rank-2 fetcher.
    expect(nse).toHaveBeenCalledTimes(1);
    expect(bse).toHaveBeenCalledTimes(1);

    // The written value/source is unchanged: rank 1 (NSE), value 10.
    expect(result.fieldsSupplied).toBe(1);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
    expect(repo.recorded[0].chosen.source).toBe('NSE');
    expect(repo.recorded[0].chosen.rank).toBe(1);

    // The collection is logged with both source names, N=2.
    const collectLine = infoSpy.mock.calls.find(
      (call) => typeof call[1] === 'string' && call[1].includes('collected')
    );
    expect(collectLine).toBeDefined();
    const [meta] = collectLine as any;
    expect(meta.answers).toHaveLength(2);
    const sources = meta.answers.map((a: any) => a.source);
    expect(sources).toEqual(expect.arrayContaining(['NSE', 'BSE']));
    infoSpy.mockRestore();
  });
});

describe('field-plan walk -- S3a a later rank throwing does not flip a supplied field to failure (A2)', () => {
  it('rank 1 SUPPLIED, rank 2 THROWS: still SETTLED with rank 1s value, recorded state unchanged from the single-source case', async () => {
    const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: null })]);
    const nse = vi.fn(async () => ({ outcome: 'SUPPLIED' as const, value: 10 }));
    const bse = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: nse, BSE: bse } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(nse).toHaveBeenCalledTimes(1);
    expect(bse).toHaveBeenCalledTimes(1);

    // Exactly the single-source-case recorded shape: SUPPLIED, rank 1, no
    // trace of rank 2's throw in the counters that matter to downstream
    // consumers.
    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);
    expect(result.fieldsExhausted).toBe(0);
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].state).toBe('SUPPLIED');
    expect(repo.recorded[0].chosen.source).toBe('NSE');
    expect(repo.recorded[0].chosen.rank).toBe(1);
  });
});

describe('field-plan walk -- S3a behaviour-neutrality (A3, table-driven over outcome combinations)', () => {
  type Outcome =
    | { kind: 'SUPPLIED'; value: unknown }
    | { kind: 'NOT_PRINTED' }
    | { kind: 'CHECK_FAILED_TRANSIENT' }
    | { kind: 'CHECK_FAILED_DEFINITIVE' }
    | { kind: 'THROW' };

  function fetcherFor(outcome: Outcome): FieldFetcher {
    switch (outcome.kind) {
      case 'SUPPLIED':
        return async () => ({ outcome: 'SUPPLIED', value: outcome.value });
      case 'NOT_PRINTED':
        return async () => ({ outcome: 'NOT_PRINTED' });
      case 'CHECK_FAILED_TRANSIENT':
        return async () => ({ outcome: 'CHECK_FAILED', reason: 'timeout', transient: true });
      case 'CHECK_FAILED_DEFINITIVE':
        return async () => ({ outcome: 'CHECK_FAILED', reason: 'no field in page', transient: false });
      case 'THROW':
        return async () => {
          throw new Error('ECONNRESET');
        };
    }
  }

  const cases: Array<{
    name: string;
    rank1: Outcome;
    rank2: Outcome;
    expect: { state: string; fieldsSupplied: number; fieldsCheckFailed: number; fieldsExhausted: number; chosenSource?: string };
  }> = [
    {
      name: 'rank1 SUPPLIED, rank2 SUPPLIED -> rank1 wins, SUPPLIED',
      rank1: { kind: 'SUPPLIED', value: 1 },
      rank2: { kind: 'SUPPLIED', value: 2 },
      expect: { state: 'SUPPLIED', fieldsSupplied: 1, fieldsCheckFailed: 0, fieldsExhausted: 0, chosenSource: 'NSE' },
    },
    {
      name: 'rank1 NOT_PRINTED, rank2 SUPPLIED -> rank2 wins, SUPPLIED',
      rank1: { kind: 'NOT_PRINTED' },
      rank2: { kind: 'SUPPLIED', value: 2 },
      expect: { state: 'SUPPLIED', fieldsSupplied: 1, fieldsCheckFailed: 0, fieldsExhausted: 0, chosenSource: 'BSE' },
    },
    {
      name: 'rank1 SUPPLIED, rank2 THROW -> rank1 wins, SUPPLIED (A2 shape)',
      rank1: { kind: 'SUPPLIED', value: 1 },
      rank2: { kind: 'THROW' },
      expect: { state: 'SUPPLIED', fieldsSupplied: 1, fieldsCheckFailed: 0, fieldsExhausted: 0, chosenSource: 'NSE' },
    },
    {
      name: 'rank1 CHECK_FAILED (transient), rank2 SUPPLIED -> rank2 wins, SUPPLIED',
      rank1: { kind: 'CHECK_FAILED_TRANSIENT' },
      rank2: { kind: 'SUPPLIED', value: 2 },
      expect: { state: 'SUPPLIED', fieldsSupplied: 1, fieldsCheckFailed: 0, fieldsExhausted: 0, chosenSource: 'BSE' },
    },
    {
      name: 'rank1 NOT_PRINTED, rank2 NOT_PRINTED -> EXHAUSTED',
      rank1: { kind: 'NOT_PRINTED' },
      rank2: { kind: 'NOT_PRINTED' },
      expect: { state: 'EXHAUSTED', fieldsSupplied: 0, fieldsCheckFailed: 0, fieldsExhausted: 1 },
    },
    {
      name: 'rank1 THROW, rank2 NOT_PRINTED -> CHECK_FAILED (transient present)',
      rank1: { kind: 'THROW' },
      rank2: { kind: 'NOT_PRINTED' },
      expect: { state: 'CHECK_FAILED', fieldsSupplied: 0, fieldsCheckFailed: 1, fieldsExhausted: 0 },
    },
    {
      name: 'rank1 CHECK_FAILED (definitive), rank2 NOT_PRINTED -> EXHAUSTED (both definitive)',
      rank1: { kind: 'CHECK_FAILED_DEFINITIVE' },
      rank2: { kind: 'NOT_PRINTED' },
      expect: { state: 'EXHAUSTED', fieldsSupplied: 0, fieldsCheckFailed: 0, fieldsExhausted: 1 },
    },
  ];

  for (const tc of cases) {
    it(`${tc.name} (find-first-equivalent)`, async () => {
      const repo = makeRepo([planRow({ rank1Source: 'NSE', rank2Source: 'BSE', rank3Source: null })]);
      const d = deps({
        fieldPlanRepository: repo as any,
        sourceFetchers: {
          NSE: fetcherFor(tc.rank1),
          BSE: fetcherFor(tc.rank2),
        } as any,
      });

      const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

      expect(result.fieldsSupplied).toBe(tc.expect.fieldsSupplied);
      expect(result.fieldsCheckFailed).toBe(tc.expect.fieldsCheckFailed);
      expect(result.fieldsExhausted).toBe(tc.expect.fieldsExhausted);
      expect(repo.recorded[0].state).toBe(tc.expect.state);
      if (tc.expect.chosenSource) {
        expect(repo.recorded[0].chosen.source).toBe(tc.expect.chosenSource);
      }
    });
  }
});
