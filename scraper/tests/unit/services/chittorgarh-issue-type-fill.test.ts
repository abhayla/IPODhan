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

const pair = (
  companyName: string,
  issueType: 'BOOK_BUILDING' | 'FIXED_PRICE' = 'FIXED_PRICE',
  openDate: string | null = null
) => ({ companyName, issueType, openDate }) as const;

function deps(over: Partial<Parameters<typeof fillIssueTypesFromReport>[1]> = {}) {
  return {
    resolveIpoId: vi.fn(async () => 'ipo-1'),
    foldKey: (n: string) => foldCompanyIdentity(n),
    storedOpenDate: vi.fn(async () => null),
    isWriteAllowed: vi.fn(async () => true),
    ensureDetailsRow: vi.fn(async () => false),
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
      // TWO DISTINCT IPOs. The mock used to return one id for both, which the
      // resolved-id dedupe now (correctly) refuses as a report-side collision -
      // so the mock, not the guard, was what needed fixing.
      resolveIpoId: vi.fn().mockResolvedValueOnce('ipo-1').mockResolvedValueOnce('ipo-2'),
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


describe('guards a Tier A review found missing', () => {
  it('ADMIN LOCK: refuses when protection says no, and writes no provenance', async () => {
    // The null guard is USELESS here by construction: an admin who clears a bad
    // issue_type to NULL and locks the IPO makes `issue_type IS NULL` TRUE. If
    // this refusal is absent, the next cycle writes the value straight back and
    // the admin gets no signal. I argued the null guard was the whole
    // protection; it was not.
    const d = deps({ isWriteAllowed: vi.fn(async () => false) });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.blockedByAdmin).toBe(1);
    expect(s.filled).toBe(0);
    expect(s.rowsCreated).toBe(0);
    expect(d.ensureDetailsRow).not.toHaveBeenCalled();
    expect(d.fillIssueTypeIfNull).not.toHaveBeenCalled();
    expect(d.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('a protection-check failure REFUSES the write rather than assuming allowed', async () => {
    const d = deps({ isWriteAllowed: vi.fn(async () => { throw new Error('redis down'); }) });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.failed).toBe(1);
    expect(d.fillIssueTypeIfNull).not.toHaveBeenCalled();
  });

  it('REPORT-SIDE collision: two report rows folding together that DISAGREE are both refused', async () => {
    // buildFoldedIndex only refused STORED-side collisions. On the live 231-row
    // report today, 196 matches resolve to 195 distinct IPOs - so this is real.
    const d = deps();
    const s = await fillIssueTypesFromReport(
      [pair('Vikram Solar Limited', 'BOOK_BUILDING'), pair('Vikram Solar India Private Limited', 'FIXED_PRICE')],
      d
    );
    expect(foldCompanyIdentity('Vikram Solar Limited'))
      .toBe(foldCompanyIdentity('Vikram Solar India Private Limited'));
    expect(s.reportAmbiguous).toBe(2);
    expect(s.filled).toBe(0);
    expect(d.fillIssueTypeIfNull).not.toHaveBeenCalled();
  });

  it('two report rows that AGREE write once, and the second is not counted as alreadySet', async () => {
    const d = deps();
    const s = await fillIssueTypesFromReport(
      [pair('Vikram Solar Limited', 'BOOK_BUILDING'), pair('Vikram Solar India Private Limited', 'BOOK_BUILDING')],
      d
    );
    expect(s.filled).toBe(1);
    expect(s.alreadySet).toBe(0);
    // Counted as a DUPLICATE, not as ambiguity. Reporting reportAmbiguous here
    // would tell an operator the source contradicted itself when it agreed.
    expect(s.duplicateResolved).toBe(1);
    expect(s.reportAmbiguous).toBe(0);
  });

  it('the probe asks about the value it would actually write', async () => {
    // A refusal files an admin notification carrying attemptedValue. Probing
    // with a hardcoded type would file a lie every cycle for a locked IPO.
    const d = deps();
    await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd', 'FIXED_PRICE')], d);
    expect((d as never as { isWriteAllowed: { mock: { calls: unknown[][] } } })
      .isWriteAllowed.mock.calls[0]).toEqual(['ipo-1', 'FIXED_PRICE']);
  });

  it('a written row whose PROVENANCE write throws is not double-counted as failed', async () => {
    // filled++ then failed++ for one pair would break the identity the summary
    // implies AND fail the cycle step for a row that was actually written.
    const d = deps({ trackFieldUpdate: vi.fn(async () => { throw new Error('field_sources down'); }) });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.filled).toBe(1);
    expect(s.failed).toBe(0);
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it('counts every outcome exactly once - the summary identity holds', async () => {
    const d = deps({
      resolveIpoId: vi.fn()
        .mockResolvedValueOnce('a')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('c'),
      isWriteAllowed: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const s = await fillIssueTypesFromReport(
      [pair('Alpha Ltd'), pair('Beta Ltd'), pair('Gamma Ltd')],
      d
    );
    const sum = s.unmatched + s.reportAmbiguous + s.duplicateResolved + s.dateMismatch
      + s.blockedByAdmin + s.failed + s.filled + s.alreadySet;
    expect(sum).toBe(s.candidates);
  });

  it('counts a report row with no readable date, so a source format change is visible', async () => {
    // If the source stops emitting ISO dates, openDate becomes null for every
    // row, the temporal check fails open by design, and without this counter the
    // summary would look identical to a healthy run.
    const d = deps();
    const s = await fillIssueTypesFromReport(
      [pair('Quanto Agroworld Ltd', 'BOOK_BUILDING', null)],
      d
    );
    expect(s.noReportDate).toBe(1);
  });

  it('OPEN DATE disagreement refuses - a name match is not an identity match', async () => {
    // A refile, or an old SME issue whose name folds onto a newer mainboard one.
    const d = deps({ storedOpenDate: vi.fn(async () => '2023-04-11') });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd', 'BOOK_BUILDING', '2026-09-18')], d);
    expect(s.dateMismatch).toBe(1);
    expect(s.filled).toBe(0);
    expect(d.fillIssueTypeIfNull).not.toHaveBeenCalled();
  });

  it('matching open dates still write', async () => {
    const d = deps({ storedOpenDate: vi.fn(async () => '2026-09-18') });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd', 'BOOK_BUILDING', '2026-09-18')], d);
    expect(s.filled).toBe(1);
  });

  it('a MISSING date on either side does not invent a check', async () => {
    const noStored = deps({ storedOpenDate: vi.fn(async () => null) });
    expect((await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd', 'BOOK_BUILDING', '2026-09-18')], noStored)).filled).toBe(1);
    const noReport = deps({ storedOpenDate: vi.fn(async () => '2023-04-11') });
    expect((await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd', 'BOOK_BUILDING', null)], noReport)).filled).toBe(1);
  });
});

describe('the identity row is created before the fill, and counted apart from it', () => {
  it('creates the row FIRST, then fills - 182 of 183 IPOs have no ipo_details row', async () => {
    const order: string[] = [];
    const d = deps({
      ensureDetailsRow: vi.fn(async () => { order.push('create'); return true; }),
      fillIssueTypeIfNull: vi.fn(async () => { order.push('fill'); return true; }),
    });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(order).toEqual(['create', 'fill']);
    expect(s.rowsCreated).toBe(1);
    expect(s.filled).toBe(1);
  });

  it('a CREATED row is not a FILLED value - the counters never merge', async () => {
    // The row came into existence; the column stayed as it was. Reporting that
    // as a fill claims this run set a value it did not.
    const d = deps({
      ensureDetailsRow: vi.fn(async () => true),
      fillIssueTypeIfNull: vi.fn(async () => false),
    });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.rowsCreated).toBe(1);
    expect(s.filled).toBe(0);
    expect(s.alreadySet).toBe(1);
    expect(d.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('an existing row is not re-counted as created', async () => {
    const d = deps({ ensureDetailsRow: vi.fn(async () => false) });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.rowsCreated).toBe(0);
    expect(s.filled).toBe(1);
  });

  it('a creation failure counts as failed and never reaches the write', async () => {
    const fill = vi.fn(async () => true);
    const d = deps({
      ensureDetailsRow: vi.fn(async () => { throw new Error('insert blew up'); }),
      fillIssueTypeIfNull: fill,
    });
    const s = await fillIssueTypesFromReport([pair('Quanto Agroworld Ltd')], d);
    expect(s.failed).toBe(1);
    expect(s.rowsCreated).toBe(0);
    expect(fill).not.toHaveBeenCalled();
    expect(d.trackFieldUpdate).not.toHaveBeenCalled();
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
