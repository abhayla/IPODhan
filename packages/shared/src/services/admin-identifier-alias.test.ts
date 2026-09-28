import { describe, it, expect } from 'vitest';
import { normalizeIdentifier, isIdentifierAliasField, IDENTIFIER_ALIAS_FIELDS } from './admin-identifier-alias';
import { IPO_FIELDS_AWAITING_PHASE_B } from './admin-field-write';
import { REPOINT_TABLES } from '../utils/duplicate-ipo-merge';

describe('§9.2 item 26 identifier alias helpers', () => {
  it('normalises each identifier the way binding compares it', () => {
    expect(normalizeIdentifier('symbol', ' icelco ')).toBe('ICELCO');
    expect(normalizeIdentifier('isin', 'ine123a01012')).toBe('INE123A01012');
    expect(normalizeIdentifier('bseIpoNo', 7900)).toBe('7900');
    expect(normalizeIdentifier('symbol', '   ')).toBeNull();
    expect(normalizeIdentifier('cin', null)).toBeNull();
    expect(normalizeIdentifier('cin', ' u31909dl2005plc139412 ')).toBe('U31909DL2005PLC139412');
  });

  it('covers exactly cin, isin, symbol and bseIpoNo, none of which is still refused as Phase B', () => {
    expect(Object.keys(IDENTIFIER_ALIAS_FIELDS).sort()).toEqual(['bseIpoNo', 'cin', 'isin', 'symbol']);
    for (const f of Object.keys(IDENTIFIER_ALIAS_FIELDS)) {
      expect(isIdentifierAliasField(f)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(IPO_FIELDS_AWAITING_PHASE_B, f)).toBe(false);
    }
    expect(Object.keys(IPO_FIELDS_AWAITING_PHASE_B).sort()).toEqual(['listingExchanges', 'offeringType', 'segment']);
    expect(isIdentifierAliasField('companyName')).toBe(false);
  });

  it('OD-38 / OD-92: the merge tool repoints alias rows to the survivor (logged, so unmerge moves them back)', () => {
    expect(REPOINT_TABLES.has('ipo_identifier_aliases')).toBe(true);
  });
});
