import { describe, it, expect } from 'vitest';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { indexNseMasterRows, type NseMasterRow } from '../../../src/scrapers/nse-equity-master.js';

/**
 * Ambiguous names (review finding on PR #655). A company name present in BOTH NSE files
 * (a MAIN row and an SME row) was collapsed to whichever file was read first, so the
 * oracle never saw the twin and the board it returned was a property of file order.
 * The same refusal the BSE master and the oracle now make.
 */
function row(o: Partial<NseMasterRow>): NseMasterRow {
  return { symbol: 'SYM', name: 'Example Ltd', listingIso: '2020-01-01', isin: 'INE000A01010', board: 'MAIN', ...o };
}

describe('indexNseMasterRows — a name in both files is ambiguous, not first-wins', () => {
  const rows = [
    row({ symbol: 'TWINM', name: 'Twinco Limited', isin: 'INE333C01013', board: 'MAIN' }),
    row({ symbol: 'TWINS', name: 'Twinco Ltd', isin: 'INE444D01014', board: 'SME' }),
    row({ symbol: 'SOLO', name: 'Solo Industries Ltd', isin: 'INE555E01015', board: 'MAIN' }),
  ];

  it('excludes the duplicated key from byName and records it in ambiguousNames', () => {
    const idx = indexNseMasterRows(rows);
    const key = normalizeCompanyNameForMatching('Twinco Limited');
    expect(idx.byName.has(key)).toBe(false);
    expect(idx.ambiguousNames.get(key)?.length).toBe(2);
  });

  it('returns EVERY parsed row, so a caller can see both boards', () => {
    const idx = indexNseMasterRows(rows);
    expect(idx.rows.length).toBe(3);
    expect(idx.rows.filter((r) => r.board === 'SME').length).toBe(1);
  });

  it('positive control: a unique name is still indexed, and bySymbol is untouched', () => {
    const idx = indexNseMasterRows(rows);
    expect(idx.byName.get(normalizeCompanyNameForMatching('Solo Industries Ltd'))?.symbol).toBe('SOLO');
    expect(idx.bySymbol.get('TWINM')?.board).toBe('MAIN');
    expect(idx.bySymbol.get('TWINS')?.board).toBe('SME');
  });
});
