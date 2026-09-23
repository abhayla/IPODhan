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
    expect(r.causeClass).toBe('SOURCE_UNREACHABLE');
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
});
