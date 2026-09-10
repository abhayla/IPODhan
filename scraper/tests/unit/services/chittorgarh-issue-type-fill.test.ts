import { foldCompanyIdentity } from '@ipodhan/shared/utils/company-identity-fold';
import { describe, it, expect, vi } from 'vitest';
import {
  fillIssueTypesFromReport,
  REPORT82_CONFIDENCE,
  buildFoldedIndex,
  resolveByFoldedName,
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

describe('resolveByFoldedName - one match or nothing', () => {
  // The repo's REAL identity fold, imported, never re-implemented. A resolver
  // tested against a hand-rolled regex proves nothing about the fold the rest
  // of the system actually uses.
  const fold = foldCompanyIdentity;

  const idx = (rows: Array<{ id: string; companyName: string }>) =>
    buildFoldedIndex(rows, fold);

  it('resolves the long stored name from the report short name', () => {
    // The 2026-09-09 duplicate case, from the other direction.
    const i = idx([{ id: 'arcil', companyName: 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED' }]);
    expect(resolveByFoldedName('Asset Reconstruction Co.(India) Ltd.', i, fold)).toBe('arcil');
  });

  it('REFUSES when two stored rows fold to the same key - never picks one', () => {
    // Staging really holds 13 such groups. Picking would write a sourced value
    // onto the wrong company; #562 is the live example of that policy failing.
    const i = idx([
      { id: 'a', companyName: 'Indo-MIM Limited' },
      { id: 'b', companyName: 'INDO MIM LTD' },
    ]);
    expect(foldCompanyIdentity('Indo-MIM Limited')).toBe(foldCompanyIdentity('INDO MIM LTD'));
    expect(resolveByFoldedName('Indo MIM Ltd.', i, fold)).toBeNull();
  });

  it('returns null for a name no stored row folds to', () => {
    const i = idx([{ id: 'a', companyName: 'Atharva Polyplast Limited' }]);
    // A near-miss the fold deliberately keeps apart.
    expect(resolveByFoldedName('Atharva Polymers Limited', i, fold)).toBeNull();
  });

  it('returns null when the name folds to nothing rather than matching a blank key', () => {
    // 'India Company Limited' is ALL non-identity words - it folds to ''.
    expect(foldCompanyIdentity('India Company Limited')).toBe('');
    const i = idx([{ id: 'a', companyName: 'Vikran Engineering Ltd' }]);
    expect(resolveByFoldedName('India Company Limited', i, fold)).toBeNull();
    expect(resolveByFoldedName('', i, fold)).toBeNull();
  });

  it('refuses a blank key even when the index HAS one, not relying on the builder', () => {
    // buildFoldedIndex never stores '', so this guard is invisible through it.
    // But `index` is any ReadonlyMap: a caller assembling one another way could
    // hand in a '' key, and it would then match EVERY unfoldable name at once.
    // The mutation that removed this guard survived until this test existed.
    const hostile = new Map<string, string[]>([['', ['wrong-company']]]);
    expect(resolveByFoldedName('India Company Limited', hostile, fold)).toBeNull();
    expect(resolveByFoldedName('', hostile, fold)).toBeNull();
  });

  it('a candidate whose name folds to nothing never enters the index', () => {
    const i = idx([
      { id: 'junk', companyName: 'India Company Limited' },
      { id: 'real', companyName: 'Coal India Limited' },
    ]);
    expect(i.has('')).toBe(false);
    expect(resolveByFoldedName('Coal India Ltd', i, fold)).toBe('real');
  });
});
