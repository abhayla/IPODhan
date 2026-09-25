/**
 * T-270: root-cause regression tests for the NSE past-issues matcher.
 *
 * The T-268F price-band backfill wrote wrong price bands into 80 live
 * production IPO rows. Root cause: the old matcher scored name overlap with
 * `nseWord.includes(dbWord) || dbWord.includes(nseWord)` and only skipped
 * SHORT DB words (`dbWord.length < 3`) - it never skipped short NSE words. An
 * NSE company whose name contains single-letter tokens ("R K Swamy Limited",
 * "S D Retail Limited", "V L Infraprojects Limited") therefore matched almost
 * any DB name, because `"gre".includes("r")` / `"kasturi".includes("s")` are
 * true. Three such accidental hits out of four words clears the 0.6 threshold.
 *
 * These are the two production cases proven in the T-270 investigation.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCompanyName,
  matchNSEPastIssue,
  type NSEPastIssue,
} from '../../../src/services/nse-past-issue-matcher.js';

const nseFixture: NSEPastIssue[] = [
  { company: 'R K Swamy Limited', symbol: 'RKSWAMY', priceRange: 'Rs.270 to Rs.288' },
  { company: 'S D Retail Limited', symbol: 'SDREAMS', priceRange: 'Rs.124 to Rs.131' },
  { company: 'V L Infraprojects Limited', symbol: 'VLINFRA', priceRange: 'Rs.39 to Rs.42' },
  { company: 'Juniper Green Energy Limited', symbol: 'JNPR', priceRange: 'Rs.214 to Rs.225' },
  { company: 'Shanti Gold International Limited', symbol: 'SHANTIGOLD', priceRange: 'Rs.189 to Rs.199' },
  { company: 'Laser Power & Infra Limited', symbol: 'LASERPOWER', priceRange: 'Rs.203 to Rs.214' },
];

describe('matchNSEPastIssue - false-positive root cause (T-270)', () => {
  it('does NOT match GRE Renew Enertech to "R K Swamy Limited" (prod case: wrote wrong band 270-288)', () => {
    const result = matchNSEPastIssue(
      { companyName: 'GRE Renew Enertech Ltd.', symbol: 'GRERENEW' },
      nseFixture
    );
    expect(result).toBeNull();
  });

  it('does NOT match Kasturi Metal Composite to "S D Retail Limited" (prod case: wrote wrong band 124-131)', () => {
    const result = matchNSEPastIssue(
      { companyName: 'Kasturi Metal Composite Ltd.', symbol: 'KASTURI' },
      nseFixture
    );
    expect(result).toBeNull();
  });

  it('does NOT match on single-letter NSE tokens for any unrelated company', () => {
    for (const name of ['AVADH RAIL INFRA LIMITED', 'SHARP INDIA LTD', 'ANDHRA CEMENTS LTD']) {
      expect(matchNSEPastIssue({ companyName: name, symbol: null }, nseFixture)).toBeNull();
    }
  });
});

describe('matchNSEPastIssue - confident matches still work', () => {
  it('matches on exact symbol', () => {
    const r = matchNSEPastIssue({ companyName: 'Juniper Green Energy Ltd.', symbol: 'JNPR' }, nseFixture);
    expect(r?.matchedBy).toBe('symbol');
    expect(r?.issue.symbol).toBe('JNPR');
  });

  it('matches on normalized name when the symbol is absent (Ltd vs Limited)', () => {
    const r = matchNSEPastIssue({ companyName: 'SHANTI GOLD INTERNATIONAL LTD', symbol: null }, nseFixture);
    expect(r?.matchedBy).toBe('name');
    expect(r?.issue.symbol).toBe('SHANTIGOLD');
  });

  it('is case- and punctuation-insensitive on normalized names', () => {
    expect(normalizeCompanyName('Laser Power & Infra Limited')).toBe('laser power infra');
    expect(normalizeCompanyName('Laser Power and Infra')).toBe('laser power and infra');
    expect(normalizeCompanyName('ACME Industries Pvt. Ltd. (ACME IPO)')).toBe('acme industries');
  });
});

describe('matchNSEPastIssue - ambiguity is not a match', () => {
  it('returns null when two NSE rows normalize to the same name', () => {
    const ambiguous: NSEPastIssue[] = [
      { company: 'Acme Industries Limited', symbol: 'ACME1', priceRange: 'Rs.10 to Rs.12' },
      { company: 'Acme Industries Ltd', symbol: 'ACME2', priceRange: 'Rs.90 to Rs.99' },
    ];
    expect(matchNSEPastIssue({ companyName: 'Acme Industries Ltd.', symbol: null }, ambiguous)).toBeNull();
  });

  it('returns null on an empty/blank company name', () => {
    expect(matchNSEPastIssue({ companyName: '   ', symbol: null }, nseFixture)).toBeNull();
  });
});

/**
 * T-276: a repair run that OVERWRITES an existing production value uses
 * `identity: 'symbol'` — after T-270 wrote 80 wrong bands, the bar for
 * replacing a value a user can already see is an exact identifier, and the
 * normalized-name path (safe though it is for FILLING a null) is switched off.
 */
describe('matchNSEPastIssue — symbol-only identity mode (T-276)', () => {
  const issues = [
    { company: 'Tempsens Instruments (India) Limited', symbol: 'TEMPSENS', priceRange: 'Rs.285 to Rs.300' },
    { company: 'Augmont Enterprises Limited', symbol: 'AUGMONT', priceRange: 'Rs.750 to Rs.788' },
  ];

  it('still matches on an exact symbol when the name agrees too', () => {
    const m = matchNSEPastIssue(
      { companyName: 'Tempsens Instruments (India) Ltd.', symbol: 'TEMPSENS' },
      issues,
      'symbol'
    );
    expect(m?.matchedBy).toBe('symbol');
    expect(m?.issue.symbol).toBe('TEMPSENS');
  });

  it('#562: refuses an exact symbol match when the name disagrees, even in symbol-only mode', () => {
    const m = matchNSEPastIssue({ companyName: 'Anything At All', symbol: 'TEMPSENS' }, issues, 'symbol');
    expect(m).toBeNull();
  });

  it('refuses a name-only match when identity is symbol-only', () => {
    const byName = { companyName: 'Tempsens Instruments (India) Limited', symbol: null };
    expect(matchNSEPastIssue(byName, issues, 'symbol+name')?.matchedBy).toBe('name');
    expect(matchNSEPastIssue(byName, issues, 'symbol')).toBeNull();
  });

  it('defaults to symbol+name so existing null-filling callers are unchanged', () => {
    const m = matchNSEPastIssue({ companyName: 'Augmont Enterprises Limited', symbol: null }, issues);
    expect(m?.matchedBy).toBe('name');
  });
});

/**
 * #562: rule 1 (exact symbol match, uncorroborated by name) pairs Injecto
 * Polymers Limited with India Pesticides Limited because both happen to
 * carry NSE symbol "IPL" - two unrelated companies, same 3-letter ticker.
 * Verified against real NSE public-past-issues data 2026-09-11. Rule 2
 * (unique normalized-name match) correctly returns no match for Injecto,
 * which is why the fix gates the symbol rule behind name agreement rather
 * than retiring it outright - the symbol signal is still valuable when it
 * is corroborated.
 */
describe('matchNSEPastIssue - #562 symbol collision (Injecto Polymers / India Pesticides)', () => {
  const nseIssues: NSEPastIssue[] = [
    { company: 'India Pesticides Limited', symbol: 'IPL', priceRange: 'Rs.290 to Rs.296' },
  ];

  it('does NOT pair Injecto Polymers with India Pesticides on the shared symbol IPL (symbol+name identity)', () => {
    const result = matchNSEPastIssue(
      { companyName: 'Injecto Polymers Limited', symbol: 'IPL' },
      nseIssues,
      'symbol+name'
    );
    expect(result).toBeNull();
  });

  it('does NOT pair them even under symbol-only identity (the T-276 repair-overwrite mode)', () => {
    const result = matchNSEPastIssue(
      { companyName: 'Injecto Polymers Limited', symbol: 'IPL' },
      nseIssues,
      'symbol'
    );
    expect(result).toBeNull();
  });

  it('still accepts an exact symbol match when the normalized names also agree', () => {
    const result = matchNSEPastIssue(
      { companyName: 'India Pesticides Ltd.', symbol: 'IPL' },
      nseIssues,
      'symbol'
    );
    expect(result?.matchedBy).toBe('symbol');
    expect(result?.issue.company).toBe('India Pesticides Limited');
  });
});
