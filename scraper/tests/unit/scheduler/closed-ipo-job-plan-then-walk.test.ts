/**
 * OD-76 "plan, then walk" (#717): `resourceClosedIpo` is the closed-IPO job's
 * per-IPO worker. These drive the REAL function with stub deps.
 *
 * The class: every closed IPO the job picks. Staging 2026-09-23 -- 238 of 274
 * LISTED IPOs have no plan; the 10 the job picked had 0 plan rows, the walk
 * asked nothing, and each was recorded DONE (and DONE is never re-picked).
 */
import { describe, it, expect, vi } from 'vitest';
import { resourceClosedIpo, type ResourceClosedIpoDeps } from '../../../src/scheduler/closed-ipo-job.js';

function walkResult(over: Record<string, unknown> = {}) {
  return {
    ipoId: 'ipo-1',
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
    droppedWrites: [],
    exhaustedFields: [],
    ...over,
  };
}

function deps(over: Partial<ResourceClosedIpoDeps> = {}): ResourceClosedIpoDeps {
  return {
    countPlanRows: vi.fn().mockResolvedValue(0),
    plantPlan: vi.fn().mockResolvedValue({ rowsGenerated: 12, inserted: 12, updated: 0 }),
    walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 12, fieldsSupplied: 4, fieldsNotAvailableYet: 8 })),
    // Default: every plan row settled after the walk (OD-73), so DONE is reachable.
    countUnsettledPlanRows: vi.fn().mockResolvedValue({}),
    ...over,
  };
}

describe('resourceClosedIpo — OD-76 plan, then walk', () => {
  it('an IPO with NO plan rows gets its plan planted BEFORE the walk runs', async () => {
    const order: string[] = [];
    const d = deps({
      plantPlan: vi.fn(async () => {
        order.push('plant');
        return { rowsGenerated: 12, inserted: 12, updated: 0 };
      }),
      walk: vi.fn(async () => {
        order.push('walk');
        return walkResult({ fieldsAttempted: 12, fieldsSupplied: 4, fieldsNotAvailableYet: 8 });
      }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(order).toEqual(['plant', 'walk']);
    expect(r.outcome).toBe('DONE');
    expect(r.fieldsWritten).toBe(4);
  });

  it('an IPO that already HAS plan rows is not re-planted -- the walk runs over its existing plan', async () => {
    const d = deps({ countPlanRows: vi.fn().mockResolvedValue(40) });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(d.plantPlan).not.toHaveBeenCalled();
    expect(d.walk).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe('DONE');
  });

  it('a plan generation that yields 0 rows is FAILED with a cause, never DONE, and nothing is walked', async () => {
    const d = deps({ plantPlan: vi.fn().mockResolvedValue({ rowsGenerated: 0, inserted: 0, updated: 0 }) });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('FAILED');
    expect(r.causeClass).toBe('EXTRACTOR_MISSING');
    expect(r.causeDetail).toMatch(/0 rows/);
    expect(d.walk).not.toHaveBeenCalled();
  });

  it('a plan generation that throws is FAILED with its cause, never DONE', async () => {
    const d = deps({ plantPlan: vi.fn().mockRejectedValue(new Error('connection reset')) });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('FAILED');
    expect(r.causeClass).toBe('WRITE_SKIPPED');
    expect(r.causeDetail).toMatch(/connection reset/);
    expect(d.walk).not.toHaveBeenCalled();
  });

  it('a walk that asked NOTHING is never DONE (the 2026-09-23 staging shape)', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 0, stoppedReason: 'NO_DUE_FIELDS' })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ NOT_AVAILABLE_YET: 40 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).not.toBe('DONE');
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeDetail).toMatch(/asked nothing/);
  });

  it('a walk cut off by its budget is PARTIAL, not DONE -- the unwalked rest would be dropped for good', async () => {
    const d = deps({
      walk: vi.fn().mockResolvedValue(
        walkResult({ fieldsAttempted: 5, fieldsSupplied: 5, stoppedReason: 'BUDGET_EXHAUSTED' })
      ),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    // OD-80: nothing failed to respond -- fields remain unasked. Not "site down".
    expect(r.causeClass).toBe('FIELDS_PENDING');
    expect(r.causeDetail).toMatch(/BUDGET_EXHAUSTED/);
  });

  it('keeps the existing mapping for a walked IPO: dropped writes are PARTIAL / WRITE_SKIPPED', async () => {
    const d = deps({
      walk: vi.fn().mockResolvedValue(
        walkResult({
          fieldsAttempted: 3,
          fieldsWriteSkipped: 1,
          droppedWrites: [{ tableName: 'ipos', rowKey: '', fieldName: 'issue_size', source: 'NSE', skipReason: 'LOCK_NOT_ACQUIRED' }],
        })
      ),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('WRITE_SKIPPED');
  });

  // OD-76 as corrected (OD-73): "asked nothing" is DONE only when every plan row is settled.
  it('a walk that asked nothing over a plan whose EVERY row is settled is DONE -- nothing is left to ask', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 0, stoppedReason: 'NO_DUE_FIELDS' })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({}),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('DONE');
    expect(r.causeClass).toBeUndefined();
  });

  it('a walk that asked nothing while rows only WAIT on a source is PARTIAL / FIELDS_PENDING (OD-80), per-state counts in the detail -- never DOCUMENT_UNOBTAINABLE (no document was sought)', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 0, stoppedReason: 'NO_DUE_FIELDS' })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ NOT_AVAILABLE_YET: 3, PENDING: 1 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('FIELDS_PENDING');
    expect(r.causeDetail).toMatch(/4 plan row\(s\) are not settled/);
    expect(r.causeDetail).toMatch(/PENDING 1, NOT_AVAILABLE_YET 3, CHECK_FAILED 0/);
    expect(r.fieldsLeftEmpty).toBe(4);
  });

  it('a walk that asked nothing while a row is CHECK_FAILED (backing off) is PARTIAL / FIELDS_PENDING -- waiting to retry, not a source that failed tonight (OD-80)', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 0, stoppedReason: 'NO_DUE_FIELDS' })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ CHECK_FAILED: 4, NOT_AVAILABLE_YET: 2 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('FIELDS_PENDING');
  });
});

// OD-79: DONE only when EVERY plan row is settled, whatever the walk asked.
describe('resourceClosedIpo — OD-79 DONE means every plan row settled', () => {
  it('the review-round-3 probe (5 asked: 3 answered, 2 not yet available; 30 not due; 5 CHECK_FAILED in backoff) is PARTIAL / FIELDS_PENDING with per-state counts -- not DONE', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(
        walkResult({ fieldsAttempted: 5, fieldsSupplied: 3, fieldsNotAvailableYet: 2, stoppedReason: 'NO_DUE_FIELDS' })
      ),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ PENDING: 30, NOT_AVAILABLE_YET: 2, CHECK_FAILED: 5 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('FIELDS_PENDING');
    expect(r.causeDetail).toMatch(/37 plan row\(s\) are not settled/);
    expect(r.causeDetail).toMatch(/PENDING 30, NOT_AVAILABLE_YET 2, CHECK_FAILED 5/);
    expect(r.fieldsWritten).toBe(3);
    expect(r.fieldsLeftEmpty).toBe(37);
  });

  it('an IPO that was walked and whose every plan row is settled afterwards is DONE, and the unsettled count WAS consulted', async () => {
    const d = deps({
      countPlanRows: vi.fn().mockResolvedValue(40),
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 5, fieldsSupplied: 5 })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ PENDING: 0 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('DONE');
    expect(d.countUnsettledPlanRows).toHaveBeenCalledWith('ipo-1');
  });

  it('a check that failed in THIS walk keeps SOURCE_UNREACHABLE -- a source actually failed to respond', async () => {
    const d = deps({
      walk: vi.fn().mockResolvedValue(walkResult({ fieldsAttempted: 4, fieldsSupplied: 2, fieldsCheckFailed: 2 })),
      countUnsettledPlanRows: vi.fn().mockResolvedValue({ CHECK_FAILED: 2 }),
    });
    const r = await resourceClosedIpo('ipo-1', d);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('SOURCE_UNREACHABLE');
  });
});
