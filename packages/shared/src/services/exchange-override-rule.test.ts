import { describe, it, expect } from 'vitest';
import { E1_EXCHANGE_STATED_FIELDS } from '../repositories/field-sources-repository';
import {
  EXCHANGE_OVERRIDE_FIELDS,
  decideExchangeOverride,
  exchangeOverrideDedupeKey,
  isExchangeOverrideField,
  isInstantAlertStatus,
  normalizeExchangeValue,
  resolveExchangeBaseline,
  baselineEvidenceFromWitnesses,
  baselineForAdminSave,
} from './exchange-override-rule';
import { lowerRankDisagreementKey } from './exchange-override';

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

  it('MAJOR-1: an UNKNOWN baseline (hold saved before exchangeAtSave) records the first held answer and does not replace on it', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: undefined, answers: [nse(NSE_NEW)] })).toEqual({
      kind: 'KEEP',
      reason: 'BASELINE_RECORDED',
      baseline: { NSE: NSE_NEW },
    });
  });

  it('MAJOR-1: a later read that differs from the recorded first-read baseline replaces', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: NSE_NEW }, answers: [nse('2026-09-04')] })).toEqual({
      kind: 'REPLACE',
      source: 'NSE',
      value: '2026-09-04',
    });
  });

  it('MAJOR-1: unknown is not "answered nothing": a known-null exchange replaces at once, an unknown one only records', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null }, answers: [nse(NSE_NEW)] }).kind).toBe('REPLACE');
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: {}, answers: [nse(NSE_NEW)] }).kind).toBe('KEEP');
  });

  it('MAJOR-1: per source: BSE unknown is recorded while a known NSE baseline still decides', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: '2026-07-01' }, answers: [nse('2026-07-01'), bse(NSE_NEW)] })
    ).toEqual({ kind: 'KEEP', reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE', baseline: { BSE: NSE_NEW } });
  });

  it('MAJOR-1: an unknown source that explicitly does not print records null; one whose check FAILED stays unknown', () => {
    // NSE NOT_PRINTED hands the decision to BSE (OD-145); BSE's read FAILED, so BSE is unknown: KEEP.
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: undefined, answers: [nse(null, 'NOT_PRINTED'), bse(null, 'FAILED')] })
    ).toEqual({ kind: 'KEEP', reason: 'TOP_EXCHANGE_UNKNOWN', baseline: { NSE: null } });
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: undefined, answers: [bse(null, 'CHECK_FAILED')] })).toEqual({
      kind: 'KEEP',
      reason: 'TOP_EXCHANGE_UNKNOWN',
    });
  });

  it('OD-141: a non-date top-exchange answer is UNKNOWN: BSE does not release, its newer value goes to the queue', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers: [nse('To be announced'), bse(NSE_NEW)] })
    ).toEqual({
      kind: 'KEEP',
      reason: 'TOP_EXCHANGE_UNKNOWN',
      lowerRankDisagreement: { source: 'BSE', value: NSE_NEW, topSource: 'NSE' },
    });
  });

  it('ignores non-exchange sources and non-SUPPLIED exchange answers', () => {
    const answers = [nse(null, 'NOT_AVAILABLE_YET'), { source: 'CHITTORGARH', value: NSE_NEW, outcome: 'SUPPLIED' }];
    // OD-145: NSE NOT_AVAILABLE_YET is UNKNOWN, so the top exchange is unknown (not "no answer").
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers })).toEqual({
      kind: 'KEEP',
      reason: 'TOP_EXCHANGE_UNKNOWN',
    });
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: null }, answers: answers.slice(1) })).toEqual({
      kind: 'KEEP',
      reason: 'NO_EXCHANGE_ANSWER',
    });
  });

  it('ROUND 3: NSE (rank 1) unchanged since save stops the scan, so a BSE change never releases the hold; NSE agreeing stops it too', () => {
    // After a release the walk writes the top-ranked answer: releasing on BSE would restore NSE's
    // rejected 2026-07-01.
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: '2026-07-01', BSE: '2026-07-01' }, answers: [nse('2026-07-01'), bse(NSE_NEW)] })
    ).toEqual({
      kind: 'KEEP',
      reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE',
      lowerRankDisagreement: { source: 'BSE', value: NSE_NEW, topSource: 'NSE' },
    });
    // An unknown-baseline rank-1 date also decides (records, keeps); BSE's unknown baseline is recorded too.
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { BSE: '2026-07-01' }, answers: [nse('2026-07-01'), bse(NSE_NEW)] })
    ).toEqual({
      kind: 'KEEP',
      reason: 'BASELINE_RECORDED',
      baseline: { NSE: '2026-07-01' },
      lowerRankDisagreement: { source: 'BSE', value: NSE_NEW, topSource: 'NSE' },
    });
    // NSE stating nothing leaves BSE to decide.
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: '2026-07-01' }, answers: [nse(null, 'NOT_PRINTED'), bse(NSE_NEW)] })
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

describe('MAJOR-1: rebuilding an unknown baseline from the ADMIN row', () => {
  it('a legacy ADMIN row whose previous_source is NSE rebuilds NSE from previous_value; BSE stays unknown', () => {
    expect(
      resolveExchangeBaseline({ lineage: { method: 'ADMIN_FIELD_WRITE' }, source: 'ADMIN', previousSource: 'NSE', previousValue: '2026-08-21' })
    ).toEqual({ baseline: { NSE: '2026-08-21' }, rebuilt: ['NSE'] });
  });

  it('a recorded exchangeAtSave is used as is; previous_value never overrides it', () => {
    expect(
      resolveExchangeBaseline({ lineage: { exchangeAtSave: { NSE: HELD, BSE: null } }, source: 'ADMIN', previousSource: 'NSE', previousValue: '2026-01-01' })
    ).toEqual({ baseline: { NSE: HELD, BSE: null }, rebuilt: [] });
  });

  it('previous_source that is not an exchange (or a re-save by ADMIN) rebuilds nothing', () => {
    expect(resolveExchangeBaseline({ lineage: null, source: 'ADMIN', previousSource: 'ADMIN', previousValue: HELD })).toEqual({ baseline: {}, rebuilt: [] });
    expect(resolveExchangeBaseline({ lineage: null, source: 'ADMIN', previousSource: 'CHITTORGARH', previousValue: HELD })).toEqual({ baseline: {}, rebuilt: [] });
  });

  it('a non-ADMIN provenance row has no admin baseline at all', () => {
    expect(resolveExchangeBaseline({ lineage: { exchangeAtSave: { NSE: HELD } }, source: 'NSE', previousSource: 'NSE', previousValue: HELD })).toBeNull();
  });
});

describe('the OD-106 field set', () => {
  it('is the E-1 set minus status and bidDate; listingExchanges is not in it (OD-129 moved it out of E-1)', () => {
    expect([...EXCHANGE_OVERRIDE_FIELDS].sort()).toEqual(
      [...E1_EXCHANGE_STATED_FIELDS].filter((f) => f !== 'status' && f !== 'bidDate').sort()
    );
    expect(EXCHANGE_OVERRIDE_FIELDS.has('status')).toBe(false);
    // MAJOR-2: anchor_investors.bidDate is row-keyed; admins cannot hold anchor rows until Phase B item 8 (#1281).
    expect(EXCHANGE_OVERRIDE_FIELDS.has('bidDate')).toBe(false);
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

describe('ROUND 3: one evidence rule for every baseline write site', () => {
  it('stored SUPPLIED -> value; NOT_PRINTED -> null; NOT_AVAILABLE_YET, nothing, CHECK_FAILED, FAILED -> unknown (OD-145)', () => {
    const at = '2026-09-01T05:00:00.000Z';
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', value: '2026-10-05', outcome: 'SUPPLIED', at }], 'NSE')).toEqual({ known: true, value: '2026-10-05', at });
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', value: '2026-10-05' }], 'NSE')).toMatchObject({ known: true, value: '2026-10-05' });
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', outcome: 'NOT_PRINTED' }], 'NSE')).toMatchObject({ known: true, value: null });
    expect(baselineEvidenceFromWitnesses([{ source: 'BSE', outcome: 'NOT_AVAILABLE_YET' }], 'BSE')).toEqual({ known: false });
    expect(baselineEvidenceFromWitnesses(null, 'NSE')).toEqual({ known: false });
    expect(baselineEvidenceFromWitnesses([{ source: 'BSE', value: '2026-10-05' }], 'NSE')).toEqual({ known: false });
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', outcome: 'CHECK_FAILED' }], 'NSE')).toEqual({ known: false });
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', outcome: 'FAILED' }], 'NSE')).toEqual({ known: false });
    expect(baselineEvidenceFromWitnesses([{ source: 'NSE', value: null, outcome: 'SUPPLIED' }], 'NSE')).toEqual({ known: false });
  });

  it('a fresh save with no stored evidence leaves every exchange absent (unknown), never null', () => {
    expect(baselineForAdminSave({ prior: null, evidence: { NSE: { known: false }, BSE: { known: false } } })).toEqual({ baseline: {}, origin: {} });
  });

  it('a re-save carries the prior known baseline forward; only NEWER stored evidence replaces an entry', () => {
    const prior = { baseline: { NSE: '2026-10-05' }, origin: { NSE: 'PREVIOUS_VALUE' as const }, since: '2026-09-20T00:00:00.000Z' };
    expect(baselineForAdminSave({ prior, evidence: { NSE: { known: false }, BSE: { known: false } } })).toEqual({
      baseline: { NSE: '2026-10-05' },
      origin: { NSE: 'PREVIOUS_VALUE' },
    });
    // Older evidence does not replace the carried entry; newer evidence does.
    expect(
      baselineForAdminSave({ prior, evidence: { NSE: { known: true, value: null, at: '2026-09-01T00:00:00.000Z' } } }).baseline
    ).toEqual({ NSE: '2026-10-05' });
    expect(
      baselineForAdminSave({ prior, evidence: { NSE: { known: true, value: '2026-10-09', at: '2026-09-25T00:00:00.000Z' } } })
    ).toEqual({ baseline: { NSE: '2026-10-09' }, origin: { NSE: 'SAVE' } });
  });
});

// OD-141 (owner 2026-09-29, narrows OD-106): only the highest-ranked exchange that states the field
// releases an admin value or an admin EMPTY. Round-3 finding (#1287): NSE CHECK_FAILED + BSE moves
// released the hold, and the next walk (NSE first) wrote the date the admin had rejected.
describe('OD-141: only the top-ranked stating exchange releases an admin value', () => {
  const REJECTED = '2026-10-01';
  const BSE_MOVED = '2026-10-05';
  const saved = { NSE: REJECTED, BSE: REJECTED };

  for (const outcome of ['FAILED', 'CHECK_FAILED', 'NOT_AVAILABLE_YET'] as const) {
    it(`NSE ${outcome} + BSE moves -> KEEP, BSE value queued, never REPLACE`, () => {
      expect(
        decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(null, outcome), bse(BSE_MOVED)] })
      ).toEqual({
        kind: 'KEEP',
        reason: 'TOP_EXCHANGE_UNKNOWN',
        lowerRankDisagreement: { source: 'BSE', value: BSE_MOVED, topSource: 'NSE' },
      });
    });
  }

  it('SME_BSE: BSE is the only ranked exchange, so BSE is top and its newer value releases', () => {
    // The walk asks policy.ranks only; for SME_BSE that is BSE, CHITTORGARH (Appendix A), so BSE is top.
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { BSE: REJECTED }, answers: [bse(BSE_MOVED)] })).toEqual({
      kind: 'REPLACE',
      source: 'BSE',
      value: BSE_MOVED,
    });
  });

  it('NSE states the rejected value, BSE moves -> KEEP (unchanged), BSE queued', () => {
    const d = decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(REJECTED), bse(BSE_MOVED)] });
    expect(d).toMatchObject({ kind: 'KEEP', reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE', lowerRankDisagreement: { source: 'BSE' } });
  });

  it('NSE moves -> REPLACE from NSE, whatever BSE says', () => {
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(NSE_NEW), bse(null, 'FAILED')] })).toEqual({
      kind: 'REPLACE',
      source: 'NSE',
      value: NSE_NEW,
    });
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(NSE_NEW), bse(BSE_MOVED)] })).toMatchObject({
      kind: 'REPLACE',
      source: 'NSE',
    });
  });

  it('NSE stated a date at save and now states nothing -> KEEP (withdrew), BSE queued', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(null, 'NOT_PRINTED'), bse(BSE_MOVED)] })
    ).toEqual({
      kind: 'KEEP',
      reason: 'TOP_EXCHANGE_WITHDREW',
      lowerRankDisagreement: { source: 'BSE', value: BSE_MOVED, topSource: 'NSE' },
    });
  });

  it('OD-145 proof 3: an explicit NOT_PRINTED from NSE (baseline unknown) lets BSE decide: BSE newer -> REPLACE from BSE', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { BSE: REJECTED }, answers: [nse(null, 'NOT_PRINTED'), bse(BSE_MOVED)] })
    ).toEqual({ kind: 'REPLACE', source: 'BSE', value: BSE_MOVED });
    // ... and BSE judged the same way: unchanged since save keeps, with NSE's null recorded.
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { BSE: REJECTED }, answers: [nse(null, 'NOT_PRINTED'), bse(REJECTED)] })
    ).toEqual({ kind: 'KEEP', reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE', baseline: { NSE: null } });
  });

  it('NSE stated nothing at save and still explicitly does not print -> BSE is the top stating exchange', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: REJECTED }, answers: [nse(null, 'NOT_PRINTED'), bse(BSE_MOVED)] })
    ).toEqual({ kind: 'REPLACE', source: 'BSE', value: BSE_MOVED });
  });

  it('OD-145: NSE NOT_AVAILABLE_YET never hands down, even with a null baseline, and never records a baseline', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: null, BSE: REJECTED }, answers: [nse(null, 'NOT_AVAILABLE_YET'), bse(BSE_MOVED)] })
    ).toEqual({ kind: 'KEEP', reason: 'TOP_EXCHANGE_UNKNOWN', lowerRankDisagreement: { source: 'BSE', value: BSE_MOVED, topSource: 'NSE' } });
    // The round-4 reproduction as a unit: a legacy hold (no baseline), NSE unknown on walk 1 ...
    const walk1 = decideExchangeOverride({ adminValue: HELD, exchangeAtSave: {}, answers: [nse(null, 'NOT_AVAILABLE_YET'), bse(null, 'NOT_AVAILABLE_YET')] });
    expect(walk1).toEqual({ kind: 'KEEP', reason: 'TOP_EXCHANGE_UNKNOWN' });
    // ... then NSE states its pre-save date on walk 2: recorded as the baseline, NOT a release.
    const walk2 = decideExchangeOverride({ adminValue: HELD, exchangeAtSave: {}, answers: [nse('2026-07-10')] });
    expect(walk2).toEqual({ kind: 'KEEP', reason: 'BASELINE_RECORDED', baseline: { NSE: '2026-07-10' } });
  });

  it('a lower-rank value that is NOT newer (equals the admin value or its own baseline, or baseline unknown) is not queued', () => {
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(null, 'FAILED'), bse(REJECTED)] })
    ).toEqual({ kind: 'KEEP', reason: 'TOP_EXCHANGE_UNKNOWN' });
    expect(decideExchangeOverride({ adminValue: HELD, exchangeAtSave: saved, answers: [nse(null, 'FAILED'), bse(HELD)] })).toEqual({
      kind: 'KEEP',
      reason: 'TOP_EXCHANGE_UNKNOWN',
    });
    expect(
      decideExchangeOverride({ adminValue: HELD, exchangeAtSave: { NSE: REJECTED }, answers: [nse(null, 'FAILED'), bse(BSE_MOVED)] })
    ).toEqual({ kind: 'KEEP', reason: 'TOP_EXCHANGE_UNKNOWN', baseline: { BSE: BSE_MOVED } });
  });

  describe('item 28(a): an admin EMPTY follows the same rule', () => {
    const empty = { NSE: REJECTED, BSE: REJECTED };
    it('NSE moves -> REPLACE', () => {
      expect(decideExchangeOverride({ adminValue: null, exchangeAtSave: empty, answers: [nse(NSE_NEW), bse(BSE_MOVED)] })).toMatchObject({
        kind: 'REPLACE',
        source: 'NSE',
      });
    });
    it('NSE failed, BSE moves -> KEEP empty, BSE queued', () => {
      expect(
        decideExchangeOverride({ adminValue: null, exchangeAtSave: empty, answers: [nse(null, 'CHECK_FAILED'), bse(BSE_MOVED)] })
      ).toEqual({
        kind: 'KEEP',
        reason: 'TOP_EXCHANGE_UNKNOWN',
        lowerRankDisagreement: { source: 'BSE', value: BSE_MOVED, topSource: 'NSE' },
      });
    });
    it('NSE still states the deleted value, BSE moves -> KEEP empty, BSE queued', () => {
      expect(
        decideExchangeOverride({ adminValue: null, exchangeAtSave: empty, answers: [nse(REJECTED), bse(BSE_MOVED)] })
      ).toMatchObject({ kind: 'KEEP', reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE', lowerRankDisagreement: { source: 'BSE' } });
    });
  });

  it('round-3 MINOR: an empty previous_value is an UNKNOWN baseline, not "stated nothing"', () => {
    expect(
      resolveExchangeBaseline({ lineage: {}, source: 'ADMIN', previousSource: 'NSE', previousValue: null })
    ).toEqual({ baseline: {}, rebuilt: [] });
    expect(
      resolveExchangeBaseline({ lineage: {}, source: 'ADMIN', previousSource: 'NSE', previousValue: '' })
    ).toEqual({ baseline: {}, rebuilt: [] });
    expect(
      resolveExchangeBaseline({ lineage: {}, source: 'ADMIN', previousSource: 'NSE', previousValue: REJECTED })
    ).toEqual({ baseline: { NSE: REJECTED }, rebuilt: ['NSE'] });
  });
});

describe('round-4 MINOR: the queue dedupe key includes the admin value', () => {
  it('the same exchange value against a DIFFERENT admin value is a new key; against the same admin value, the same key', () => {
    const k = (admin: string | null) => lowerRankDisagreementKey('ipo-1', 'ipos', '', 'closeDate', admin, 'BSE', '2026-10-05');
    expect(k('2026-10-03')).toBe(k('2026-10-03'));
    expect(k('2026-10-04')).not.toBe(k('2026-10-03'));
    expect(k(null)).not.toBe(k('2026-10-03'));
  });
});
