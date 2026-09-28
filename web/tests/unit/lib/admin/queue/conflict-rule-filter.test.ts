/** F-173 / spec §9.4: which unresolved conflicts are not disagreements, and under which rule. */
import { describe, it, expect } from 'vitest';
import { ruleFilterFor, equalInMeaning } from '@/lib/admin/queue/conflict-rule-filter';

const c = (o: Partial<Parameters<typeof ruleFilterFor>[0]>) =>
  ruleFilterFor({ fieldName: 'issueSize', source1: 'CHITTORGARH', source2: 'BSE', value1: '1', value2: '2', resolutionReason: null, ...o });

describe('conflict rule filter (F-173)', () => {
  it('OD-75: a source against itself, or the named self-change reasons', () => {
    expect(c({ source2: 'CHITTORGARH' })).toBe('OD-75');
    expect(c({ resolutionReason: 'SOURCE_CHANGED_OWN_VALUE' })).toBe('OD-75');
    expect(c({ resolutionReason: 'OVERRIDE_SOURCE_LOST_TO_PRIORITY' })).toBe('OD-75');
  });

  it('OD-60: zero, null or empty is an abstention', () => {
    expect(c({ value2: null })).toBe('OD-60');
    expect(c({ value1: '' })).toBe('OD-60');
    expect(c({ value1: '8250000000.00', value2: '0' })).toBe('OD-60');
  });

  it('OD-59: same number written differently, same day, same name after folding', () => {
    expect(c({ value1: '10', value2: '10.00' })).toBe('OD-59');
    expect(c({ value1: '₹1,250', value2: '1250' })).toBe('OD-59');
    expect(c({ fieldName: 'openDate', value1: '2026-09-15', value2: '2026-09-15T00:00:00.000Z' })).toBe('OD-59');
    expect(c({ fieldName: 'registrar', value1: 'Mudra RTA Ventures Pvt Ltd', value2: 'Mudra RTA Ventures Private Limited' })).toBe('OD-59');
  });

  it('F-181: writer bookkeeping columns are never disagreements', () => {
    expect(c({ fieldName: 'lastScrapedAt' })).toBe('F-181');
  });

  it('real disagreements stay on the list (F-173 live sample: BSE issue size low, #728)', () => {
    expect(c({ value1: '3000000000', value2: '2600624600' })).toBeNull();
    // no 0.5% money tolerance without a comparison family: a near value stays a disagreement (shown)
    expect(c({ value1: '1250000000', value2: '1249970000' })).toBeNull();
  });

  it('identifiers must match exactly (OD-59)', () => {
    expect(equalInMeaning('isin', 'INE123A01011', 'ine123a01011')).toBe(false);
    expect(c({ fieldName: 'symbol', value1: 'ABC', value2: 'abc' })).toBeNull();
  });
});

describe('OD-59 through the shared comparator (areEquivalent, one implementation)', () => {
  const base = { fieldName: 'issueSize', source1: 'NSE', source2: 'BSE', resolutionReason: null, family: 'MONEY' };
  it('a 0.4% money difference is the same value (OD-59), not a disagreement', () => {
    expect(ruleFilterFor({ ...base, value1: '1000000', value2: '1004000' })).toBe('OD-59');
  });
  it('a 0.6% money difference stays a real disagreement', () => {
    expect(ruleFilterFor({ ...base, value1: '1000000', value2: '1006000' })).toBeNull();
  });
  it('with no family known the 0.4% pair stays on the disagreement list (safe direction)', () => {
    expect(ruleFilterFor({ ...base, family: undefined, value1: '1000000', value2: '1004000' })).toBeNull();
  });
});
