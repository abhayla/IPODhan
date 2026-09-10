import { describe, it, expect, vi } from 'vitest';
import {
  runIssueTypeFillJob,
  REPORT82_MIN_ROWS,
} from '../../../src/services/chittorgarh-issue-type-job.js';

const row = (company: string, method: string, open = '2026-09-18T00:00:00.000Z') => ({
  Company: `<a href="https://www.chittorgarh.com/ipo/x/1/">${company}</a>`,
  'Pricing Method': method,
  '~Issue_Open_Date': open,
});

/** A report big enough to clear the floor, padded with rows that map cleanly. */
const fullReport = (...head: Array<Record<string, unknown>>) => [
  ...head,
  ...Array.from({ length: REPORT82_MIN_ROWS }, (_, i) => row(`Filler Number ${i} Ltd`, 'Bookbuilding')),
];

function deps(over: Record<string, unknown> = {}) {
  return {
    fetchReport: vi.fn(async () => fullReport(row('Axiom Gas Ltd', 'Bookbuilding'))),
    loadCandidates: vi.fn(async () => [{ id: 'axiom', companyName: 'Axiom Gas Limited', openDate: null }]),
    isWriteAllowed: vi.fn(async () => true),
    ensureDetailsRow: vi.fn(async () => true),
    fillIssueTypeIfNull: vi.fn(async () => true),
    trackFieldUpdate: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  } as never;
}

describe('the issue-type fill job', () => {
  it('fills end to end: report name -> folded match -> row created -> value written', async () => {
    const d = deps();
    const r = await runIssueTypeFillJob(d);
    expect(r.reportRows).toBe(REPORT82_MIN_ROWS + 1);
    expect(r.matched).toBe(1);
    expect(r.rowsCreated).toBe(1);
    expect(r.filled).toBe(1);
    expect(r.abortedReason).toBeUndefined();
    expect((d as never as { fillIssueTypeIfNull: { mock: { calls: unknown[][] } } })
      .fillIssueTypeIfNull.mock.calls[0]).toEqual(['axiom', 'BOOK_BUILDING']);
  });

  it('REFUSES a zero-row report instead of reporting a quiet no-op', async () => {
    // The endpoint answers HTTP 200 with an empty list when the request is
    // malformed - measured: any page size but 10 does exactly that. Treating
    // "no rows" as "nothing to do" would make a permanently broken job look
    // healthy forever. Report 82 lists a whole financial year and is never
    // legitimately empty.
    const d = deps({ fetchReport: vi.fn(async () => []) });
    const r = await runIssueTypeFillJob(d);
    expect(r.abortedReason).toMatch(/below the floor/);
    expect(r.filled).toBe(0);
    expect(r.rowsCreated).toBe(0);
    expect((d as never as { ensureDetailsRow: { mock: { calls: unknown[] } } })
      .ensureDetailsRow.mock.calls.length).toBe(0);
    expect((d as never as { logger: { warn: { mock: { calls: unknown[] } } } })
      .logger.warn.mock.calls.length).toBe(1);
  });


  it('REFUSES a SHORT read, not just an empty one - a zero-row guard cannot see 10 of 231', () => {
    expect(REPORT82_MIN_ROWS).toBeGreaterThan(10);
  });

  it('refuses a page-sized read below the floor', async () => {
    // chittorgarh-rights-debt-adapter.ts hits this SAME report id and paginates
    // on length === 10. If it is right and this path is wrong, fetchReport82
    // returns 10 rows, the old `length === 0` guard passes, and the job fills 10
    // of 231 while reporting success forever.
    const d = deps({ fetchReport: vi.fn(async () => Array.from({ length: 10 }, (_, i) => row(`X ${i} Ltd`, 'Bookbuilding'))) });
    const r = await runIssueTypeFillJob(d);
    expect(r.abortedReason).toMatch(/below the floor/);
    expect(r.filled).toBe(0);
    expect((d as never as { isWriteAllowed: { mock: { calls: unknown[] } } }).isWriteAllowed.mock.calls.length).toBe(0);
  });

  it('an already-filled row still enters the index, so a name that folds onto it is AMBIGUOUS', async () => {
    // The index must hold every stored IPO, not only the fillable ones. If the
    // already-filled twin were left out, a colliding name would look like a
    // clean single match and the value would land on the wrong company.
    const d = deps({
      fetchReport: vi.fn(async () => fullReport(row('Indo MIM Ltd.', 'Bookbuilding'))),
      loadCandidates: vi.fn(async () => [
        { id: 'a', companyName: 'Indo-MIM Limited', openDate: null },
        { id: 'b', companyName: 'INDO MIM LTD', openDate: null },
      ]),
    });
    const r = await runIssueTypeFillJob(d);
    expect(r.matched).toBe(0);
    // The Indo MIM row plus the filler rows, none of which have a candidate.
    expect(r.unmatched).toBe(REPORT82_MIN_ROWS + 1);
    expect(r.filled).toBe(0);
  });

  it('a row whose Pricing Method it cannot read is dropped, never defaulted', async () => {
    const d = deps({
      fetchReport: vi.fn(async () => fullReport(row('Axiom Gas Ltd', 'Book Building'))),
      loadCandidates: vi.fn(async () => [{ id: 'axiom', companyName: 'Axiom Gas Limited', openDate: null }]),
    });
    const r = await runIssueTypeFillJob(d);
    // The filler rows map; the 'Book Building' row (a space) does NOT.
    expect(r.candidates).toBe(REPORT82_MIN_ROWS);
    expect(r.matched).toBe(0);
    expect(r.filled).toBe(0);
  });
});
