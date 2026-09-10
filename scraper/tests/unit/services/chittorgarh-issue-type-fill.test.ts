import { describe, it, expect, vi } from 'vitest';
import {
  fillIssueTypesFromReport,
  REPORT82_CONFIDENCE,
} from '../../../src/services/chittorgarh-issue-type-fill.js';
import { BASE_SOURCE_CONFIDENCE } from '../../../src/config/source-confidence.js';

/**
 * Item 2 slice 7 — provenance must follow a REAL write.
 *
 * `ipo_details` has no source-priority mechanism, so this write is safe only
 * because it fills NULLs and never overwrites. The two properties that keep that
 * true are asserted here: the guarded writer decides, and a provenance row is
 * written only when it reports a fill.
 */

const pair = (companyName: string, issueType: 'BOOK_BUILDING' | 'FIXED_PRICE' = 'FIXED_PRICE') =>
  ({ companyName, issueType }) as const;

function deps(over: Partial<Parameters<typeof fillIssueTypesFromReport>[1]> = {}) {
  return {
    resolveIpoId: vi.fn(async () => 'ipo-1'),
    fillIssueTypeIfNull: vi.fn(async () => true),
    trackFieldUpdate: vi.fn(async () => {}),
    logger: { warn: vi.fn() },
    ...over,
  };
}

describe('fillIssueTypesFromReport — provenance follows a real write', () => {
  it('writes provenance when the guarded writer reports a fill', async () => {
    const d = deps();
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd.')], d as never);
    expect(s).toMatchObject({ candidates: 1, matched: 1, filled: 1, alreadySet: 0, unmatched: 0, failed: 0 });
    expect(d.trackFieldUpdate).toHaveBeenCalledTimes(1);
    expect(d.trackFieldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'ipo-1', tableName: 'ipo_details', fieldName: 'issueType', source: 'CHITTORGARH',
      })
    );
  });

  it('writes NO provenance when the column was already set', async () => {
    // The whole point: a provenance row for a no-op claims this run set a value
    // it did not set, and would make an aggregator look like the source of a
    // filing-derived number.
    const d = deps({ fillIssueTypeIfNull: vi.fn(async () => false) });
    const s = await fillIssueTypesFromReport([pair('Already Set Ltd')], d as never);
    expect(s).toMatchObject({ matched: 1, filled: 0, alreadySet: 1 });
    expect(d.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('never calls the writer for a name that matches no stored row', async () => {
    const d = deps({ resolveIpoId: vi.fn(async () => null) });
    const s = await fillIssueTypesFromReport([pair('Not In Our Data Ltd')], d as never);
    expect(s).toMatchObject({ matched: 0, unmatched: 1, filled: 0 });
    expect(d.fillIssueTypeIfNull).not.toHaveBeenCalled();
    expect(d.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('counts a failed write instead of swallowing it, and keeps going', async () => {
    const d = deps({
      fillIssueTypeIfNull: vi
        .fn()
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce(true),
    });
    const s = await fillIssueTypesFromReport([pair('First Ltd'), pair('Second Ltd')], d as never);
    expect(s).toMatchObject({ candidates: 2, failed: 1, filled: 1 });
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it('a resolve failure is counted, not treated as unmatched', async () => {
    // Conflating "lookup broke" with "no such IPO" would hide a broken matcher
    // behind a plausible-looking unmatched count.
    const d = deps({ resolveIpoId: vi.fn(async () => { throw new Error('db down'); }) });
    const s = await fillIssueTypesFromReport([pair('X Ltd')], d as never);
    expect(s).toMatchObject({ failed: 1, unmatched: 0, matched: 0 });
  });

  it('uses the canonical aggregator confidence, not a hardcoded number', async () => {
    expect(REPORT82_CONFIDENCE).toBe(BASE_SOURCE_CONFIDENCE.CHITTORGARH);
    const d = deps();
    await fillIssueTypesFromReport([pair('Any Ltd')], d as never);
    expect(d.trackFieldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: BASE_SOURCE_CONFIDENCE.CHITTORGARH })
    );
  });

  it('handles an empty payload without touching anything', async () => {
    const d = deps();
    const s = await fillIssueTypesFromReport([], d as never);
    expect(s).toMatchObject({ candidates: 0, matched: 0, filled: 0 });
    expect(d.resolveIpoId).not.toHaveBeenCalled();
  });
});
