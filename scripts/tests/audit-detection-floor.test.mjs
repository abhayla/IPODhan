// Mutation-proof self-tests for scripts/lib/detection-floor-checks.mjs (T-335).
//
// Imports the ACTUAL predicates from the lib under test — not a
// re-implementation — so deleting/weakening a check turns its fixture RED.
// Each check has (1) a fixture matching the round-7 defect SHAPE that MUST
// fail, and (2) a clean fixture that MUST pass. Run: node --test scripts/tests/audit-detection-floor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNoUnresolvedConflictOnLiveIpo,
  checkIssueSizeSegmentFloor,
  checkIssueSizeSharesConsistency,
  checkLotBandSebiWindow,
  checkCorporateActionShape,
  classifyRouteResponse,
  classifyConflictNoiseRatio,
  checkFreshnessPerType,
  checkPm2EnvHasTz,
  checkPm2LogSize,
  findUnreferencedDefinitions,
  checkSectorPopulatedPct,
  checkCronScriptExecutable,
  checkDeadSourceHasRetireBy,
  checkSegmentPopulatedForIpo,
  findLiveCrossSourceDisagreements,
  valuesDisagree,
  normalizeCompanyKey,
  buildCheckDigest,
  buildUnverifiableDigest,
  buildRunPayloads,
  evaluateCronExecutable,
  computeExitCode,
  EXIT_OK,
  EXIT_FAIL,
  EXIT_UNVERIFIABLE,
  DIGEST_MAX_ROWS,
} from '../lib/detection-floor-checks.mjs';

// ---- (a)/(b) live IPO vs unresolved conflict --------------------------------

test('(a/b) FAILS on Lumino-shaped unresolved openDate conflict while OPEN', () => {
  const row = {
    status: 'OPEN', fieldName: 'openDate', hasUnresolvedConflict: true,
    source1: 'NSE', value1: '2026-08-26', source2: 'CHITTORGARH', value2: '2026-08-27',
  };
  assert.ok(checkNoUnresolvedConflictOnLiveIpo(row) !== null);
});

test('(a/b) PASSES when the same field has no unresolved conflict', () => {
  const row = { status: 'OPEN', fieldName: 'openDate', hasUnresolvedConflict: false };
  assert.equal(checkNoUnresolvedConflictOnLiveIpo(row), null);
});

test('(a/b) PASSES when the IPO is not live (LISTED) even with an unresolved conflict', () => {
  const row = { status: 'LISTED', fieldName: 'openDate', hasUnresolvedConflict: true };
  assert.equal(checkNoUnresolvedConflictOnLiveIpo(row), null);
});

// ---- (c) issue_size plausibility --------------------------------------------

test('(c) FAILS on Annu-Projects-shaped issue_size below MAINBOARD floor', () => {
  const row = { segment: 'MAINBOARD', issueSize: 17683000 }; // Rs1.77 Cr < Rs10 Cr floor
  assert.ok(checkIssueSizeSegmentFloor(row) !== null);
});

test('(c) PASSES a genuine MAINBOARD issue_size above the floor', () => {
  const row = { segment: 'MAINBOARD', issueSize: 175_00_00_000 }; // Rs175 Cr
  assert.equal(checkIssueSizeSegmentFloor(row), null);
});

test('(c) FAILS on Annu-shaped shares x price inconsistency (issue_size == sharesOffered)', () => {
  const row = { issueSize: 17683000, sharesOffered: 17683000, priceRangeMax: 99 };
  assert.ok(checkIssueSizeSharesConsistency(row) !== null);
});

test('(c) PASSES when issue_size agrees with sharesOffered x priceRangeMax within tolerance', () => {
  const row = { issueSize: 17683000 * 99, sharesOffered: 17683000, priceRangeMax: 99 };
  assert.equal(checkIssueSizeSharesConsistency(row), null);
});

// ---- (d) lot x band SEBI window + corporate-action shape -------------------

test('(d) FAILS on ICICI-Pru-AMC-shaped lot x band (Rs2,16,500 per lot)', () => {
  const row = { offeringType: 'IPO', segment: 'MAINBOARD', lotSize: 100, priceRangeMax: 2165 };
  assert.ok(checkLotBandSebiWindow(row) !== null);
});

test('(d) PASSES a genuine MAINBOARD lot value inside the SEBI window', () => {
  const row = { offeringType: 'IPO', segment: 'MAINBOARD', lotSize: 100, priceRangeMax: 120 }; // Rs12,000
  assert.equal(checkLotBandSebiWindow(row), null);
});

test('(d) FAILS on a KWALITY-WALLS-shaped corporate-action typed as IPO', () => {
  const row = { offeringType: 'IPO', priceRangeMin: 100, priceRangeMax: 100, lotSize: 100, windowDays: 12 };
  assert.ok(checkCorporateActionShape(row) !== null);
});

test('(d) PASSES a genuine fixed-price SME IPO outside the corporate-action window shape', () => {
  const row = { offeringType: 'IPO', priceRangeMin: 100, priceRangeMax: 100, lotSize: 1200, windowDays: 3 };
  assert.equal(checkCorporateActionShape(row), null);
});

// ---- (e) route sweep ---------------------------------------------------------

test('(e) FAILS on a 500 with a leaked SQL statement (score-route shape)', () => {
  const r = classifyRouteResponse('/api/ipos/x/score', 500, 'INSERT INTO ipo_scores (...) VALUES ($1, $2)');
  assert.equal(r.fail, true);
});

test('(e) FAILS on a 500 with an empty body (calendar/materialized shape)', () => {
  const r = classifyRouteResponse('/api/calendar/materialized/MAINBOARD', 500, '');
  assert.equal(r.fail, true);
});

test('(e) PASSES a clean 200 JSON body', () => {
  const r = classifyRouteResponse('/api/ipos/x/score', 200, '{"success":true,"data":{}}');
  assert.equal(r.fail, false);
});

// ---- (f) conflict noise ratio -------------------------------------------------

test('(f) FAILS on an 86%-noise ratio (round-7 shape)', () => {
  const r = classifyConflictNoiseRatio(2555, 2205 + 99);
  assert.equal(r.fail, true);
});

test('(f) PASSES a clean sub-5% noise ratio', () => {
  const r = classifyConflictNoiseRatio(1000, 20);
  assert.equal(r.fail, false);
});

// ---- (g) freshness per offering_type ------------------------------------------

test('(g) FAILS on an OFS-shaped 78-day-frozen calendar', () => {
  assert.ok(checkFreshnessPerType('OFS', 78) !== null);
});

test('(g) PASSES a fresh OFS row', () => {
  assert.equal(checkFreshnessPerType('OFS', 5), null);
});

// ---- (h) pm2 env TZ + log size -------------------------------------------------

test('(h) FAILS when pm2 env has no TZ (P1-1 enabling gap)', () => {
  assert.ok(checkPm2EnvHasTz('ipodhan-scraper', {}) !== null);
});

test('(h) PASSES when pm2 env carries TZ', () => {
  assert.equal(checkPm2EnvHasTz('ipodhan-scraper', { TZ: 'UTC' }), null);
});

test('(h) FAILS on a 240 MB pm2 log (round-7 shape)', () => {
  assert.ok(checkPm2LogSize('ipodhan-scraper', 'out.log', 240 * 1024 * 1024) !== null);
});

test('(h) PASSES a small rotated pm2 log', () => {
  assert.equal(checkPm2LogSize('ipodhan-scraper', 'out.log', 5 * 1024 * 1024), null);
});

// ---- (i) wire-or-retire --------------------------------------------------------

test('(i) FAILS naming the tiered scheduler (defined, never referenced — P2-8 shape)', () => {
  const defined = ['statusUpdater', 'marketHoursScheduler', 'afterHoursScheduler'];
  const referenced = ['statusUpdater'];
  const unref = findUnreferencedDefinitions(defined, referenced);
  assert.deepEqual(unref, ['marketHoursScheduler', 'afterHoursScheduler']);
});

test('(i) PASSES when every definition is referenced', () => {
  const defined = ['statusUpdater'];
  const referenced = ['statusUpdater'];
  assert.deepEqual(findUnreferencedDefinitions(defined, referenced), []);
});

// ---- (j) assorted P3 gates ------------------------------------------------------

test('(j) FAILS on 0% sector population (round-7 shape)', () => {
  assert.ok(checkSectorPopulatedPct(0, 251) !== null);
});

test('(j) PASSES healthy sector population', () => {
  assert.equal(checkSectorPopulatedPct(200, 251), null);
});

test('(j) FAILS on a non-executable cron script (mode 0644, P3-5 shape)', () => {
  assert.ok(checkCronScriptExecutable('scripts/vps-data-audit-cron.sh', 0o644) !== null);
});

test('(j) PASSES an executable cron script (mode 0755)', () => {
  assert.equal(checkCronScriptExecutable('scripts/vps-data-audit-cron.sh', 0o755), null);
});

test('(j) FAILS on a dead source with 7+ degraded cycles and no retire-by (API_FALLBACK shape)', () => {
  assert.ok(checkDeadSourceHasRetireBy('API_FALLBACK', 7, false) !== null);
});

test('(j) PASSES a dead source that has a documented retire-by decision', () => {
  assert.equal(checkDeadSourceHasRetireBy('API_FALLBACK', 7, true), null);
});

test('(j) FAILS on an IPO row with a NULL segment', () => {
  const row = { offeringType: 'IPO', segment: null, companyName: 'Test Co' };
  assert.ok(checkSegmentPopulatedForIpo(row) !== null);
});

test('(j) PASSES an IPO row with a populated segment', () => {
  const row = { offeringType: 'IPO', segment: 'MAINBOARD', companyName: 'Test Co' };
  assert.equal(checkSegmentPopulatedForIpo(row), null);
});

const NOW = new Date('2026-08-26T05:00:00Z');
const FRESH = '2026-08-26T04:59:00Z';

// The two live IPOs the checker observed publishing a wrong date while
// `data_conflicts` had momentarily zero unresolved rows. Values are the REAL
// ones measured on prod and on the live Chittorgarh report, 2026-08-26.
const LUMINO_ANNU_IPOS = [
  { id: 'ipo-lumino', companyName: 'Lumino Industries Limited', status: 'OPEN', values: { openDate: '2026-08-26', closeDate: '2026-08-30' } },
  { id: 'ipo-annu', companyName: 'Annu Projects Limited', status: 'OPEN', values: { openDate: '2026-08-24', closeDate: '2026-08-27' } },
];
// Note the oracle's own naming ("Ltd." plus a trailing status flag) — matching
// must survive it, or the independent check silently compares nothing.
const LUMINO_ANNU_ORACLE = [
  { companyName: 'Lumino Industries Ltd.', values: { openDate: '2026-08-27T00:00:00.000Z', closeDate: '2026-08-31T00:00:00.000Z' } },
  { companyName: 'Annu Projects Ltd. O', values: { openDate: '2026-08-25T00:00:00.000Z', closeDate: '2026-08-28T00:00:00.000Z' } },
];

// ---- blocker 2: a_b_live_conflict must be INDEPENDENT of data_conflicts ----

// MUTATION: revert the check to reading `data_conflicts` only -> this goes RED,
// because conflictRows is deliberately EMPTY here (the ~11-30s window the
// cross-source monitor leaves every cycle, and the permanent state if that
// monitor dies).
test('(a/b) FAILS naming BOTH Lumino and Annu with data_conflicts EMPTY', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: LUMINO_ANNU_IPOS,
    oracleRows: LUMINO_ANNU_ORACLE,
    conflictRows: [],
  });
  assert.equal(violations.length, 4, 'openDate + closeDate for both companies');
  const named = [...new Set(violations.map((v) => v.companyName))].sort();
  assert.deepEqual(named, ['Annu Projects Limited', 'Lumino Industries Limited']);
  assert.ok(violations.every((v) => v.signal === 'oracle'));
  assert.ok(violations.some((v) => /2026-08-26.*2026-08-27/.test(v.message)));
});

test('(a/b) matches across legal-suffix and status-flag naming differences', () => {
  assert.equal(normalizeCompanyKey('Lumino Industries Ltd.'), normalizeCompanyKey('Lumino Industries Limited'));
  assert.equal(normalizeCompanyKey('Annu Projects Ltd. O'), normalizeCompanyKey('Annu Projects Limited'));
  assert.notEqual(normalizeCompanyKey('Annu Projects Limited'), normalizeCompanyKey('Sumax Engineering Limited'));
});

test('(a/b) data_conflicts remains a SECONDARY signal and still contributes', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'ipo-x', companyName: 'X Ltd', status: 'OPEN', values: { closeDate: '2026-09-01' } }],
    oracleRows: [],
    conflictRows: [{ ipoId: 'ipo-x', fieldName: 'priceRangeMax', source1: 'NSE', value1: '100', source2: 'BSE', value2: '120' }],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].signal, 'data_conflicts');
});

test('(a/b) the same ipo+field is never double-counted across both signals', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [LUMINO_ANNU_IPOS[0]],
    oracleRows: [LUMINO_ANNU_ORACLE[0]],
    conflictRows: [{ ipoId: 'ipo-lumino', fieldName: 'openDate', source1: 'NSE', value1: '2026-08-26', source2: 'CHITTORGARH', value2: '2026-08-27' }],
  });
  assert.equal(violations.filter((v) => v.fieldName === 'openDate').length, 1);
  assert.equal(violations.find((v) => v.fieldName === 'openDate').signal, 'oracle');
});

test('(a/b) PASSES when the oracle agrees with the published dates', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Agreeable Limited', status: 'OPEN', values: { openDate: '2026-08-26', closeDate: '2026-08-30' } }],
    oracleRows: [{ companyName: 'Agreeable Ltd.', values: { openDate: '2026-08-26T00:00:00.000Z', closeDate: '2026-08-30T00:00:00.000Z' } }],
    conflictRows: [],
  });
  assert.equal(violations.length, 0);
});

test('(a/b) PASSES for a LISTED (not live) IPO even when the oracle disagrees', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Done Limited', status: 'LISTED', values: { openDate: '2026-08-26' } }],
    oracleRows: [{ companyName: 'Done Ltd.', values: { openDate: '2026-08-27' } }],
    conflictRows: [],
  });
  assert.equal(violations.length, 0);
});

test('(a/b) an IPO absent from the oracle contributes nothing (no false positive)', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Unlisted Elsewhere Limited', status: 'OPEN', values: { openDate: '2026-08-26' } }],
    oracleRows: LUMINO_ANNU_ORACLE,
    conflictRows: [],
  });
  assert.equal(violations.length, 0);
});

test('valuesDisagree compares dates by calendar day, not string form', () => {
  assert.equal(valuesDisagree('2026-08-26', '2026-08-26T00:00:00.000Z'), false);
  assert.equal(valuesDisagree('2026-08-26', '2026-08-27'), true);
  assert.equal(valuesDisagree('100', '100.0'), false);
  assert.equal(valuesDisagree('100', '101'), true);
  assert.equal(valuesDisagree(null, '101'), false);
  assert.equal(valuesDisagree('101', ''), false);
});

// ---- blocker 1: UNVERIFIABLE must page P2 and exit non-zero ---------------

// MUTATION: drop the UNVERIFIABLE branch from buildRunPayloads -> RED.
test('(blocker 1) a blackholed source yields an UNVERIFIABLE P2 page, not silence', () => {
  // Every source unreachable: data_conflicts gone, pm2 gone, the site down.
  const results = [
    { id: 'a_b_live_conflict', name: 'live IPO cross-source', status: 'UNVERIFIABLE', detail: 'field_sources table not present' },
    { id: 'e_route_sweep', name: 'public API route sweep', status: 'UNVERIFIABLE', detail: '40 unreachable (of 40)' },
    { id: 'h_pm2_env_tz', name: 'pm2 env TZ', status: 'UNVERIFIABLE', detail: 'pm2 not reachable on this host' },
  ];
  const payloads = buildRunPayloads({ results, findingsByCheck: new Map(), previousState: {}, date: '2026-08-26', reportPath: '/root/data-audit-ipodhan/state/run-2026-08-26.log' });

  assert.equal(payloads.length, 3, 'every UNVERIFIABLE check must page');
  for (const pl of payloads) {
    assert.equal(pl.project, 'ipodhan');
    assert.equal(pl.severity, 'P2');
    assert.equal(pl.type, 'detection-floor');
    assert.match(pl.dedupeKey, /^detection-floor-unverifiable-.+-2026-08-26$/);
    assert.match(pl.title, /UNVERIFIABLE/);
    assert.match(pl.body, /NOT a pass/);
  }
  assert.ok(payloads.some((p) => p.body.includes('40 unreachable')), 'the reason must reach the owner');
});

// MUTATION: `return failCount > 0 ? 1 : 0` (the first cut) -> RED.
test('(blocker 1) an all-UNVERIFIABLE night exits 3, never 0', () => {
  assert.equal(computeExitCode({ failCount: 0, unverifiableCount: 7 }), EXIT_UNVERIFIABLE);
  assert.equal(computeExitCode({ failCount: 0, unverifiableCount: 7 }), 3);
});

test('(blocker 1) exit-code contract: 0 clean, 1 on FAIL, FAIL dominates UNVERIFIABLE', () => {
  assert.equal(computeExitCode({ failCount: 0, unverifiableCount: 0 }), EXIT_OK);
  assert.equal(computeExitCode({ failCount: 2, unverifiableCount: 0 }), EXIT_FAIL);
  assert.equal(computeExitCode({ failCount: 2, unverifiableCount: 5 }), EXIT_FAIL);
});

test('(blocker 1) the UNVERIFIABLE dedupeKey is per check per night', () => {
  const a = buildUnverifiableDigest({ checkId: 'e_route_sweep', checkTitle: 't', detail: 'd', date: '2026-08-26' });
  const b = buildUnverifiableDigest({ checkId: 'h_pm2_env_tz', checkTitle: 't', detail: 'd', date: '2026-08-26' });
  const c = buildUnverifiableDigest({ checkId: 'e_route_sweep', checkTitle: 't', detail: 'd', date: '2026-08-27' });
  assert.notEqual(a.dedupeKey, b.dedupeKey);
  assert.notEqual(a.dedupeKey, c.dedupeKey);
});

// ---- blocker 3: git-absent is UNVERIFIABLE, not a RangeError crash --------

// MUTATION: restore `execOffenders.length = -1` -> RED (throws).
test('(blocker 3) git unavailable yields UNVERIFIABLE without throwing', () => {
  const gitMissing = () => { throw new Error('spawnSync git ENOENT'); };
  let out;
  assert.doesNotThrow(() => { out = evaluateCronExecutable(['scripts/vps-data-audit-cron.sh'], gitMissing); });
  assert.equal(out.status, 'UNVERIFIABLE');
  assert.deepEqual(out.offenders, []);
  assert.match(out.detail, /git ls-files failed/);
});

test('(blocker 3) a mode-0644 cron script still FAILs when git IS available', () => {
  const gitOk = () => '100644 abc123 0\tscripts/vps-data-audit-cron.sh';
  const out = evaluateCronExecutable(['scripts/vps-data-audit-cron.sh'], gitOk);
  assert.equal(out.status, 'FAIL');
  assert.equal(out.offenders.length, 1);
});

test('(blocker 3) a mode-0755 cron script PASSes', () => {
  const gitOk = () => '100755 abc123 0\tscripts/vps-data-audit-cron.sh';
  assert.equal(evaluateCronExecutable(['scripts/vps-data-audit-cron.sh'], gitOk).status, 'PASS');
});

// ---- blocker 4: one digest per check per night, P1 only on NEW rows -------

const rows = (n) => Array.from({ length: n }, (_, i) => ({ rowKey: `row-${i}`, title: `t${i}`, body: `body ${i}` }));

// MUTATION: revert to one page per row -> RED (payloads.length would be 25).
test('(blocker 4) 25 failing rows across 2 checks produce 2 pages, not 25', () => {
  const findings = new Map([['c_issue_size_floor', rows(20)], ['d_lot_band_window', rows(5)]]);
  const results = [
    { id: 'c_issue_size_floor', name: 'issue_size floor', status: 'FAIL', detail: '' },
    { id: 'd_lot_band_window', name: 'lot x band window', status: 'FAIL', detail: '' },
  ];
  const payloads = buildRunPayloads({ results, findingsByCheck: findings, previousState: {}, date: '2026-08-26' });
  assert.equal(payloads.length, 2);
});

test('(blocker 4) the digest shows the count and only the first 10 rows', () => {
  const d = buildCheckDigest({ checkId: 'c', checkTitle: 'issue_size floor', rows: rows(20), previousRowKeys: [], date: '2026-08-26', reportPath: '/root/x/run.log' });
  assert.match(d.title, /20 failing/);
  assert.equal(d.body.split('\n').filter((l) => l.startsWith('- ') && !l.includes('and 10 more')).length, DIGEST_MAX_ROWS);
  assert.match(d.body, /and 10 more/);
  assert.match(d.body, /Full report: \/root\/x\/run\.log/);
});

// MUTATION: always P1 -> RED. MUTATION: always P2 -> RED (next test).
test('(blocker 4) an unchanged backlog pages P2, not P1', () => {
  const r = rows(3);
  const d = buildCheckDigest({ checkId: 'c', checkTitle: 't', rows: r, previousRowKeys: r.map((x) => x.rowKey), date: '2026-08-26' });
  assert.equal(d.severity, 'P2');
  assert.equal(d.newCount, 0);
});

test('(blocker 4) a NEW row versus last night escalates the digest to P1', () => {
  const r = rows(3);
  const d = buildCheckDigest({ checkId: 'c', checkTitle: 't', rows: r, previousRowKeys: ['row-0', 'row-1'], date: '2026-08-26' });
  assert.equal(d.severity, 'P1');
  assert.equal(d.newCount, 1);
  assert.match(d.title, /\(1 new\)/);
});

// MUTATION: drop the date from the dedupeKey -> RED. A date-less key is what
// lets the Notifier's 30-minute cooldown swallow the nightly digest.
test('(blocker 4) the digest dedupeKey is check+date so the 30-min cooldown cannot swallow it', () => {
  const r = rows(1);
  const d1 = buildCheckDigest({ checkId: 'c', checkTitle: 't', rows: r, previousRowKeys: [], date: '2026-08-26' });
  const d2 = buildCheckDigest({ checkId: 'c', checkTitle: 't', rows: r, previousRowKeys: [], date: '2026-08-27' });
  assert.equal(d1.dedupeKey, 'detection-floor-c-2026-08-26');
  assert.notEqual(d1.dedupeKey, d2.dedupeKey);
});

test('(blocker 4) a check with zero failing rows produces no page at all', () => {
  assert.equal(buildCheckDigest({ checkId: 'c', checkTitle: 't', rows: [], previousRowKeys: [], date: '2026-08-26' }), null);
});

test('(blocker 4) FAIL digests and UNVERIFIABLE pages coexist in one run', () => {
  const results = [
    { id: 'c_issue_size_floor', name: 'issue_size floor', status: 'FAIL', detail: '' },
    { id: 'h_pm2_env_tz', name: 'pm2 env TZ', status: 'UNVERIFIABLE', detail: 'pm2 not reachable' },
  ];
  const payloads = buildRunPayloads({
    results, findingsByCheck: new Map([['c_issue_size_floor', rows(2)]]), previousState: {}, date: '2026-08-26',
  });
  assert.equal(payloads.length, 2);
  assert.ok(payloads.some((p) => p.dedupeKey.startsWith('detection-floor-unverifiable-')));
  assert.ok(payloads.some((p) => p.dedupeKey === 'detection-floor-c_issue_size_floor-2026-08-26'));
});

// ---- checker non-blocking finding: empty-string segment ------------------

test('(j) FAILS on an empty-string segment (round-7 P3-7 shape), not just NULL', () => {
  assert.ok(checkSegmentPopulatedForIpo({ offeringType: 'IPO', segment: '', companyName: 'Blank Co' }) !== null);
  assert.ok(checkSegmentPopulatedForIpo({ offeringType: 'IPO', segment: '   ', companyName: 'Blank Co' }) !== null);
});
