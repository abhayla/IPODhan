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
  type BSEListRow,
  type BSEDetailRow,
} from '../../../src/scrapers/bse-api-scraper.js';
import { determineStatus } from '../../../src/scrapers/nse-api-client.js';

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('classifyWithdrawalText (BSE Notes/Remarks/Public_Notices)', () => {
  const withdrawals = [
    'The Issue has been withdrawn by the Company.',
    'Public Notice: withdrawal of the public issue',
    'The IPO stands withdrawn.',
  ];
  it.each(withdrawals)('maps %j -> WITHDRAWN', (text) => {
    expect(classifyWithdrawalText(text)).toBe('WITHDRAWN');
  });

  const postponements = [
    'The Issue has been postponed until further notice.',
    'Postponement of the public issue',
    'The offer is deferred.',
    'The issue is rescheduled.',
  ];
  it.each(postponements)('maps %j -> POSTPONED', (text) => {
    expect(classifyWithdrawalText(text)).toBe('POSTPONED');
  });

  // The dangerous half: BSE notes routinely talk about bid withdrawal by
  // investors. Firing on those would mark a LIVE, healthy IPO as dead.
  const benign = [
    'Withdrawal of bids by Retail Individual Investors is permitted until the closing date.',
    'Investors may revise or withdraw their bids.',
    'Payment postponed to T+2 settlement.',
    '',
    null,
    undefined,
  ];
  it.each(benign)('does NOT fire on %j', (text) => {
    expect(classifyWithdrawalText(text as string | null | undefined)).toBeNull();
  });

  it('withdrawn wins over postponed when a note carries both', () => {
    expect(
      classifyWithdrawalText('The issue was postponed on 01 Sep and the issue has been withdrawn on 03 Sep.'),
    ).toBe('WITHDRAWN');
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
