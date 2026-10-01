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
    // item 18 removed offeringType/segment/listingExchanges too (their save rebuilds the plan);
    // no field currently awaits Phase B.
    expect(Object.keys(IPO_FIELDS_AWAITING_PHASE_B)).toEqual([]);
    expect(isIdentifierAliasField('companyName')).toBe(false);
  });

  it('OD-38 / OD-92: the merge tool repoints alias rows to the survivor (logged, so unmerge moves them back)', () => {
    expect(REPOINT_TABLES.has('ipo_identifier_aliases')).toBe(true);
  });
});

describe('#1290 answer state: the holder lookup failed', () => {
  it('refuses (the error propagates, so writeAdminFieldValue rolls back) and moves nothing', async () => {
    const { keepReplacedIdentifier } = await import('./admin-identifier-alias');
    const writes: string[] = [];
    const failing = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'innerJoin', 'limit']) chain[m] = () => chain;
      chain.then = (_ok: unknown, bad: (e: Error) => unknown) => bad(new Error('lookup failed: connection reset'));
      return chain;
    };
    const tx = {
      select: failing,
      update: () => { writes.push('update'); return failing(); },
      insert: () => { writes.push('insert'); return failing(); },
      delete: () => { writes.push('delete'); return failing(); },
      execute: () => Promise.reject(new Error('lookup failed: connection reset')),
    };
    await expect(
      keepReplacedIdentifier(tx as never, { ipoId: 'b', fieldName: 'bseIpoNo', oldValue: null, newValue: 91290, adminId: 'a', adminName: 'n' })
    ).rejects.toThrow('lookup failed');
    expect(writes).toEqual([]);
  });
});
