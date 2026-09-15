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

function deps(over: Partial<FieldPlanWalkDeps> = {}): FieldPlanWalkDeps {
  return {
    fieldPlanRepository: makeRepo([]) as any,
    orchestrator: makeOrchestrator() as any,
    sourceFetchers: { NSE: supplied, BSE: supplied, CHITTORGARH: supplied } as any,
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

  it('every rank CHECK_FAILED: records EXHAUSTED once, and never writes a value', async () => {
    const repo = makeRepo([planRow({ rank3Source: 'CHITTORGARH' })]);
    const orch = makeOrchestrator();
    const d = deps({
      fieldPlanRepository: repo as any,
      orchestrator: orch as any,
      sourceFetchers: { NSE: checkFailed, BSE: checkFailed, CHITTORGARH: checkFailed } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(orch.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(orch.consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].state).toBe('EXHAUSTED');
    expect(result.fieldsExhausted).toBe(1);
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
  it('records NOT_AVAILABLE_YET (a re-askable state) and stops the rank loop', async () => {
    const repo = makeRepo([planRow()]);
    const bse = vi.fn(supplied);
    const d = deps({
      fieldPlanRepository: repo as any,
      sourceFetchers: { NSE: async () => ({ outcome: 'NOT_AVAILABLE_YET' }), BSE: bse } as any,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, d, openBudget());

    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0].state).toBe('NOT_AVAILABLE_YET');
    expect(repo.recorded[0].writeHappened).toBe(true);
    expect(result.fieldsSupplied).toBe(0);
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
    expect(repo.recorded[0].state).toBe('EXHAUSTED');
    expect(result.fieldsExhausted).toBe(1);
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
