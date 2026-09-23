/**
 * I4 / W-41 — exchange signal -> terminal IPO status mapping tables.
 *
 * Before this, `ipo_status` had no WITHDRAWN/POSTPONED value and both derivers
 * were pure date ladders, so a pulled issue kept marching UPCOMING -> OPEN ->
 * CLOSED (and then LISTED via the updater) while document-cycle's withdrawal
 * branch — which HAS existed since T-403 — could never fire.
 *
 * The mapping is deliberately conservative. Live enumeration on 2026-09-02:
 *   BSE  /IPO_HomePageDetail/w      -> Status codes seen: 'L' (20), 'F' (4).
 *                                      Notes/Remarks empty on every IPO row.
 *   NSE  /all-upcoming-issues?ipo   -> status texts: 'Active', 'Closed',
 *                                      'Forthcoming'.
 * Neither exchange was publishing a withdrawal today, so nothing on the live
 * board maps to a terminal status — these tables are the contract for when one
 * does, and the "unknown code keeps the date-derived status" cases below are
 * what stops a guess from killing a live IPO.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyWithdrawalText,
  deriveBSEStatus,
  mapBSEToScrapedIPO,
  bseSourceKeys,
  type BSEListRow,
  type BSEDetailRow,
} from '../../../src/scrapers/bse-api-scraper.js';
import { determineStatus } from '../../../src/scrapers/nse-api-client.js';

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// BSE's live record IPO_NO 7794 (Dhanwel, F-144), Notes field verbatim.
const DHANWEL_7794_NOTE = 'As informed by company mentioned issue of Dhanwel Hybrid Seeds Limited has been postponed';
const DHANWEL = ['Dhanwel Hybrid Seeds Ltd', 'DHANWEL'];

describe('classifyWithdrawalText (BSE Notes/Remarks/Public_Notices)', () => {
  it('the REAL 7794 note -> POSTPONED for Dhanwel\'s own record', () => {
    expect(classifyWithdrawalText(DHANWEL_7794_NOTE, DHANWEL)).toBe('POSTPONED');
  });

  const withdrawals: [string, string[]][] = [
    ['The Issue has been withdrawn by the Company.', []],
    ['Public Notice: withdrawal of the public issue', []],
    ['The IPO stands withdrawn.', []],
    ['The issue of Example Industries Limited has been withdrawn.', ['Example Industries Ltd']],
    ['As informed by company mentioned issue of Dhanwel Hybrid Seeds Limited has been withdrawn', DHANWEL],
    // withdrawn after an earlier postponement: dead, not postponed
    ['The issue of Dhanwel Hybrid Seeds Limited, which was postponed, has been withdrawn', DHANWEL],
  ];
  it.each(withdrawals)('maps %j -> WITHDRAWN', (text, names) => {
    expect(classifyWithdrawalText(text, names)).toBe('WITHDRAWN');
  });

  const postponements: [string, string[]][] = [
    ['The Issue has been postponed until further notice.', []],
    ['Postponement of the public issue', []],
    ['The offer is deferred.', []],
    ['The issue is rescheduled.', []],
    // reconstructed spelling of the same shape (kept as an extra case; the real one is pinned above)
    ['The issue of Dhanwel Hybrid Seeds Ltd has been postponed', DHANWEL],
  ];
  it.each(postponements)('maps %j -> POSTPONED', (text, names) => {
    expect(classifyWithdrawalText(text, names)).toBe('POSTPONED');
  });

  // The dangerous half: BSE notes routinely talk about bid withdrawal by
  // investors, or about some OTHER issue (bonus shares, allotment advice, refunds).
  // Firing on those would mark a LIVE, healthy IPO as dead or postponed.
  const benign: [string | null | undefined, string[]][] = [
    ['Withdrawal of bids by Retail Individual Investors is permitted until the closing date.', DHANWEL],
    ['Investors may revise or withdraw their bids.', DHANWEL],
    ['Payment postponed to T+2 settlement.', DHANWEL],
    ['The issue of refund orders has been postponed.', DHANWEL],
    ['The issue of allotment advice is rescheduled.', DHANWEL],
    ['The issue of bonus shares by XYZ Limited has been postponed', ['XYZ Ltd']],
    ['The issue of allotment advice for ABC Limited has been postponed', ['ABC Limited']],
    ['The issue of refund orders of ABC Limited has been postponed', ['ABC Limited']],
    ['The issue of listing notice of ABC Limited has been withdrawn', ['ABC Limited']],
    // a note naming ANOTHER issuer does not postpone this record
    [DHANWEL_7794_NOTE, ['Some Other Company Ltd']],
    // no record name supplied -> an "issue of <company>" note cannot be anchored, so it does not fire
    [DHANWEL_7794_NOTE, []],
    ['', DHANWEL],
    [null, DHANWEL],
    [undefined, DHANWEL],
  ];
  it.each(benign)('does NOT fire on %j', (text, names) => {
    expect(classifyWithdrawalText(text, names)).toBeNull();
  });

  it('withdrawn wins over postponed when a note carries both', () => {
    expect(
      classifyWithdrawalText('The issue was postponed on 01 Sep and the issue has been withdrawn on 03 Sep.'),
    ).toBe('WITHDRAWN');
  });
});

describe('bseSourceKeys carries the exchange postponed flag (OD-83 / OD-86 read it)', () => {
  it('Dhanwel IPO_NO 7794 (real note) -> attrs.postponed true; 7900 -> false', () => {
    const row = (ipoNo: string, period: string, notes?: string) => ({
      IPO_NO: ipoNo, ScripCode: '', ScripName: 'Dhanwel Hybrid Seeds Ltd', Symbol: 'DHANWEL', Issue_Period: period,
      Issue_Size_No_of_shares: '2700000', Price_Band: '95.00-99.00', Face_Value: '10.00', Market_Lot: '1200', Notes: notes,
    }) as unknown as BSEDetailRow;
    const k7794 = bseSourceKeys(row('7794', '23 Jun 2026 to 23 Jun 2026', DHANWEL_7794_NOTE),
      2_700_000, { min: 95, max: 99 }, '2026-06-23', '2026-06-23', '2026-09-23');
    const k7900 = bseSourceKeys(row('7900', '19 Aug 2026 to 21 Aug 2026'), 2_700_000, { min: 95, max: 99 }, '2026-08-19', '2026-08-21', '2026-09-23');
    expect(k7794[0].attrs!.postponed).toBe(true);
    expect(k7900[0].attrs!.postponed).toBe(false);
  });

  it('a bonus-share note on a record does not flag it postponed', () => {
    const k = bseSourceKeys({
      IPO_NO: '7001', ScripCode: '', ScripName: 'ABC Limited', Symbol: 'ABC', Issue_Period: '',
      Issue_Size_No_of_shares: '1000', Price_Band: '10.00-11.00', Face_Value: '10.00', Market_Lot: '100',
      Notes: 'The issue of bonus shares by ABC Limited has been postponed',
    } as unknown as BSEDetailRow, 1000, { min: 10, max: 11 }, '2026-06-23', '2026-06-23', '2026-09-23');
    expect(k[0].attrs!.postponed).toBe(false);
  });
});

describe('deriveBSEStatus with an exchange signal', () => {
  // Window that would otherwise derive CLOSED — the point of the assertion is
  // that the terminal signal beats the calendar, not that the dates are absent.
  const open = '2026-08-25';
  const close = '2026-08-27';
  const today = '2026-09-02';

  it('date ladder still wins when there is no signal at all', () => {
    expect(deriveBSEStatus(open, close, today)).toBe('CLOSED');
    expect(deriveBSEStatus('2026-09-10', '2026-09-12', today)).toBe('UPCOMING');
    expect(deriveBSEStatus('2026-09-01', '2026-09-03', today)).toBe('OPEN');
  });

  it.each([
    ['L', 'CLOSED'],
    ['F', 'CLOSED'],
  ])('known live-board code %s does not override the date-derived status', (code, expected) => {
    expect(deriveBSEStatus(open, close, today, { statusCode: code })).toBe(expected);
  });

  it('an UNKNOWN status code keeps the date-derived status (never a guess)', () => {
    expect(deriveBSEStatus(open, close, today, { statusCode: 'W' })).toBe('CLOSED');
    expect(deriveBSEStatus(open, close, today, { statusCode: 'ZZ' })).toBe('CLOSED');
  });

  it('a withdrawal note overrides the window', () => {
    expect(
      deriveBSEStatus(open, close, today, {
        statusCode: 'L',
        notes: ['', null, 'Public Notice: the issue has been withdrawn'],
      }),
    ).toBe('WITHDRAWN');
  });

  it('a postponement note overrides the window', () => {
    expect(
      deriveBSEStatus('2026-09-01', '2026-09-03', today, {
        statusCode: 'L',
        notes: ['The public issue has been postponed.'],
      }),
    ).toBe('POSTPONED');
  });
});

describe('mapBSEToScrapedIPO carries the terminal status end-to-end', () => {
  const list: BSEListRow = {
    Scrip_name: 'Deepa Jewellers Limited',
    Start_Dt: '2026-09-01T00:00:00',
    End_Dt: '2026-09-03T00:00:00',
    Status: 'L',
    IR_flag: 'IPO',
    IR_FLAG_FULL: 'Book Building',
    IPO_NO: 7922,
    Scrip_cd: 4777,
  };
  const baseDetail = {
    IPO_NO: '7922',
    ScripCode: '4777',
    ScripName: 'Deepa Jewellers Limited',
    Symbol: 'DEEPA',
    Issue_Period: '01 Sep 2026 to 03 Sep 2026',
    Issue_Size_No_of_shares: '18520085',
    Price_Band: '168.00-177.00',
    Face_Value: '2.00',
    Market_Lot: '84',
  } as BSEDetailRow;

  it('the live board today has no withdrawal note -> ordinary date-derived status', () => {
    // Byte-for-byte the shape BSE returned for IPO_NO 7922 on 2026-09-02:
    // Notes, Remarks and Public_Notices are all empty strings.
    const ipo = mapBSEToScrapedIPO(list, { ...baseDetail, Notes: '', Remarks: '', Public_Notices: '' });
    expect(['UPCOMING', 'OPEN', 'CLOSED']).toContain(ipo.status);
  });

  it('a withdrawal in Remarks reaches ScrapedIPO.status', () => {
    const ipo = mapBSEToScrapedIPO(list, {
      ...baseDetail,
      Remarks: 'The public issue has been withdrawn by the Company.',
    });
    expect(ipo.status).toBe('WITHDRAWN');
  });
});

describe('NSE determineStatus mapping table', () => {
  const start = '2026-08-25';
  const end = '2026-08-27';

  // Texts actually served by /api/all-upcoming-issues?category=ipo (2026-09-02).
  it.each([
    ['Active', 'OPEN'],
    ['Closed', 'CLOSED'],
    ['Forthcoming', 'UPCOMING'],
  ])('live text %j -> %s', (text, expected) => {
    expect(determineStatus(text, start, end)).toBe(expected);
  });

  it.each([
    ['Withdrawn', 'WITHDRAWN'],
    ['Issue Withdrawn', 'WITHDRAWN'],
    ['WITHDRAWAL', 'WITHDRAWN'],
    ['Postponed', 'POSTPONED'],
    ['Issue Deferred', 'POSTPONED'],
    ['Rescheduled', 'POSTPONED'],
  ])('terminal text %j -> %s', (text, expected) => {
    expect(determineStatus(text, start, end)).toBe(expected);
  });

  it('a terminal text beats the date ladder (window already passed)', () => {
    // Without the terminal branch this would be CLOSED, and the updater would
    // then walk it to LISTED on the listing date that never comes.
    expect(determineStatus('Withdrawn', '2020-01-01', '2020-01-05')).toBe('WITHDRAWN');
  });

  it('an unrecognised text falls back to the date ladder, not to a terminal state', () => {
    expect(determineStatus('Some New NSE Label', '2020-01-01', '2020-01-05')).toBe('CLOSED');
  });
});
