// Self-tests for scripts/lib/nse-holiday-calendar.mjs (F-220, F-221, #1380): the one reader of
// NSE's holiday-master answer, shared by the reconcile tool and the nightly check
// market_holidays_match_nse. Runs on the REAL answer captured 2026-10-02.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareYearToNse,
  fetchNseHolidayMaster,
  interpretNseHolidayAnswer,
  parseNseTradingDate,
  planHolidayReconcile,
} from '../lib/nse-holiday-calendar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BODY = fs.readFileSync(path.join(here, '../../scraper/tests/fixtures/nse/holiday-master-trading-2026-10-02.json'), 'utf8');
const BROKER_15 = ['2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25'];

test('parseNseTradingDate builds the calendar day from components (F-220)', () => {
  assert.equal(parseNseTradingDate('15-Jan-2026'), '2026-01-15');
  assert.equal(parseNseTradingDate(' 3-Mar-2026 '), '2026-03-03');
  assert.equal(parseNseTradingDate('31-Sep-2026'), null);
  assert.equal(parseNseTradingDate('2026-01-15'), null);
  assert.equal(parseNseTradingDate(undefined), null);
});

test('state list: the real CM 2026 answer is the 15 broker dates + 15-Jan election closure on weekdays', () => {
  const a = interpretNseHolidayAnswer(BODY, 2026);
  assert.equal(a.state, 'list');
  assert.equal(a.holidays.length, 20);
  const weekdays = a.holidays.filter((h) => h.weekday !== 'Sat' && h.weekday !== 'Sun').map((h) => h.date);
  assert.deepEqual(weekdays, ['2026-01-15', ...BROKER_15]);
  assert.equal(a.holidays.find((h) => h.date === '2026-01-15').description, 'Municipal Corporation Election - Maharashtra');
});

test('state no-rows-for-year: the real answer carries no 2025 row (the API publishes the current year only)', () => {
  const a = interpretNseHolidayAnswer(BODY, 2025);
  assert.equal(a.state, 'no-rows-for-year');
  assert.deepEqual(a.yearsPresent, [2026]);
});

test('state unparseable-rows: a 2026 row with a bad date blocks 2026 and names the row', () => {
  const bad = BODY.replaceAll('"tradingDate":"14-Sep-2026"', '"tradingDate":"31-Sep-2026"');
  assert.notEqual(bad, BODY);
  const a = interpretNseHolidayAnswer(bad, 2026);
  assert.equal(a.state, 'unparseable-rows');
  assert.equal(a.rows[0].tradingDate, '31-Sep-2026');
});

test('state malformed: non-JSON and a JSON without CM', () => {
  assert.equal(interpretNseHolidayAnswer('<html>Access Denied</html>', 2026).state, 'malformed');
  assert.equal(interpretNseHolidayAnswer('{"CBM":[]}', 2026).state, 'malformed');
});

test('state fetch-failed: HTTP error, timeout and a thrown fetch never throw and carry the cause', async () => {
  const headers = { getSetCookie: () => ['a=1; Path=/'] };
  const http403 = async (url) => (url.includes('/api/') ? { ok: false, status: 403, headers, text: async () => 'blocked' } : { ok: true, status: 200, headers, text: async () => '' });
  assert.deepEqual(await fetchNseHolidayMaster({ fetchImpl: http403 }), { ok: false, cause: 'NSE holiday-master answered HTTP 403' });

  const hang = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t = await fetchNseHolidayMaster({ fetchImpl: hang, timeoutMs: 20 });
  assert.equal(t.ok, false);
  assert.match(t.cause, /timed out after 20 ms/);

  const thrown = await fetchNseHolidayMaster({ fetchImpl: async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') }); } });
  assert.equal(thrown.ok, false);
  assert.match(thrown.cause, /ECONNRESET/);

  let sentCookie = null;
  const okFetch = async (url, init) => {
    if (url.includes('/api/')) {
      sentCookie = init.headers.Cookie;
      return { ok: true, status: 200, headers, text: async () => BODY };
    }
    return { ok: true, status: 200, headers, text: async () => '' };
  };
  const ok = await fetchNseHolidayMaster({ fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.equal(sentCookie, 'a=1');
});

test('plan retires a false row of EVERY exchange label and keeps one BOTH row per NSE date', () => {
  const holidays = [{ date: '2026-12-25', description: 'Christmas' }];
  const plan = planHolidayReconcile(
    [
      { id: 'b', date: '2026-07-07', description: 'Not a holiday', exchange: 'BOTH' },
      { id: 'n', date: '2026-07-08', description: 'Not a holiday', exchange: 'NSE' },
      { id: 's', date: '2026-07-09', description: 'Not a holiday', exchange: 'BSE' },
      { id: 'c1', date: '2026-12-25', description: 'Christmas', exchange: 'NSE' },
      { id: 'c2', date: '2026-12-25', description: 'Christmas', exchange: 'BOTH' },
    ],
    holidays
  );
  assert.deepEqual(plan.filter((a) => a.kind === 'retire').map((a) => a.id).sort(), ['b', 'c1', 'n', 's']);
  assert.equal(plan.filter((a) => a.kind === 'insert' || a.kind === 'update' || a.kind === 'move').length, 0);
});

test('plan moves a misdated holiday instead of retire + insert, and inserts a date nobody stored', () => {
  const plan = planHolidayReconcile(
    [{ id: 'g', date: '2026-11-25', description: 'Gurunanak Jayanti', exchange: 'BOTH' }],
    [
      { date: '2026-11-24', description: 'Prakash Gurpurb Sri Guru Nanak Dev' },
      { date: '2026-01-15', description: 'Municipal Corporation Election - Maharashtra' },
    ]
  );
  assert.deepEqual(
    plan.map((a) => `${a.kind}:${a.from ?? ''}>${a.date}`),
    ['insert:>2026-01-15', 'move:2026-11-25>2026-11-24']
  );
});

test('compareYearToNse names missing and extra dates', () => {
  const holidays = interpretNseHolidayAnswer(BODY, 2026).holidays;
  const stored = holidays.map((h) => h.date).filter((d) => d !== '2026-09-14').concat('2026-09-05');
  assert.deepEqual(compareYearToNse(stored, holidays), { missing: ['2026-09-14'], extra: ['2026-09-05'] });
  assert.deepEqual(compareYearToNse(holidays.map((h) => h.date), holidays), { missing: [], extra: [] });
});
