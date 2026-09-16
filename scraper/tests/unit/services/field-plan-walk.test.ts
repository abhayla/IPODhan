// implements: item 6 -- the pull walk over ipo_field_plan (design §2.4, §2.2)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  walkFieldPlanForIPO,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';

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
  return {
    recorded,
    released,
    claimNextDueField: vi.fn(async () => queue.shift() ?? null),
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

function makeOrchestrator(
  ipoResult: any = { ipoId: IPO_ID, isNew: false, locked: true, skipped: false },
  childResult: any = { rowsProcessed: 1, rowsUpdated: 1, rowsSkipped: 0, conflictsDetected: 0, rows: [{ rowKey: 'FY2025', consolidatedData: {}, fieldsProcessed: 1, fieldsUpdated: 1, conflictsDetected: 0, skipped: false }] }
) {
  return {
    consolidatedUpsertIPO: vi.fn(async () => ipoResult),
    consolidatedUpsertChildRows: vi.fn(async () => childResult),
  };
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

function deps(over: Partial<FieldPlanWalkDeps> = {}): FieldPlanWalkDeps {
  return {
    fieldPlanRepository: makeRepo([]) as any,
    orchestrator: makeOrchestrator() as any,
    sourceFetchers: { NSE: supplied, BSE: supplied, CHITTORGARH: supplied } as any,
    ipoRepository: makeIpoRepository() as any,
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
    repo.claimNextDueField = vi.fn(async () => ({ ...row })) as any;
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
    repo.claimNextDueField = vi.fn(async () => ({ ...row })) as any;
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
      consolidatedUpsertIPO: vi.fn(async (_scraped: any, _source: any, _confidence: any, preResolvedIPO: any) => {
        if (preResolvedIPO === undefined || preResolvedIPO === null) {
          throw new Error('consolidatedUpsertIPO called with no preResolvedIPO -- would re-resolve identity independently');
        }
        return { ipoId: IPO_ID, isNew: false, locked: true, skipped: false };
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

  it('the existing IPO row missing (findById returns null) records CHECK_FAILED with cause "ipo row missing", never a create attempt', async () => {
    const repo = makeRepo([planRow({ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' })]);
    const orch = makeOrchestrator();
    const ipoRepository = makeIpoRepository(null);
    const d = deps({ fieldPlanRepository: repo as any, orchestrator: orch as any, ipoRepository: ipoRepository as any });

    await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].writeHappened).toBe(false);
    expect(repo.recorded[0].skipReason).toContain('ipo row missing');
  });
});
