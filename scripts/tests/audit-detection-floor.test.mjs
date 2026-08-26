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
