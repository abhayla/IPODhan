import { describe, it, expect, vi } from 'vitest';
import { runIssueTypeFillJob } from '../../../src/services/chittorgarh-issue-type-job.js';

const row = (company: string, method: string) => ({
  Company: `<a href="https://www.chittorgarh.com/ipo/x/1/">${company}</a>`,
  'Pricing Method': method,
});

function deps(over: Record<string, unknown> = {}) {
  return {
    fetchReport: vi.fn(async () => [row('Axiom Gas Ltd', 'Bookbuilding')]),
    loadCandidates: vi.fn(async () => [{ id: 'axiom', companyName: 'Axiom Gas Limited' }]),
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
    expect(r.reportRows).toBe(1);
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
    expect(r.abortedReason).toBe('report returned zero rows');
    expect(r.filled).toBe(0);
    expect(r.rowsCreated).toBe(0);
    expect((d as never as { ensureDetailsRow: { mock: { calls: unknown[] } } })
      .ensureDetailsRow.mock.calls.length).toBe(0);
    expect((d as never as { logger: { warn: { mock: { calls: unknown[] } } } })
      .logger.warn.mock.calls.length).toBe(1);
  });

  it('an already-filled row still enters the index, so a name that folds onto it is AMBIGUOUS', async () => {
    // The index must hold every stored IPO, not only the fillable ones. If the
    // already-filled twin were left out, a colliding name would look like a
    // clean single match and the value would land on the wrong company.
    const d = deps({
      fetchReport: vi.fn(async () => [row('Indo MIM Ltd.', 'Bookbuilding')]),
      loadCandidates: vi.fn(async () => [
        { id: 'a', companyName: 'Indo-MIM Limited' },
        { id: 'b', companyName: 'INDO MIM LTD' },
      ]),
    });
    const r = await runIssueTypeFillJob(d);
    expect(r.matched).toBe(0);
    expect(r.unmatched).toBe(1);
    expect(r.filled).toBe(0);
  });

  it('a row whose Pricing Method it cannot read is dropped, never defaulted', async () => {
    const d = deps({ fetchReport: vi.fn(async () => [row('Axiom Gas Ltd', 'Book Building')]) });
    const r = await runIssueTypeFillJob(d);
    expect(r.reportRows).toBe(1);
    expect(r.candidates).toBe(0);
    expect(r.filled).toBe(0);
  });
});
