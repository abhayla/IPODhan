import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runOpeningDayDiscovery,
  selectOpeningToday,
  createOpeningDayWriter,
  OPENING_DAY_FIELDS,
  type OpeningDayPayload,
} from '../../../src/scheduler/opening-day-discovery.js';
import { fetchCurrentIssueList } from '../../../src/scrapers/nse-api-client.js';
import { fetchBSEBoard, type BSEListRow } from '../../../src/scrapers/bse-api-scraper.js';
import type { ScrapedIPO } from '../../../src/utils/validators.js';

/**
 * Item 7 S4 (spec §2.1 "Opening-day check" as amended by OD-87, §7.4 "2 calls a
 * day"): the two list calls only, today's (IST) rows only, identity + status +
 * open/close dates only, through identity resolution and the consolidated upsert.
 * BSE rows are real board rows captured live 2026-09-24 (IPO_HomePageDetail/w).
 */

// 2026-09-24 10:15 IST
const NOW = new Date('2026-09-24T04:45:00Z');

const bse = (name: string, ipoNo: number, start: string, end: string, status = 'L'): BSEListRow => ({
  Scrip_name: name, Start_Dt: `${start}T00:00:00`, End_Dt: `${end}T00:00:00`, Status: status,
  IR_flag: 'IPO', IR_FLAG_FULL: 'Book Building', IPO_NO: ipoNo, Scrip_cd: 0,
});
const BSE_ROWS: BSEListRow[] = [
  bse('PESHWA WHEAT LIMITED', 8000, '2026-09-24', '2026-09-28'),
  bse('Swastika Infra Limited', 7991, '2026-09-23', '2026-09-25'),
  bse('Orient Cables (India) Limited', 8001, '2026-09-25', '2026-09-29', 'F'),
];

const nse = (name: string, symbol: string, series: 'EQ' | 'SME', open: string, close: string): ScrapedIPO => ({
  companyName: name, openDate: open, closeDate: close, status: 'OPEN', listingExchange: 'NSE',
  segment: series === 'SME' ? 'SME' : 'MAINBOARD', offeringType: 'IPO', symbol,
  priceRangeMin: 100, priceRangeMax: 105, lotSize: 140, issueSize: 5_000_000_000, registrar: 'X Registrar',
  sourceKeys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: `${symbol}|${series}`, attrs: {}, recordOpenDate: open }],
} as any);
const NSE_ROWS: ScrapedIPO[] = [
  nse('Moneyview Limited', 'MONEYVIEW', 'EQ', '2026-09-24', '2026-09-28'),
  nse('Green Asia Impex Limited', 'GREENASIA', 'SME', '2026-09-24', '2026-09-28'),
  nse('Varmora Granito Limited', 'VARMORA', 'EQ', '2026-09-22', '2026-09-24'),
];

const ALLOWED_PAYLOAD_KEYS = new Set([
  ...OPENING_DAY_FIELDS, 'symbol', 'segment', 'listingExchange', 'offeringType', 'sourceKeys',
]);

function deps(overrides: Partial<Parameters<typeof runOpeningDayDiscovery>[0]> = {}) {
  const writeRow = vi.fn().mockResolvedValue('updated');
  return {
    writeRow,
    d: {
      fetchNseList: vi.fn().mockResolvedValue(NSE_ROWS),
      fetchBseList: vi.fn().mockResolvedValue(BSE_ROWS),
      storedOpeningOn: vi.fn().mockResolvedValue([]),
      writeRow,
      ...overrides,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('opening-day discovery — the two list calls only (§7.4)', () => {
  it('(a)+(d) one run makes exactly one NSE list and one BSE list request; no detail, subscription or category call', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u));
      if (u.includes('/api/ipo-current-issue')) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes('IPO_HomePageDetail')) return new Response(JSON.stringify({ Table: [] }), { status: 200 });
      // NSE session warm-up pages (makeRequest on a cold cookie jar).
      return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'nsit=1; Path=/' } });
    }));
    const { d } = deps({ fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard });
    await runOpeningDayDiscovery(d, NOW);
    const apiCalls = calls.filter((u) => u.includes('/api/') || u.includes('BseIndiaAPI'));
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls.filter((u) => u.includes('/api/ipo-current-issue'))).toHaveLength(1);
    expect(apiCalls.filter((u) => u.includes('IPO_HomePageDetail/w'))).toHaveLength(1);
    expect(calls.some((u) => /ipo-active-category|ipo-detail|GetMkt_ISSUE|Pubissues_GetBkbldgCatdem/.test(u))).toBe(false);
  });
});

describe('opening-day discovery — only rows opening today (IST)', () => {
  it('(b) of rows opening yesterday, today and tomorrow, only today\'s are written', async () => {
    const { d, writeRow } = deps();
    const s = await runOpeningDayDiscovery(d, NOW);
    expect(s.todayIso).toBe('2026-09-24');
    const names = writeRow.mock.calls.map(([, p]) => p.companyName).sort();
    expect(names).toEqual(['Green Asia Impex Limited', 'Moneyview Limited', 'PESHWA WHEAT LIMITED']);
    expect(s.nseRowsChecked).toBe(3);
    expect(s.bseRowsChecked).toBe(3);
  });

  it('(f) at 2026-09-23T19:00:00Z (= 24 Sep 00:30 IST) the 24-Sep rows are selected, not the 23-Sep ones', async () => {
    const { d, writeRow } = deps();
    const s = await runOpeningDayDiscovery(d, new Date('2026-09-23T19:00:00Z'));
    expect(s.todayIso).toBe('2026-09-24');
    const names = writeRow.mock.calls.map(([, p]) => p.companyName);
    expect(names).toContain('PESHWA WHEAT LIMITED');
    expect(names).not.toContain('Swastika Infra Limited');
  });

  it('(c) each payload carries only identity, status and the two dates — no band, lot, size or registrar', () => {
    const kept = selectOpeningToday(NSE_ROWS, BSE_ROWS, '2026-09-24');
    expect(kept).toHaveLength(3);
    for (const { payload } of kept) {
      for (const k of Object.keys(payload)) expect(ALLOWED_PAYLOAD_KEYS.has(k as any)).toBe(true);
      expect(payload).not.toHaveProperty('priceRangeMin');
      expect(payload).not.toHaveProperty('lotSize');
      expect(payload).not.toHaveProperty('issueSize');
    }
    const peshwa = kept.find((k) => k.source === 'BSE')!.payload;
    expect(peshwa.sourceKeys[0]).toMatchObject({ keyType: 'BSE_IPO_NO', keyValue: '8000' });
    expect(peshwa.status).toBe('OPEN');
    expect(peshwa.segment).toBeUndefined();
  });

  it('one list failing still writes the other list\'s rows and reports the failure', async () => {
    const { d, writeRow } = deps({ fetchNseList: vi.fn().mockRejectedValue(new Error('NSE 403')) });
    const s = await runOpeningDayDiscovery(d, NOW);
    expect(writeRow).toHaveBeenCalledTimes(1);
    expect(s.failures).toEqual(['NSE list: NSE 403']);
  });
});

describe('opening-day writer — identity path + field-priority decision, four fields only', () => {
  const payload: OpeningDayPayload = selectOpeningToday(NSE_ROWS, [], '2026-09-24')[0].payload;

  function collaborators(existing: any) {
    const c = {
      ipoRepository: {
        bindSourceKeys: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 'ipo-new' }),
      },
      resolveIpoRow: vi.fn().mockResolvedValue(existing),
      inferBoundVia: vi.fn().mockReturnValue('KEY'),
      withSourceKeyLineage: vi.fn(async (fn: () => Promise<any>) => fn()),
      noWriteErrorNames: new Set(['SourceKeyHeldError']),
      fieldProtection: {
        isIPOLocked: vi.fn().mockResolvedValue(false),
        filterProtectedFields: vi.fn(async (_id: string, _t: string, data: any) => ({ filtered: { ...data } })),
      },
      // The incoming value wins (the matrix decision is exercised for real in opening-day-strict-write.test.ts).
      consolidateFields: vi.fn(async (input: any) => ({
        fieldResults: Object.entries(input.incomingData).map(([fieldName, finalValue]) => ({ fieldName, finalValue })),
      })),
      normalizeName: (n: string) => n.toLowerCase(),
      identitySlug: () => 'moneyview-limited',
    };
    return c;
  }

  it('(e1) not yet stored: resolves by the NSE key, asks the matrix about the four fields, creates with identity only', async () => {
    const c = collaborators(null);
    expect(await createOpeningDayWriter(c)('NSE', payload)).toBe('inserted');
    expect(c.resolveIpoRow.mock.calls[0][1].sourceKeys[0].keyValue).toBe('MONEYVIEW|EQ');
    const input = c.consolidateFields.mock.calls[0][0];
    expect([input.source, input.confidence, input.existingData]).toEqual(['NSE', 95, undefined]);
    expect(Object.keys(input.incomingData)).toEqual(['companyName', 'status', 'openDate', 'closeDate']);
    const [values, opts] = c.ipoRepository.create.mock.calls[0];
    expect(Object.keys(values).sort()).toEqual(['closeDate', 'companyName', 'offeringType', 'openDate', 'slug', 'status']);
    expect(opts).toEqual({ sourceKeys: payload.sourceKeys, boundBy: 'scraper:NSE' });
  });

  it('(e2) stored with a NULL open date: binds the key and SETs the open date', async () => {
    const c = collaborators({ id: 'ipo-1', companyName: 'Moneyview Limited', status: 'OPEN', openDate: null, closeDate: '2026-09-28', segment: 'MAINBOARD', offeringType: 'IPO' });
    expect(await createOpeningDayWriter(c)('NSE', payload)).toBe('updated');
    expect(c.ipoRepository.bindSourceKeys).toHaveBeenCalledWith('ipo-1', payload.sourceKeys, { boundVia: 'KEY', boundBy: 'scraper:NSE' });
    expect(c.ipoRepository.update).toHaveBeenCalledWith('ipo-1', { openDate: '2026-09-24' });
  });

  it('(e3) stored with an old (postponed) open date: the matrix sees both values; its pick is written', async () => {
    const c = collaborators({ id: 'ipo-1', companyName: 'Moneyview Limited', status: 'OPEN', openDate: '2026-08-10', closeDate: '2026-09-28', segment: 'MAINBOARD', offeringType: 'IPO' });
    expect(await createOpeningDayWriter(c)('NSE', payload)).toBe('updated');
    const input = c.consolidateFields.mock.calls[0][0];
    expect(input.incomingData.openDate).toBe('2026-09-24');
    expect(input.existingData.openDate).toBe('2026-08-10');
    expect(c.ipoRepository.update).toHaveBeenCalledWith('ipo-1', { openDate: '2026-09-24' });
  });

  it('protected fields are dropped from the claim; a locked IPO is skipped', async () => {
    const c = collaborators({ id: 'ipo-1', openDate: null, offeringType: 'IPO' });
    c.fieldProtection.filterProtectedFields = vi.fn(async (_i: string, _t: string, data: any) => {
      const { status: _s, ...rest } = data;
      return { filtered: rest };
    });
    await createOpeningDayWriter(c)('NSE', payload);
    expect(Object.keys(c.consolidateFields.mock.calls[0][0].incomingData)).toEqual(['companyName', 'openDate', 'closeDate']);

    const locked = collaborators({ id: 'ipo-2' });
    locked.fieldProtection.isIPOLocked = vi.fn().mockResolvedValue(true);
    expect(await createOpeningDayWriter(locked)('NSE', payload)).toBe('skipped');
    expect(locked.consolidateFields).not.toHaveBeenCalled();
    expect(locked.ipoRepository.bindSourceKeys).not.toHaveBeenCalled();
  });

  it('an OD-85 no-write decision (held / superseded key) writes nothing', async () => {
    const c = collaborators(null);
    const err = Object.assign(new Error('held'), { name: 'SourceKeyHeldError' });
    c.resolveIpoRow = vi.fn().mockRejectedValue(err);
    expect(await createOpeningDayWriter(c)('NSE', payload)).toBe('skipped');
    expect(c.consolidateFields).not.toHaveBeenCalled();
    expect(c.ipoRepository.create).not.toHaveBeenCalled();
  });
});
