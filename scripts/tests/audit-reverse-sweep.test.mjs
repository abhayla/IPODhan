// #187 (T-461): self-test for the reverse sweep — external calendar -> our
// site row -> offeringType -> rendered page, three assertions per external
// IPO. Failing-test-first fixture per the plan (docs/reviews/../plans/187):
// 3 external IPOs — one matched+IPO+200, one matched+FPO-mistyped, one
// absent — asserting the script fails naming exactly the mistyped and
// absent ones. No network, no DB: fake fetch only, so this is deterministic
// in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseChittorgarhDashboard, fetchOracleCalendar } from '../lib/chittorgarh-oracle-parser.mjs';
import { runReverseSweep } from '../audit-reverse-sweep.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HTML = readFileSync(join(__dirname, 'fixtures', 'chittorgarh-dashboard-fixture.html'), 'utf8');

test('parseChittorgarhDashboard extracts name/slug/segment from the captured fixture', () => {
  const rows = parseChittorgarhDashboard(FIXTURE_HTML, 'MAINBOARD');
  assert.equal(rows.length, 3);
  const karamtara = rows.find((r) => r.name === 'Karamtara Engineering');
  assert.ok(karamtara);
  assert.equal(karamtara.slug, 'karamtara-engineering');
  assert.equal(karamtara.segment, 'MAINBOARD');
  assert.equal(karamtara.sourceUrl, 'https://www.chittorgarh.com/ipo/karamtara-engineering-ipo/2020/');
});

test('parseChittorgarhDashboard returns [] on empty/garbage input, never throws', () => {
  assert.deepEqual(parseChittorgarhDashboard('', 'MAINBOARD'), []);
  assert.deepEqual(parseChittorgarhDashboard('<html><body>no rows here</body></html>', 'SME'), []);
});

// -- fetchOracleCalendar: fake fetch, both segments -------------------------

function fakeCalendarFetch({ mainboardHtml = FIXTURE_HTML, smeOk = true } = {}) {
  return async (url) => {
    if (url.includes('a=sme')) {
      if (!smeOk) throw new Error('simulated SME fetch failure');
      return { ok: true, status: 200, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => mainboardHtml };
  };
}

test('fetchOracleCalendar merges mainboard+SME and reports ok=true when both succeed', async () => {
  const cal = await fetchOracleCalendar({ fetchImpl: fakeCalendarFetch() });
  assert.equal(cal.ok, true);
  assert.equal(cal.entries.length, 3);
  assert.equal(cal.closedWindowCoverage, 'none');
});

test('fetchOracleCalendar reports ok=false (never a silent empty pass) when a segment fetch throws', async () => {
  const cal = await fetchOracleCalendar({ fetchImpl: fakeCalendarFetch({ smeOk: false }) });
  assert.equal(cal.ok, false);
  assert.ok(cal.errors.some((e) => e.includes('SME')));
  // mainboard rows still returned — a partial fetch is not the same as none
  assert.equal(cal.entries.length, 3);
});

// -- runReverseSweep: the three assertions against a fake target site -------

// The 3-IPO fixture: Karamtara (matched, offeringType=IPO, page 200 with name)
// = PASS; Mopshop (matched, but offeringType=FPO) = FAIL "mistyped"; Ghost
// Vanish Traders (no row anywhere on the target) = FAIL "missing".
function fakeTargetFetch() {
  return async (url) => {
    if (url.includes('/api/ipos/karamtara-engineering')) {
      return { status: 200, json: async () => ({ ipo: { companyName: 'Karamtara Engineering', slug: 'karamtara-engineering', offeringType: 'IPO' } }) };
    }
    if (url.includes('/api/ipos/mopshop-distribution')) {
      return { status: 200, json: async () => ({ ipo: { companyName: 'Mopshop Distribution', slug: 'mopshop-distribution', offeringType: 'FPO' } }) };
    }
    if (url.includes('/api/ipos/ghost-vanish-traders')) {
      // T-461 note: simulates the e_unknown_slug_404 class (#350) — an
      // unknown slug resolves to an UNRELATED real row instead of 404ing.
      // The check must not accept this as a match (normalized-name guard).
      return { status: 200, json: async () => ({ ipo: { companyName: 'Some Other Company Ltd', slug: 'some-other-company-ltd', offeringType: 'IPO' } }) };
    }
    if (url.includes('/api/ipos?search=')) {
      // search fallback: nothing else on the target matches Ghost Vanish Traders
      return { status: 200, json: async () => ({ data: [] }) };
    }
    if (url.includes('/ipos/karamtara-engineering')) {
      return { status: 200, text: async () => '<html>Karamtara Engineering Ltd IPO details...</html>' };
    }
    if (url.includes('/ipos/mopshop-distribution')) {
      return { status: 200, text: async () => '<html>Mopshop Distribution details...</html>' };
    }
    throw new Error(`fakeTargetFetch: unexpected URL ${url}`);
  };
}

test('runReverseSweep FAILs naming exactly the mistyped and the absent external IPO', async () => {
  const cal = await fetchOracleCalendar({ fetchImpl: fakeCalendarFetch() });
  const summary = await runReverseSweep({ fetchImpl: fakeTargetFetch(), baseUrl: 'https://ipodhan.com', calendar: cal });

  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.results.length, 3);

  const karamtara = summary.results.find((r) => r.external.name === 'Karamtara Engineering');
  assert.equal(karamtara.matched, true);
  assert.equal(karamtara.reason, 'ok');

  const mopshop = summary.results.find((r) => r.external.name === 'Mopshop Distribution');
  assert.equal(mopshop.matched, true);
  assert.equal(mopshop.reason, 'mistyped');
  assert.match(mopshop.detail, /offeringType='FPO'/);

  const ghost = summary.results.find((r) => r.external.name === 'Ghost Vanish Traders');
  assert.equal(ghost.matched, false);
  assert.equal(ghost.reason, 'missing');

  const failingNames = summary.failing.map((r) => r.external.name).sort();
  assert.deepEqual(failingNames, ['Ghost Vanish Traders', 'Mopshop Distribution']);
});

test('runReverseSweep is UNVERIFIABLE (never a silent PASS) when the calendar cannot be fetched at all', async () => {
  const summary = await runReverseSweep({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    baseUrl: 'https://ipodhan.com',
  });
  assert.equal(summary.status, 'UNVERIFIABLE');
  assert.equal(summary.results.length, 0);
});

test('runReverseSweep PASSes when every external IPO matches all three assertions', async () => {
  // single-entry calendar: only Karamtara, which fakeTargetFetch resolves cleanly
  const cal = { entries: [{ name: 'Karamtara Engineering', slug: 'karamtara-engineering', sourceUrl: 'https://www.chittorgarh.com/ipo/karamtara-engineering-ipo/2020/', segment: 'MAINBOARD' }], ok: true, errors: [], closedWindowCoverage: 'none' };
  const summary = await runReverseSweep({ fetchImpl: fakeTargetFetch(), baseUrl: 'https://ipodhan.com', calendar: cal });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.failing.length, 0);
});
