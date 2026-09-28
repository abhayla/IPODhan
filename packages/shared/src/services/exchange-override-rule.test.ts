import { describe, it, expect } from 'vitest';
import { E1_EXCHANGE_STATED_FIELDS } from '../repositories/field-sources-repository';
import {
  EXCHANGE_OVERRIDE_FIELDS,
  decideExchangeOverride,
  exchangeOverrideDedupeKey,
  isExchangeOverrideField,
  isInstantAlertStatus,
  normalizeExchangeValue,
} from './exchange-override-rule';

// Real-shaped values from F-131 (Dhanwel): the admin held the June close date; NSE's relaunch
// board states the August one.
const HELD = '2026-06-29';
const NSE_NEW = '2026-08-21';

const nse = (value: unknown, outcome = 'SUPPLIED') => ({ source: 'NSE', value, outcome });
const bse = (value: unknown, outcome = 'SUPPLIED') => ({ source: 'BSE', value, outcome });

describe('OD-106 "newer": differs from the admin value AND from what that exchange said at save', () => {
  it('replaces when the exchange now differs from both', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: HELD, BSE: null }, answers: [nse(NSE_NEW)] })).toEqual({
      kind: 'REPLACE',
      source: 'NSE',
      value: NSE_NEW,
    });
  });

  it('keeps the admin value when the exchange still says what it said at save (the value the admin replaced)', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: '2026-07-01', BSE: null }, answers: [nse('2026-07-01')] })
    ).toEqual({ kind: 'KEEP', reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE' });
  });

  it('keeps when the exchange agrees with the admin', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers: [nse(HELD)] })).toEqual({
      kind: 'KEEP',
      reason: 'EXCHANGE_AGREES_WITH_ADMIN',
    });
  });

  it('item 28(a): an admin EMPTY value is replaced by a newer exchange value', () => {
    expect(decideExchangeOverride({ adminValue: null, exchangeAtSave: { NSE: null, BSE: null }, answers: [nse(NSE_NEW)] })).toMatchObject({
      kind: 'REPLACE',
      value: NSE_NEW,
    });
  });

  it('an admin EMPTY value is kept when the exchange still says the value the admin deleted (OD-121)', () => {
    expect(decideExchangeOverride({ adminValue: null, exchangeAtSave: { NSE: NSE_NEW, BSE: null }, answers: [nse(NSE_NEW)] }).kind).toBe(
      'KEEP'
    );
  });

  it('keeps a hold saved before exchangeAtSave was recorded (newer cannot be told apart)', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: undefined, answers: [nse(NSE_NEW)] })).toEqual({
      kind: 'KEEP',
      reason: 'NO_EXCHANGE_AT_SAVE',
    });
  });

  it('ignores non-exchange sources and non-SUPPLIED exchange answers', () => {
    const answers = [nse(null, 'NOT_AVAILABLE_YET'), { source: 'CHITTORGARH', value: NSE_NEW, outcome: 'SUPPLIED' }];
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers })).toEqual({
      kind: 'KEEP',
      reason: 'NO_EXCHANGE_ANSWER',
    });
  });

  it('BSE newer replaces when NSE is unchanged since save; NSE agreeing with the admin stops the search', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: '2026-07-01', BSE: '2026-07-01' }, answers: [nse('2026-07-01'), bse(NSE_NEW)] })
    ).toMatchObject({ kind: 'REPLACE', source: 'BSE' });
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers: [nse(HELD), bse(NSE_NEW)] }).kind
    ).toBe('KEEP');
  });

  it('compares dates by IST day (a Z instant at 18:30 UTC is the next IST day)', () => {
    expect(normalizeExchangeValue('2026-08-20T18:30:00.000Z')).toBe(NSE_NEW);
    expect(normalizeExchangeValue(new Date('2026-08-20T18:30:00.000Z'))).toBe(NSE_NEW);
    expect(normalizeExchangeValue(NSE_NEW)).toBe(NSE_NEW);
    expect(normalizeExchangeValue('')).toBeNull();
    expect(
      decideExchangeOverride({ adminValue: NSE_NEW, exchangeAtSave: { NSE: null, BSE: null }, answers: [nse('2026-08-20T18:30:00.000Z')] }).kind
    ).toBe('KEEP');
  });
});

describe('the OD-106 field set', () => {
  it('is the E-1 set minus status; listingExchanges is not in it (OD-129 moved it out of E-1)', () => {
    expect([...EXCHANGE_OVERRIDE_FIELDS].sort()).toEqual([...E1_EXCHANGE_STATED_FIELDS].filter((f) => f !== 'status').sort());
    expect(EXCHANGE_OVERRIDE_FIELDS.has('status')).toBe(false);
    expect(EXCHANGE_OVERRIDE_FIELDS.has('listingExchanges')).toBe(false);
    expect(EXCHANGE_OVERRIDE_FIELDS.has('closeDate')).toBe(true);
  });

  it('applies to ipos and ipo_details only', () => {
    expect(isExchangeOverrideField('ipos', 'closeDate')).toBe(true);
    expect(isExchangeOverrideField('ipo_details', 'creditOfSharesDate')).toBe(true);
    expect(isExchangeOverrideField('ipos', 'issueSize')).toBe(false);
    expect(isExchangeOverrideField('ipos', 'status')).toBe(false);
    expect(isExchangeOverrideField('anchor_investors', 'bidDate')).toBe(false);
  });
});

describe('the OD-106 alert', () => {
  it('is instant only for UPCOMING or OPEN (OD-112)', () => {
    expect(isInstantAlertStatus('UPCOMING')).toBe(true);
    expect(isInstantAlertStatus('OPEN')).toBe(true);
    expect(isInstantAlertStatus('CLOSED')).toBe(false);
    expect(isInstantAlertStatus('LISTED')).toBe(false);
  });

  it('dedupes per env, IPO, field and IST day (item 25)', () => {
    const late = new Date('2026-08-20T18:29:00Z'); // 23:59 IST on 08-20
    const next = new Date('2026-08-20T18:31:00Z'); // 00:01 IST on 08-21
    expect(exchangeOverrideDedupeKey('staging', 'ipo-1', 'closeDate', late)).toBe('admin-od106:staging:ipo-1:closeDate:2026-08-20');
    expect(exchangeOverrideDedupeKey('staging', 'ipo-1', 'closeDate', next)).toBe('admin-od106:staging:ipo-1:closeDate:2026-08-21');
  });
});
