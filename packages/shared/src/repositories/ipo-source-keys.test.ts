import { describe, it, expect } from 'vitest';
import {
  normalizeSourceKeyValue,
  nseIssueKeyValue,
  chittorgarhPageId,
  recheckKeyBind,
  od83Supersedes,
  normalizeSourceKeyRefs,
} from './ipo-source-keys';
import { REPOINT_TABLES, checkMergeEligibility, assessRelaunch, relaunchException } from '../utils/duplicate-ipo-merge';

// OD-85 / OD-86 pure rules (docs/design/data-sourcing-pull-model.md §2.3.3.2, §2.3.3.3).
describe('OD-85 key values', () => {
  it('trims and upper-cases (BSE "MOMSBELIEF " F-133); NSE key is SYMBOL|SERIES and needs a series', () => {
    expect(normalizeSourceKeyValue('MOMSBELIEF ')).toBe('MOMSBELIEF');
    expect(nseIssueKeyValue('momsbelief ', 'eq')).toBe('MOMSBELIEF|EQ');
    expect(nseIssueKeyValue('COALINDIA', null)).toBeNull();
  });
  it('the Chittorgarh page id ignores the slug (F-148)', () => {
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/hero-motors-ipo/2225/')).toBe('2225');
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/x/2225/')).toBe('2225');
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/no-id/')).toBeNull();
  });
  it('collapses duplicate refs and drops malformed ones', () => {
    expect(normalizeSourceKeyRefs([
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ' 7900' },
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '7900' },
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '   ' },
    ]).map((r) => r.keyValue)).toEqual(['7900']);
  });
});

describe('OD-85 re-check on every key bind', () => {
  const row = { offeringType: 'IPO', segment: 'SME', openDate: '2026-08-19', priceRangeMin: 95, cin: null, isin: 'INE1B7I01014' };
  it('passes the Dhanwel re-read (57 days, same band)', () => {
    expect(recheckKeyBind({ openDate: '2026-06-23', priceRangeMin: 95, segment: 'SME' }, row).ok).toBe(true);
  });
  it('an ISIN contradiction is an identifier contradiction (-> DISPUTED); Himalaya values', () => {
    expect(recheckKeyBind({ isin: 'INE1OTR01013' }, row)).toMatchObject({ ok: false, identifierContradiction: true });
  });
  it('type, segment, band and >180 days each refuse without disputing the key', () => {
    expect(recheckKeyBind({ offeringType: 'OFS' }, row)).toMatchObject({ ok: false, identifierContradiction: false });
    expect(recheckKeyBind({ segment: 'MAINBOARD' }, row).ok).toBe(false);
    expect(recheckKeyBind({ priceRangeMin: 100 }, row).ok).toBe(false);
    expect(recheckKeyBind({ openDate: '2027-03-01' }, row).ok).toBe(false);
  });
});

describe('OD-83 supersede test', () => {
  const same = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
  it('same shares + band + older postponed -> supersede (Dhanwel 7794 -> 7900)', () => {
    expect(od83Supersedes({ attrs: { ...same, postponed: true }, recordOpenDate: '2026-06-23' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(true);
  });
  it('strictly earlier also passes; equal dates without postponed flag hold', () => {
    expect(od83Supersedes({ attrs: same, recordOpenDate: '2026-06-23' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(true);
    expect(od83Supersedes({ attrs: same, recordOpenDate: '2026-08-19' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(false);
  });
  it('a differing band or an unknown share count holds', () => {
    expect(od83Supersedes({ attrs: { ...same, postponed: true } }, { attrs: { ...same, priceMin: 100, priceMax: 105 } }).ok).toBe(false);
    expect(od83Supersedes({ attrs: { priceMin: 95, priceMax: 99, postponed: true } }, { attrs: same }).ok).toBe(false);
  });
});

describe('merge tool (OD-85 repoint, OD-86 relaunch exception)', () => {
  it('ipo_source_keys is on the repoint list', () => {
    expect(REPOINT_TABLES.has('ipo_source_keys')).toBe(true);
  });
  const keep = { openDate: '2026-08-19', symbol: 'DHANWEL', cin: null };
  const drop = { openDate: '2026-06-23', symbol: 'DHANWEL', cin: null };
  const attrs = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
  const base = {
    keepOpenDate: keep.openDate, dropOpenDate: drop.openDate, keepCompanyName: 'Dhanwel Hybrid Seeds Ltd', dropCompanyName: 'Dhanwel Hybrid Seeds Ltd',
    forceDifferentName: false, identifiers: [{ column: 'bse_ipo_no', keepValue: 7900, dropValue: 7794 }, { column: 'symbol', keepValue: 'DHANWEL', dropValue: 'DHANWEL' }],
    keepIssueSize: null, dropIssueSize: null,
  };
  it('relaunch (older postponed) merges despite differing dates and IPO_NOs', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs: { ...attrs, postponed: true } }]);
    expect(relaunchException(relaunch)).toBe(true);
    expect(checkMergeEligibility({ ...base, relaunch })).toEqual({ eligible: true });
  });
  it('without the postponed flag, OD-69 refuses as before', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs }]);
    expect(checkMergeEligibility({ ...base, relaunch }).eligible).toBe(false);
  });
  it('a differing ISIN is still refused under the exception', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs: { ...attrs, postponed: true } }]);
    const r = checkMergeEligibility({ ...base, relaunch, identifiers: [...base.identifiers, { column: 'isin', keepValue: 'INE1B7I01014', dropValue: 'INE1OTR01013' }] });
    expect(r.eligible).toBe(false);
  });
});
