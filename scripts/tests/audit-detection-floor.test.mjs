// Mutation-proof self-tests for scripts/lib/detection-floor-checks.mjs (T-335).
//
// Imports the ACTUAL predicates from the lib under test — not a
// re-implementation — so deleting/weakening a check turns its fixture RED.
// Each check has (1) a fixture matching the round-7 defect SHAPE that MUST
// fail, and (2) a clean fixture that MUST pass. Run: node --test scripts/tests/audit-detection-floor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseIpowatchDetail, parseIpowatchDate, parsePriceBand, parseRupeeAmount, computeOracleCoverageWarning } from '../lib/ipowatch-oracle-parser.mjs';
import { parseChittorgarhIssueSizeDetail, evaluateUpcomingSourceDrift, ROUNDING_TOLERANCE_RUPEES } from '../lib/upcoming-source-drift-checks.mjs';
import {
  checkNoUnresolvedConflictOnLiveIpo,
  checkIssueSizeSegmentFloor,
  checkIssueSizeSharesConsistency,
  checkIssueSizeSourceCapability,
  manifestCodeForWriterSource,
  checkLotBandSebiWindow,
  checkCorporateActionShape,
  checkSegmentHasProvenance,
  checkPublishedWithoutProvenance,
  classifyRowKeyProbeError,
  classifyRouteResponse,
  classifyVerdictLeak,
  classifyConflictNoiseRatio,
  checkFreshnessPerType,
  checkPm2EnvHasTz,
  checkPm2LogSize,
  findUnreferencedDefinitions,
  checkSectorPopulatedPct,
  checkCronScriptExecutable,
  checkDeadSourceHasRetireBy,
  checkSegmentPopulatedForIpo,
  normalizeIdentityCompanyName,
  stripIdentitySlugSuffix,
  findSameIpoTwoRows,
  checkIpoTitleInName,
  findCompanyTwoLiveRows,
  findNameBoundLiveRows,
  findClosedIpoDoneWithoutWalk,
  findUndecidedIdentityHolds,
  findLiveCrossSourceDisagreements,
  valuesDisagree,
  fieldValuesDisagree,
  ORACLE_COMPARABLE_FIELDS,
  normalizeCompanyKey,
  findLotDisagreements,
  findMinApplicationDisagreements,
  minApplicationLots,
  buildCheckDigest,
  buildUnverifiableDigest,
  buildRunPayloads,
  evaluateCronExecutable,
  computeExitCode,
  EXIT_OK,
  EXIT_FAIL,
  EXIT_UNVERIFIABLE,
  DIGEST_MAX_ROWS,
  computeSummaryCounts,
  evaluateSourceKeyConflicts,
} from '../lib/detection-floor-checks.mjs';
import { resolveColumn, isBlankCurrentValue, hadPreviousValue, isSafeTableName, toSnake, evaluatePullNoblank } from '../lib/pull-noblank-checks.mjs';

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

// T-slice-3c: `segment` is increasingly NULL now that write paths are honest
// about what a source actually stated (slice 3a). A NULL segment must be
// EXCLUDED from the segment-floor comparison — it must not be silently
// judged by the MAINBOARD floor (design doc line 812) — while still being
// visible via the separate j_segment_not_null finding (checked below).
test('(c) T-slice-3c PASSES (excluded, not judged) a NULL-segment row even far below the MAINBOARD floor', () => {
  const row = { segment: null, issueSize: 17683000 }; // Rs1.77 Cr — below MAINBOARD floor, but segment unknown
  assert.equal(checkIssueSizeSegmentFloor(row), null);
});

test('(c) T-slice-3c FAILS (no regression) on an SME issue_size below the SME floor', () => {
  const row = { segment: 'SME', issueSize: 50_00_000 }; // Rs50 lakh < Rs1 Cr SME floor
  assert.ok(checkIssueSizeSegmentFloor(row) !== null);
});

test('(c) T-slice-3c PASSES a genuine SME issue_size above the SME floor', () => {
  const row = { segment: 'SME', issueSize: 3_00_00_000 }; // Rs3 Cr > Rs1 Cr SME floor
  assert.equal(checkIssueSizeSegmentFloor(row), null);
});

test('(c) FAILS on Annu-shaped shares x price inconsistency (issue_size == sharesOffered)', () => {
  const row = { issueSize: 17683000, sharesOffered: 17683000, priceRangeMax: 99 };
  assert.ok(checkIssueSizeSharesConsistency(row) !== null);
});

// ---- (c, source capability) issueSize provenance vs manifest capability ----

const ISSUE_SIZE_CAPABILITY = {
  DOC: { capable: true },
  CHITTORGARH: { capable: true },
  BSE: { capable: false, reason: 'measured 41-76% below the printed total offer on 6/6 live mainboard IPOs' },
  NSE: { capable: false },
  MONEYCONTROL: { capable: false },
};

test('(c, capability) manifestCodeForWriterSource collapses DRHP to DOC and is identity otherwise', () => {
  assert.equal(manifestCodeForWriterSource('DRHP'), 'DOC');
  assert.equal(manifestCodeForWriterSource('BSE'), 'BSE');
  assert.equal(manifestCodeForWriterSource('CHITTORGARH'), 'CHITTORGARH');
});

test('(c, capability) FAILS (#728 class) when current issueSize provenance is BSE, non-capable', () => {
  const row = { source: 'BSE', companyName: 'Banganga Paper Industries Ltd', issueSize: 14797000 };
  assert.ok(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY) !== null);
});

test('(c, capability) FAILS on a NULL-segment CLOSED row sourced from BSE (segment/status must not exempt it)', () => {
  const row = { source: 'BSE', segment: null, status: 'CLOSED', companyName: 'Induss Food Products and Equipments Ltd', issueSize: 7007320 };
  assert.ok(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY) !== null);
});

test('(c, capability) PASSES when current issueSize provenance is CHITTORGARH, capable', () => {
  const row = { source: 'CHITTORGARH', issueSize: 1500000000 };
  assert.equal(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY), null);
});

test('(c, capability) PASSES when current issueSize provenance is DRHP (manifest DOC), capable', () => {
  const row = { source: 'DRHP', issueSize: 1500000000 };
  assert.equal(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY), null);
});

test('(c, capability) PASSES ADMIN manual override regardless of manifest capability', () => {
  const row = { source: 'ADMIN', issueSize: 123 };
  assert.equal(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY), null);
});

test('(c, capability) PASSES (no provenance row is a different check\'s job) when source is absent', () => {
  const row = { source: null, issueSize: null };
  assert.equal(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY), null);
});

test('(c, capability) FAILS on a source with no capability entry at all (e.g. INVESTORGAIN_GMP never intended for this field)', () => {
  const row = { source: 'INVESTORGAIN_GMP', issueSize: 100 };
  assert.ok(checkIssueSizeSourceCapability(row, ISSUE_SIZE_CAPABILITY) !== null);
});

test('(c) PASSES when issue_size agrees with sharesOffered x priceRangeMax within tolerance', () => {
  const row = { issueSize: 17683000 * 99, sharesOffered: 17683000, priceRangeMax: 99 };
  assert.equal(checkIssueSizeSharesConsistency(row), null);
});

// T-452: real staging rows the SYMMETRIC +/-25% band false-positived because
// ipos.issue_size is the TOTAL incl. OFS while shares_offered is the NET
// public offer — the one-sided 0.75x-3.0x band must PASS all three.
test('(c) T-452 PASSES the real meesho-ltd row (total incl. OFS runs 1.76x the net-offer estimate)', () => {
  const row = { issueSize: 54_210_000_000, sharesOffered: 277_938_446, priceRangeMax: 111 };
  assert.equal(checkIssueSizeSharesConsistency(row), null);
});

test('(c) T-452 PASSES the real wakefit row (1.82x)', () => {
  const row = { issueSize: 12_890_000_000, sharesOffered: 36_353_276, priceRangeMax: 195 };
  assert.equal(checkIssueSizeSharesConsistency(row), null);
});

test('(c) T-452 PASSES the real aequs row (1.77x)', () => {
  const row = { issueSize: 9_220_000_000, sharesOffered: 42_026_913, priceRangeMax: 124 };
  assert.equal(checkIssueSizeSharesConsistency(row), null);
});

test('(c) T-452 still FAILS a share-count-as-rupees row (issue_size == sharesOffered, ratio far below 0.75x)', () => {
  const row = { issueSize: 17_683_000, sharesOffered: 17_683_000, priceRangeMax: 100 };
  const violation = checkIssueSizeSharesConsistency(row);
  assert.ok(violation !== null);
  assert.match(violation, /far BELOW/);
});

test('(c) T-452 FAILS a wrong-unit-up row (ratio far above 3.0x)', () => {
  const row = { issueSize: 100_000_000_000, sharesOffered: 1_000_000, priceRangeMax: 100 }; // ratio = 1000x
  const violation = checkIssueSizeSharesConsistency(row);
  assert.ok(violation !== null);
  assert.match(violation, /far ABOVE/);
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

// ---- (d) segment provenance (lane C item 2 slice 3b) ------------------------

test('(d) FAILS on a non-NULL segment with no field_sources row for it (the write-bug shape)', () => {
  const row = { companyName: 'Example Co', offeringType: 'MAINBOARD', segment: 'MAINBOARD', hasSegmentProvenance: false };
  assert.ok(checkSegmentHasProvenance(row) !== null);
});

test('(d) PASSES a non-NULL segment that carries a field_sources row', () => {
  const row = { companyName: 'Example Co', offeringType: 'IPO', segment: 'MAINBOARD', hasSegmentProvenance: true };
  assert.equal(checkSegmentHasProvenance(row), null);
});

test('(d) PASSES a NULL segment regardless of provenance (nothing to source)', () => {
  const row = { companyName: 'Example Co', offeringType: 'RIGHTS', segment: null, hasSegmentProvenance: false };
  assert.equal(checkSegmentHasProvenance(row), null);
});

// ---- (r) published value with no field_sources row at all (#454) ------------

test('(r) FAILS naming "company" (slug).field for a published value with no provenance row', () => {
  const row = { companyName: 'Manika Plastech Ltd', slug: 'manika-plastech-ltd', fieldName: 'issueSize', hasProvenance: false };
  const v = checkPublishedWithoutProvenance(row);
  assert.ok(v !== null);
  assert.equal(v, '"Manika Plastech Ltd" (manika-plastech-ltd).issueSize');
});

test('(r) PASSES when the value carries a field_sources row', () => {
  const row = { companyName: 'Manika Plastech Ltd', slug: 'manika-plastech-ltd', fieldName: 'issueSize', hasProvenance: true };
  assert.equal(checkPublishedWithoutProvenance(row), null);
});

test('(r) mutation guard: an inverted hasProvenance check would make the red case pass — confirms the test can fail', () => {
  const invertedCheck = (row) => (!row.hasProvenance ? null : `"${row.companyName}" (${row.slug}).${row.fieldName}`);
  const failingRow = { companyName: 'Manika Plastech Ltd', slug: 'manika-plastech-ltd', fieldName: 'issueSize', hasProvenance: false };
  // The REAL predicate flags this row (FAIL); the inverted mutant does not.
  assert.ok(checkPublishedWithoutProvenance(failingRow) !== null);
  assert.equal(invertedCheck(failingRow), null);
});

test('(r) probe: a live migration-lag error (row_key column missing, migration NOT applied) is PASS/not-applicable, never a false FAIL', () => {
  const err = { code: '42703', message: 'column fs.row_key does not exist' };
  const outcome = classifyRowKeyProbeError(err, false);
  assert.equal(outcome.status, 'PASS');
  assert.equal(outcome.reason, 'migration-not-applied');
});

test('(r) probe: the same missing-column error with the migration APPLIED is UNVERIFIABLE, never a silent PASS', () => {
  const err = { code: '42703', message: 'column fs.row_key does not exist' };
  const outcome = classifyRowKeyProbeError(err, true);
  assert.equal(outcome.status, 'UNVERIFIABLE');
  assert.match(outcome.reason, /migration applied=true/);
});

test('(r) probe: an unrelated read failure (not a missing-column error) is UNVERIFIABLE, never treated as migration lag', () => {
  const err = { code: '08006', message: 'connection terminated' };
  const outcome = classifyRowKeyProbeError(err, null);
  assert.equal(outcome.status, 'UNVERIFIABLE');
  assert.match(outcome.reason, /ipos\/field_sources not readable/);
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

// ---- (e, OD-61 / S7) verdict-leak sweep ---------------------------------------
// S7 half 2 (docs/design/s7-consensus-check-plan.md): a public payload must never carry a
// "verdict" or "witnesses" key -- the owner's rule that disagreement stays admin-only.

test('(OD-61) FAILS when a public route payload leaks a "verdict" key', () => {
  const r = classifyVerdictLeak('/api/ipos/example-co', '{"success":true,"data":{"issueSize":1250000000,"verdict":"CONFIRMED"}}');
  assert.equal(r.fail, true);
});

test('(OD-61) FAILS when a public route payload leaks a "witnesses" key', () => {
  const r = classifyVerdictLeak('/api/ipos/example-co', '{"success":true,"data":{"witnesses":[{"source":"NSE","value":1000}]}}');
  assert.equal(r.fail, true);
});

// Supervisor review, 2026-09-19: `classifyVerdictLeak`'s own comment promised a leak was caught
// "even if the key sits inside a stringified/escaped nested payload", and it was NOT — the regex
// required a BARE quote before the key, while a stringified payload delivers `\"verdict\":`. The
// three cases above all use the bare form, so none of them could have noticed.
//
// The fixture is built with JSON.stringify rather than a hand-typed escaped string ON PURPOSE:
// hand-escaping this through a shell, a heredoc and a template literal is what made the defect
// hard to see in the first place (every layer ate a backslash). Let the runtime produce the shape
// the route would actually return.
test('(OD-61) FAILS when a verdict is nested inside a STRINGIFIED payload (escaped-quote form)', () => {
  const body = JSON.stringify({ success: true, data: { raw: JSON.stringify({ verdict: 'DISPUTED' }) } });
  assert.ok(body.includes('\\"verdict\\"'), 'fixture must contain the ESCAPED key form, or it tests nothing');
  const r = classifyVerdictLeak('/api/ipos/example-co', body);
  assert.equal(r.fail, true);
});

test('(OD-61) still matches when there is whitespace before the colon', () => {
  const r = classifyVerdictLeak('/api/ipos/example-co', '{"data":{"verdict" : "CONFIRMED"}}');
  assert.equal(r.fail, true);
});

test('(OD-61) PASSES a clean public payload with neither key (measured baseline, 2026-09-19)', () => {
  const r = classifyVerdictLeak('/api/ipos/example-co', '{"success":true,"data":{"issueSize":1250000000,"companyName":"Example Co"}}');
  assert.equal(r.fail, false);
});

test('(OD-61) does not false-positive on an unrelated field whose name merely contains "verdict"-like text', () => {
  const r = classifyVerdictLeak('/api/ipos/example-co', '{"success":true,"data":{"verdictSummaryUrl":"https://example.com/verdict"}}');
  assert.equal(r.fail, false, 'the JSON-key regex requires a quoted key immediately followed by a colon, not a substring anywhere in the body');
});

// #897: e_verdict_leak_sweep was red 4 nights on prod on the SAME offender, /api/performance/
// mainboard, because ipoScore.verdict is the public IPO RATING (rendered by IPOCard.tsx's
// VerdictBadge) -- a different concept from OD-61's consensus verdict that happens to share a key
// name. Failing test first, on the REAL classifyVerdictLeak: the actual production response shape
// must PASS.
test('(#897) PASSES the real /api/performance/mainboard shape -- ipoScore.verdict is the public IPO rating, not an OD-61 consensus verdict', () => {
  const body = JSON.stringify({
    success: true,
    data: [
      {
        id: 1,
        companyName: 'Example Co',
        ipoScore: { verdict: 'SKIP', confidence: 'HIGH', reasoning: 'Poor (Avoid)', totalScore: 32 },
      },
      { id: 2, companyName: 'Second Co', ipoScore: null },
    ],
  });
  const r = classifyVerdictLeak('/api/performance/mainboard', body);
  assert.equal(r.fail, false, 'ipoScore.verdict is allow-listed BY PATH -- it is the public rating, not an OD-61 leak');
});

test('(#897) still FAILS an OD-61 consensus verdict sitting BESIDE an unrelated, innocent ipoScore object in the same payload', () => {
  const body = JSON.stringify({
    success: true,
    data: [
      { id: 1, companyName: 'Example Co', ipoScore: { verdict: 'SKIP', confidence: 'HIGH' } },
    ],
    consensus: { verdict: 'DISPUTED', witnesses: [{ source: 'NSE', value: 1000 }, { source: 'BSE', value: 900 }] },
  });
  const r = classifyVerdictLeak('/api/performance/mainboard', body);
  assert.equal(r.fail, true, 'the ipoScore allow-list must not swallow a REAL OD-61 leak living elsewhere in the same body — mutation guard');
});

test('(#897) mutation guard: a "witnesses" key planted directly on ipoScore itself still FAILS (the allow-list is path-scoped, not key-scoped)', () => {
  const body = JSON.stringify({
    success: true,
    data: [{ id: 1, ipoScore: { verdict: 'SKIP', confidence: 'HIGH' } }],
    witnesses: [{ source: 'NSE', value: 1000 }],
  });
  const r = classifyVerdictLeak('/api/performance/mainboard', body);
  assert.equal(r.fail, true);
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

// #240: API_FALLBACK is retired (RCA: not a spec source, 0 hits for
// API_FALLBACK/ipoalerts in docs/design/data-sourcing-pull-model.md; dead for
// 7+ scraper_logs cycles with no retire-by decision, per the nightly
// j_dead_source_retire_by check). This asserts the real retirement record
// audit-detection-floor.mjs reads at runtime (docs/reviews/dead-source-retirement.json)
// actually satisfies the check — not a re-implementation of the file's shape.
test('(j) the real dead-source-retirement.json documents API_FALLBACK, so j_dead_source_retire_by PASSES for it', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const retirementPath = join(__dirname, '..', '..', 'docs', 'reviews', 'dead-source-retirement.json');
  const retirementDoc = JSON.parse(readFileSync(retirementPath, 'utf8'));
  assert.ok(retirementDoc.API_FALLBACK, 'docs/reviews/dead-source-retirement.json must document API_FALLBACK (#240)');
  assert.equal(
    checkDeadSourceHasRetireBy('API_FALLBACK', 7, !!retirementDoc.API_FALLBACK),
    null,
    'the recorded retirement must satisfy j_dead_source_retire_by even after 7+ degraded cycles'
  );
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

// ---- T-506 (#415): lotSize vs min-application ------------------------------
// Qualiance International (SME, OPEN, band 120-127): ipos.lot_size = 1000
// (the exchange lot) while ipowatch's "minimum bid is 2000 Shares" line is
// the SME retail MINIMUM APPLICATION (2 lots, SEBI rule since 2025), not the
// exchange lot. ORACLE_COMPARABLE_FIELDS no longer includes 'lotSize', so the
// generic findLiveCrossSourceDisagreements() must report nothing for it; the
// lot pair is checked (divided by the multiplier) via findLotDisagreements(),
// and the min-application pair via findMinApplicationDisagreements().
const QUALIANCE_IPO = [{
  id: 'qualiance-1', companyName: 'Qualiance International Limited', status: 'OPEN', segment: 'SME',
  values: { priceRangeMin: 120, priceRangeMax: 127, lotSize: 1000 },
}];
const QUALIANCE_ORACLE = [{ companyName: 'Qualiance International Ltd.', values: { lotSize: 2000 } }];

test('(T-506) minApplicationLots is 2 for SME, 1 for MAINBOARD/unknown', () => {
  assert.equal(minApplicationLots('SME'), 2);
  assert.equal(minApplicationLots('MAINBOARD'), 1);
  assert.equal(minApplicationLots(undefined), 1);
});

test('(T-506) the generic oracle field loop no longer flags lotSize at all', () => {
  assert.ok(!ORACLE_COMPARABLE_FIELDS.includes('lotSize'));
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: QUALIANCE_IPO, oracleRows: QUALIANCE_ORACLE, conflictRows: [],
  });
  assert.equal(violations.length, 0, 'lotSize must not appear in the generic field comparison');
});

test('(T-506) findLotDisagreements PASSES Qualiance: 1000 == 2000 / 2 (SME multiplier)', () => {
  const violations = findLotDisagreements({ ipoRows: QUALIANCE_IPO, oracleRows: QUALIANCE_ORACLE });
  assert.equal(violations.length, 0);
});

test('(T-506) findLotDisagreements FAILS when the exchange lot genuinely disagrees', () => {
  const badIpo = [{ ...QUALIANCE_IPO[0], values: { ...QUALIANCE_IPO[0].values, lotSize: 500 } }];
  const violations = findLotDisagreements({ ipoRows: badIpo, oracleRows: QUALIANCE_ORACLE });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].fieldName, 'lotSize');
  assert.match(violations[0].message, /implies an exchange lot of 1000/);
});

test('(T-506) findLotDisagreements PASSES a MAINBOARD IPO with no multiplier (1x)', () => {
  const ipo = [{ id: 'mb-1', companyName: 'Mainboard One Limited', status: 'OPEN', segment: 'MAINBOARD', values: { lotSize: 50 } }];
  const oracle = [{ companyName: 'Mainboard One Ltd.', values: { lotSize: 50 } }];
  assert.equal(findLotDisagreements({ ipoRows: ipo, oracleRows: oracle }).length, 0);
});

test('(T-506) findMinApplicationDisagreements PASSES Qualiance: 1000 x 2 == 2000', () => {
  const violations = findMinApplicationDisagreements({ ipoRows: QUALIANCE_IPO, oracleRows: QUALIANCE_ORACLE });
  assert.equal(violations.length, 0);
});

test('(T-506) findMinApplicationDisagreements FAILS when the derived minimum application disagrees', () => {
  const oracleWrong = [{ companyName: 'Qualiance International Ltd.', values: { lotSize: 3000 } }];
  const violations = findMinApplicationDisagreements({ ipoRows: QUALIANCE_IPO, oracleRows: oracleWrong });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].fieldName, 'minApplicationShares');
  assert.match(violations[0].message, /minimum retail application of 2000 shares/);
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

// T-465 round 3: a SKIP result (e.g. g_inert_detector on an empty window)
// must appear in the summary as its OWN bucket, never counted as PASS via
// `results.length - fail - unverifiable` subtraction.
test('(T-465 round 3) a SKIP result is its own summary bucket, not folded into PASS', () => {
  const results = [
    { id: 'a', status: 'PASS' },
    { id: 'b', status: 'FAIL' },
    { id: 'c', status: 'UNVERIFIABLE' },
    { id: 'g_inert_detector', status: 'SKIP' },
  ];
  const summary = computeSummaryCounts(results);
  assert.equal(summary.pass, 1);
  assert.equal(summary.fail, 1);
  assert.equal(summary.unverifiable, 1);
  assert.equal(summary.skip, 1);
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

// ---- (k) T-340 post-scrape step ledger --------------------------------------
// The runtime twin of (i) wire_or_retire. (i) catches a step that exists on
// paper and is never WIRED; (k) catches a step that IS wired, runs every
// cycle, and silently does nothing (skipped for an unnoticed reason) or fails
// every cycle inside its non-fatal catch. Both are "green cycle, dead step".

import {
  parseStepNames,
  checkStepSilence,
  countLeadingFailures,
  checkStepConsecutiveFailures,
  STEP_LEDGER_MAX_CONSECUTIVE_FAILURES,
} from '../lib/detection-floor-checks.mjs';

test('(k) expected-step list is DERIVED from scraper/src/index.ts, never hand-typed', () => {
  const src = `
const HEARTBEAT_INTERVAL_MINUTES = 30;
export const STEP_NAMES = [
  'statusUpdate',
  'registrarReresolve', // trailing comment
  'heartbeat',
] as const;
export type StepName = typeof STEP_NAMES[number];
`;
  assert.deepEqual(parseStepNames(src), ['statusUpdate', 'registrarReresolve', 'heartbeat']);
});

test('(k) parseStepNames throws when the constant is gone — the audit goes UNVERIFIABLE, never silently green', () => {
  assert.throws(() => parseStepNames('const something = [];'), /STEP_NAMES/);
});

test('(k) parseStepNames matches the REAL prod entrypoint and finds every wired step', () => {
  const src = readFileSync(new URL('../../scraper/src/index.ts', import.meta.url), 'utf8');
  const names = parseStepNames(src);
  assert.ok(names.length >= 10, `expected the real STEP_NAMES to have >=10 steps, got ${names.length}`);
  assert.ok(names.includes('statusUpdate'), 'statusUpdate must be in the derived list');
  // Every derived name must actually be passed to runStep() in the same file —
  // otherwise the SSOT lists a step nothing runs.
  for (const n of names) {
    assert.ok(src.includes(`runStep(cycleId, '${n}'`), `${n} is in STEP_NAMES but never passed to runStep()`);
  }
});

test('(k) FAILS a step with zero ok rows in the 24h window (the silent-skip shape)', () => {
  assert.ok(checkStepSilence('statusUpdate', 0) !== null);
  assert.match(checkStepSilence('statusUpdate', 0), /statusUpdate/);
});

test('(k) PASSES a step with at least one ok row in the window', () => {
  assert.equal(checkStepSilence('statusUpdate', 1), null);
  assert.equal(checkStepSilence('statusUpdate', 48), null);
});

test('(k) counts only the LEADING failures, newest-first', () => {
  assert.equal(countLeadingFailures(['failed', 'failed', 'failed', 'ok']), 3);
  assert.equal(countLeadingFailures(['ok', 'failed', 'failed', 'failed']), 0);
  assert.equal(countLeadingFailures([]), 0);
  // a 'skipped' cycle is not a failure and stops the streak
  assert.equal(countLeadingFailures(['failed', 'skipped', 'failed']), 1);
});

test('(k) FAILS a step that failed in >= 3 consecutive cycles', () => {
  const res = checkStepConsecutiveFailures('deployDriftMonitor', ['failed', 'failed', 'failed', 'ok']);
  assert.ok(res !== null);
  assert.match(res, /deployDriftMonitor/);
  assert.match(res, new RegExp(String(STEP_LEDGER_MAX_CONSECUTIVE_FAILURES)));
});

test('(k) PASSES a step at 2 consecutive failures — the threshold is 3, not "any failure"', () => {
  assert.equal(checkStepConsecutiveFailures('deployDriftMonitor', ['failed', 'failed', 'ok']), null);
});

test('(k) PASSES a healthy step', () => {
  assert.equal(checkStepConsecutiveFailures('heartbeat', ['ok', 'ok', 'ok', 'ok']), null);
});

test('(k) a step that is SKIPPED every cycle still FAILS the silence check', () => {
  // skipped rows exist, but zero of them are 'ok' — this is the exact
  // ADMIN_API_TOKEN-unset shape this task exists for.
  assert.ok(checkStepSilence('statusUpdate', 0) !== null);
  assert.equal(checkStepConsecutiveFailures('statusUpdate', ['skipped', 'skipped', 'skipped']), null);
});

// ---- manifest <-> script wiring (T-340) -------------------------------------
// detection-checks.json is read by the round-8 review contract to decide whether
// a fresh finding "should have been caught". A check listed there but never
// recorded by the audit script is a PAPER check: it makes the coverage floor
// look wider than it is. This is wire-or-retire applied to the manifest itself.

// #186 (T-460) round 2: a manifest entry can declare `auditScript` pointing at
// a DIFFERENT file than this script (e.g. g_served_stored_delta lives in
// audit-ipo-coverage.mjs --gate). Round 1 just excluded those from checking
// entirely — a manifest entry naming a nonexistent file, or a real file that
// never actually records the id, would still pass every self-test here. Fix:
// for a foreign `auditScript`, resolve it to a real file relative to the repo
// root and require it to contain either a `record('<id>'`-shaped call (the
// same machine-checkable shape this script's own checks use) OR a documented
// `// detection-check: <id>` marker comment on the recording line.
function verifyForeignAuditScript(id, auditScriptField) {
  const scriptPath = auditScriptField.split(/\s+/)[0]; // strip a trailing "(functionName)" note
  const repoRoot = new URL('../../', import.meta.url);
  let contents;
  try {
    contents = readFileSync(new URL(scriptPath, repoRoot), 'utf8');
  } catch {
    return `auditScript file does not exist: ${scriptPath}`;
  }
  const recordsId = new RegExp(`record\\(\\s*'${id}'`).test(contents);
  const markedId = new RegExp(`//\\s*detection-check:\\s*${id}\\b`).test(contents);
  if (!recordsId && !markedId) {
    return `${scriptPath} exists but never records '${id}' (no record('${id}' call and no "// detection-check: ${id}" marker)`;
  }
  return null;
}

test('every detection-checks.json check id is actually recorded by the audit script, and vice versa', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../docs/reviews/detection-checks.json', import.meta.url), 'utf8'));
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const recorded = new Set([...script.matchAll(/record\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));

  const ownChecks = manifest.checks.filter((c) => !c.auditScript || c.auditScript === manifest.auditScript);
  const foreignChecks = manifest.checks.filter((c) => c.auditScript && c.auditScript !== manifest.auditScript);

  const declared = new Set(ownChecks.map((c) => c.id));
  const paperOnly = [...declared].filter((id) => !recorded.has(id));
  assert.deepEqual(paperOnly, [], `manifest lists check(s) the audit never records: ${paperOnly.join(', ')}`);

  const undocumented = [...recorded].filter((id) => !declared.has(id) && !foreignChecks.some((c) => c.id === id));
  assert.deepEqual(undocumented, [], `audit records check(s) absent from the manifest: ${undocumented.join(', ')}`);

  // Foreign entries are not exempt — verify each one for real (file exists,
  // and actually records the id) rather than skipping them.
  const foreignFailures = foreignChecks
    .map((c) => verifyForeignAuditScript(c.id, c.auditScript))
    .filter(Boolean);
  assert.deepEqual(foreignFailures, [], `foreign-auditScript check(s) failed verification: ${foreignFailures.join('; ')}`);
});

// T-340 checker round-1 F2: the test above matches `record('id'` against the
// script's SOURCE TEXT, so an orphan check function that is never called from
// main() still "passes" as long as its dead body still contains the record()
// call. Deleting `await checkK();` from main() left this file 77/77 green
// (checker mutation M6). This test guards the INVOCATION instead: for every
// declared check id, find the function whose body actually records it, then
// assert that function name is called from inside main()'s body.
test('every detection-checks.json check id is recorded by a function that is actually CALLED from main() (not just defined)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../docs/reviews/detection-checks.json', import.meta.url), 'utf8'));
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');

  // Split the script into named top-level check-function bodies, each running
  // from its own declaration to the next top-level `function`/`async function`.
  const fnStarts = [...script.matchAll(/^(?:async )?function (check[A-Za-z_]+)\(/gm)];
  assert.ok(fnStarts.length > 0, 'no check functions found — regex drifted from the source shape');

  const fnBodies = fnStarts.map((m, i) => {
    const start = m.index;
    const end = i + 1 < fnStarts.length ? fnStarts[i + 1].index : script.length;
    return { name: m[1], body: script.slice(start, end) };
  });

  const mainStart = script.indexOf('async function main()');
  assert.ok(mainStart !== -1, 'main() not found — regex drifted from the source shape');
  const mainBody = script.slice(mainStart);

  const declared = manifest.checks.map((c) => c.id);
  const notInvoked = [];

  for (const id of declared) {
    const owner = fnBodies.find((f) => new RegExp(`record\\(\\s*'${id}'`).test(f.body));
    // No owner function in THIS script's source means either (a) it's a paper
    // check — already reported by the text-level test above — or (b) it's a
    // foreign-auditScript check verified separately by
    // verifyForeignAuditScript() in the test above (file exists + records the
    // id, in ITS OWN file). Either way this main()-invocation check, which is
    // specific to audit-detection-floor.mjs's own check-function structure,
    // has nothing to assert for it here.
    if (!owner) continue;
    // #1055: main() now dispatches every check through runCheck(checkX) (per-check try/catch
    // isolation, so one throw can't blind every later check) instead of calling checkX()
    // directly — so "invoked" must also recognise the function passed BY REFERENCE to runCheck,
    // not only a direct call.
    const invoked = new RegExp(`\\b${owner.name}\\s*\\(`).test(mainBody)
      // #1113: runCheck(checkX, ['id1', 'id2']) now carries the owned ids as a second
      // argument, so "runCheck(checkX)" alone no longer matches — accept a trailing
      // comma (more args) as well as the immediate close-paren.
      || new RegExp(`\\brunCheck\\(\\s*${owner.name}\\s*[,)]`).test(mainBody);
    if (!invoked) notInvoked.push(`${id} (owner ${owner.name} defined but never called from main())`);
  }

  assert.deepEqual(notInvoked, [], `check(s) recorded by a function main() never calls: ${notInvoked.join('; ')}`);
});

// #1055 RCA: main() was a flat sequence of `await checkX()` calls with no isolation — one check's
// uncaught error (checkC_issueSizeSourceCapability's 'column fs.row_key does not exist' on a DB
// whose migrations lag main) aborted every check after it: 59 of 63 checks never ran, and
// floor-delta.mjs then reported the missing ones as GONE. This is the failing-test-first proof for
// the CLASS (not just that one check): every top-level check call inside main() must go through
// runCheck(), which gives it its own try/catch. A future check added as a bare `await checkX();`
// (reverting to the pre-fix shape) must fail this test, not silently reintroduce the crash class.
test('#1055: every check dispatched from main() goes through runCheck() (per-check try/catch isolation)', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const mainStart = script.indexOf('async function main()');
  assert.ok(mainStart !== -1, 'main() not found — regex drifted from the source shape');
  const mainEnd = script.indexOf('\nmain().catch(');
  assert.ok(mainEnd !== -1, 'main().catch(...) entrypoint not found — regex drifted from the source shape');
  const mainBody = script.slice(mainStart, mainEnd);

  // Every bare `await checkXxx(...)` / `checkXxx(...)` call directly in main() (not inside
  // runCheck(...) or a comment) is a check dispatched WITHOUT isolation.
  const bareCalls = [...mainBody.matchAll(/(?<!runCheck\()\b(check[A-Za-z_]+)\s*\(\s*\)/g)]
    .map((m) => m[1])
    // adminQueueSize / rosterManifest etc. are not check functions and are already inside their
    // own try/catch below the check-dispatch block — exclude anything not named checkXxx.
    .filter((name) => /^check[A-Z]/.test(name) || /^check[a-z]/.test(name));
  assert.deepEqual(bareCalls, [], `check(s) called directly instead of via runCheck(): ${bareCalls.join(', ')} — a throw here would abort every later check again (#1055)`);

  // #1113: runCheck(checkX, [...ids]) — allow a trailing comma (more args), not just
  // the immediate close-paren the pre-#1113 shape had.
  const runCheckCalls = [...mainBody.matchAll(/runCheck\(\s*(check[A-Za-z_]+)\s*[,)]/g)].map((m) => m[1]);
  assert.ok(runCheckCalls.length >= 50, `expected at least 50 checks dispatched via runCheck(), found ${runCheckCalls.length} — main() may have regressed to the flat call shape`);
});

// ---- #1113: a thrown check is attributed to its REGISTERED ids, not its JS function name -------
// RCA: runCheck(fn) recorded a throw under fn.name (e.g. "checkSettledFieldRewrites"), never
// under the id(s) the function actually calls record() with (e.g. "s_settled_field_rewritten").
// floor-delta.mjs diffs by registered id, so the real id read as silently ABSENT (never
// NEW/GONE/SAME) while a fake, unregistered id appeared instead. Measured on the prod floor run
// referenced by #1113: `[UNVERIFIABLE] checkSettledFieldRewrites checkSettledFieldRewrites —
// column fs.row_key does not exist` plus a check_roster FAIL naming s_settled_field_rewritten as
// missing. These tests import the REAL function under test (runCheckAgainstIds), not a
// re-implementation.
import { runCheckAgainstIds } from '../lib/run-check.mjs';

test('#1113: a thrown check is recorded UNVERIFIABLE under EACH id it owns, with "threw: <message>" as the cause, never under the function name', async () => {
  const results = [];
  const record = (id, name, status, detail) => results.push({ id, name, status, detail });
  async function checkSettledFieldRewrites() { throw new Error('column fs.row_key does not exist'); }

  await runCheckAgainstIds(checkSettledFieldRewrites, ['s_settled_field_rewritten'], { record, results });

  assert.deepEqual(results.map((r) => r.id), ['s_settled_field_rewritten']);
  assert.equal(results[0].status, 'UNVERIFIABLE');
  assert.equal(results[0].detail, 'threw: column fs.row_key does not exist');
  assert.ok(!results.some((r) => r.id === 'checkSettledFieldRewrites'),
    'must not fall back to recording under the JS function name');
});

test('#1113: a check that owns MULTIPLE ids (e.g. checkA_B) records every one of them on a throw', async () => {
  const results = [];
  const record = (id, name, status, detail) => results.push({ id, name, status, detail });
  async function checkA_B() { throw new Error('ipowatch fetch failed'); }

  await runCheckAgainstIds(checkA_B, ['a_b_live_conflict', 'a_b_min_application'], { record, results });

  assert.deepEqual(results.map((r) => r.id).sort(), ['a_b_live_conflict', 'a_b_min_application']);
  assert.ok(results.every((r) => r.status === 'UNVERIFIABLE' && r.detail === 'threw: ipowatch fetch failed'));
});

test('#1113: an id already recorded before the throw (partial results) is not double-recorded', async () => {
  const results = [{ id: 'a_b_live_conflict', name: 'x', status: 'FAIL', detail: 'already reported' }];
  const record = (id, name, status, detail) => results.push({ id, name, status, detail });
  async function checkA_B() { throw new Error('second half crashed'); }

  await runCheckAgainstIds(checkA_B, ['a_b_live_conflict', 'a_b_min_application'], { record, results });

  const ids = results.map((r) => r.id);
  assert.deepEqual(ids, ['a_b_live_conflict', 'a_b_min_application']);
  assert.equal(results[0].detail, 'already reported', 'the pre-existing row for a_b_live_conflict must be left alone');
  assert.equal(results[1].status, 'UNVERIFIABLE');
});

test('#1113: a check that does not throw records nothing via runCheckAgainstIds', async () => {
  const results = [];
  const record = (id, name, status, detail) => results.push({ id, name, status, detail });
  let called = false;
  async function checkOk() { called = true; }

  await runCheckAgainstIds(checkOk, ['ok_id'], { record, results });

  assert.equal(called, true);
  assert.deepEqual(results, []);
});

test('#1113: falls back to the function name only when no ids are passed (defensive default, not the normal path)', async () => {
  const results = [];
  const record = (id, name, status, detail) => results.push({ id, name, status, detail });
  async function checkSomething() { throw new Error('boom'); }

  await runCheckAgainstIds(checkSomething, [], { record, results });

  assert.deepEqual(results.map((r) => r.id), ['checkSomething']);
});

// #1113 test (b): every runCheck(...) call inside main() names the ids it owns, and the union
// of every named id equals the set check_roster (the existing roster consumer, docs/reviews/
// detection-checks.json) uses. A call left with an empty [] (or reverted to the pre-#1113
// no-args shape) would silently lose per-check id attribution again.
test('#1113: every runCheck() call in main() names ids, and their union equals the roster', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../../docs/reviews/detection-checks.json', import.meta.url), 'utf8'));
  const declared = new Set(
    manifest.checks.filter((c) => !c.auditScript || c.auditScript === manifest.auditScript).map((c) => c.id)
  );

  const mainStart = script.indexOf('async function main()');
  const mainEnd = script.indexOf('\nmain().catch(');
  assert.ok(mainStart !== -1 && mainEnd !== -1, 'regex drifted from the source shape');
  const mainBody = script.slice(mainStart, mainEnd);

  // Function names include digits (checkE_unknownSlug404, checkG1_repeatedWarn,
  // checkS_e1Source) — the fn-name class must allow 0-9, not just letters/underscore.
  const calls = [...mainBody.matchAll(/runCheck\(\s*(check[A-Za-z0-9_]+)\s*,\s*\[([^\]]*)\]\s*\)/g)];
  assert.ok(calls.length >= 50, `expected at least 50 runCheck(fn, [ids]) calls, found ${calls.length}`);

  const unionIds = new Set();
  const emptyIdsCalls = [];
  for (const [, fnName, idsSrc] of calls) {
    const ids = [...idsSrc.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    if (ids.length === 0) emptyIdsCalls.push(fnName);
    for (const id of ids) unionIds.add(id);
  }
  assert.deepEqual(emptyIdsCalls, [], `runCheck() call(s) with no ids named: ${emptyIdsCalls.join(', ')}`);

  // check_roster is recorded directly by main() itself (the roster consumer runs LAST, after
  // every runCheck() call, and deliberately is not one of the checks runCheck dispatches) — not
  // a gap in per-check id attribution, so it is excluded from this union requirement.
  const missingFromUnion = [...declared].filter((id) => id !== 'check_roster' && !unionIds.has(id));
  assert.deepEqual(missingFromUnion, [], `roster id(s) never named by any runCheck() call: ${missingFromUnion.join(', ')}`);
});

// ---- (l) T-340 NSE status cross-check ---------------------------------------
// Our OPEN/UPCOMING set is produced by our own pipeline; nothing independent
// checks it. NSE's own current-issue + upcoming feeds are the primary oracle
// for "is this IPO actually open right now". Scope is deliberately narrow --
// MAINBOARD rows that list NSE as an exchange -- because NSE SME (Emerge) and
// BSE-only issues legitimately do not appear on these endpoints, and a check
// that FAILs on those would be noise, which is how a channel gets muted.

import {
  crossCheckNseStatuses,
  buildNseKeySet,
} from '../lib/detection-floor-checks.mjs';

const nse = (symbol, companyName) => ({ symbol, companyName });
const ours = (o) => ({
  companyName: 'X Ltd', symbol: 'X', status: 'OPEN',
  segment: 'MAINBOARD', listingExchanges: ['NSE'], ...o,
});

test('(l) key set matches on symbol OR normalized company name', () => {
  const keys = buildNseKeySet([nse('ACME', 'Acme Industries Limited')]);
  assert.ok(keys.has('ACME'));
  assert.ok(keys.has(normalizeCompanyKey('Acme Industries Ltd')));
});

test('(l) FAILS when we publish OPEN but NSE current-issue does not list it', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Ghost Ltd', symbol: 'GHOST', status: 'OPEN' })],
    nseCurrent: [nse('OTHER', 'Other Ltd')],
    nseUpcoming: [],
  });
  // BOTH directions are real defects here and both must be named: we publish an
  // OPEN NSE lists nowhere, AND NSE lists an open issue we do not carry.
  assert.equal(m.length, 2);
  const joined = m.map((x) => x.message).join(' | ');
  assert.match(joined, /Ghost Ltd/);
  assert.match(joined, /Other Ltd/);
});

test('(l) FAILS when NSE lists an issue as currently open and we do not show it OPEN', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Late Ltd', symbol: 'LATE', status: 'UPCOMING' })],
    nseCurrent: [nse('LATE', 'Late Ltd')],
    nseUpcoming: [],
  });
  assert.ok(m.length >= 1);
  assert.match(m.map((x) => x.message).join(' '), /LATE|Late Ltd/);
});

test('(l) FAILS when NSE lists a currently-open issue we have no row for at all', () => {
  const m = crossCheckNseStatuses({
    ourRows: [],
    nseCurrent: [nse('MISSING', 'Missing Ltd')],
    nseUpcoming: [],
  });
  assert.equal(m.length, 1);
  assert.match(m[0].message, /Missing Ltd/);
});

test('(l) PASSES when our OPEN set matches NSE current-issue exactly', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Acme Ltd', symbol: 'ACME', status: 'OPEN' })],
    nseCurrent: [nse('ACME', 'Acme Ltd')],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) matches on company name when the symbol is not yet assigned', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Acme Industries Limited', symbol: null, status: 'OPEN' })],
    nseCurrent: [nse('ACME', 'Acme Industries Ltd')],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) ignores SME rows — NSE Emerge is not on these endpoints (noise control)', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Tiny Ltd', symbol: 'TINY', status: 'OPEN', segment: 'SME' })],
    nseCurrent: [],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) ignores BSE-only rows — they legitimately never appear on NSE feeds', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Bse Only Ltd', symbol: 'BONLY', status: 'OPEN', listingExchanges: ['BSE'] })],
    nseCurrent: [],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) ignores rows with unknown listing exchanges rather than guessing', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({ companyName: 'Unknown Ltd', symbol: 'UNK', status: 'OPEN', listingExchanges: null })],
    nseCurrent: [],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) an NSE UPCOMING issue we do not list at all is a mismatch', () => {
  const m = crossCheckNseStatuses({
    ourRows: [],
    nseCurrent: [],
    nseUpcoming: [nse('SOON', 'Soon Ltd')],
  });
  assert.equal(m.length, 1);
  assert.match(m[0].message, /Soon Ltd/);
});

test('(l) does not double-report the same company from both feeds', () => {
  const m = crossCheckNseStatuses({
    ourRows: [],
    nseCurrent: [nse('DUP', 'Dup Ltd')],
    nseUpcoming: [nse('DUP', 'Dup Ltd')],
  });
  assert.equal(m.length, 1);
});

// --- #895: direction 2 must match NSE feed rows against EVERY row we
// publish, not just the MAINBOARD-scoped set direction 1 uses. An SME row on
// NSE's upcoming/current feed is real (measured 2026-09-23: Himalayan Solar,
// Pooja Logistics, Coreintegra, all SME, all exist) and must not be reported
// as "we have no row for it at all".

test('(l) #895 an SME UPCOMING row matching NSE upcoming feed is not a mismatch', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({
      companyName: 'Himalayan Solar Limited', symbol: 'HIMALAYAN',
      status: 'UPCOMING', segment: 'SME', listingExchanges: ['NSE'],
    })],
    nseCurrent: [],
    nseUpcoming: [nse('HIMALAYAN', 'Himalayan Solar Limited')],
  });
  assert.deepEqual(m, []);
});

test('(l) #895 an SME OPEN row matching NSE current-issue feed is not a mismatch', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({
      companyName: 'Pooja Logistics Limited', symbol: 'POOJALOG',
      status: 'OPEN', segment: 'SME', listingExchanges: ['NSE'],
    })],
    nseCurrent: [nse('POOJALOG', 'Pooja Logistics Limited')],
    nseUpcoming: [],
  });
  assert.deepEqual(m, []);
});

test('(l) #895 a genuinely missing company on NSE upcoming still FAILS (discriminates)', () => {
  const m = crossCheckNseStatuses({
    ourRows: [ours({
      companyName: 'Himalayan Solar Limited', symbol: 'HIMALAYAN',
      status: 'UPCOMING', segment: 'SME', listingExchanges: ['NSE'],
    })],
    nseCurrent: [],
    nseUpcoming: [
      nse('HIMALAYAN', 'Himalayan Solar Limited'),
      nse('MONEYVIEW', 'Moneyview Limited'),
    ],
  });
  assert.equal(m.length, 1);
  assert.match(m[0].message, /Moneyview Limited/);
});

test('(l) #895 direction 1 stays MAINBOARD-scoped: an SME UPCOMING row on NSE current produces no direction-1 message', () => {
  // Pins current behaviour: widening direction 1 to SME is a separate
  // decision (issue #895 item 3), not part of this fix. An SME row whose
  // company appears on NSE's CURRENT feed while we still say UPCOMING is a
  // real status disagreement — direction 2 correctly flags it once SME rows
  // are in scope for direction 2 — but it must NOT ALSO produce direction 1's
  // "NSE lists it as CURRENT (open) issue while we still publish it as
  // UPCOMING" message, because direction 1's scan (`scoped`) stays
  // MAINBOARD-only by design.
  const m = crossCheckNseStatuses({
    ourRows: [ours({
      companyName: 'Coreintegra Consulting Services Limited', symbol: 'COREINTEGRA',
      status: 'UPCOMING', segment: 'SME', listingExchanges: ['NSE'],
    })],
    nseCurrent: [nse('COREINTEGRA', 'Coreintegra Consulting Services Limited')],
    nseUpcoming: [],
  });
  const joined = m.map((x) => x.message).join(' | ');
  assert.doesNotMatch(joined, /NSE lists .* as a CURRENT \(open\) issue while we still publish/);
});

// --- fix-round W-136-r2: incomplete_row_count only counts DUE rows ---------
// (a row in a deliberate future next_retry_at backoff must not be flagged as
// a rotation stall), and the lead-manager count query must not use
// array_length on a jsonb column. ------------------------------------------

test('listed_rotation_stall SQL: incomplete_row_count excludes rows in a future backoff', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  // The FILTER must require the row to actually be due (no future
  // next_retry_at), not merely "not complete" — otherwise a row parked in a
  // deliberate backoff (next_retry_at in the future) with an old
  // last_attempt_at false-positives as a rotation stall.
  assert.match(script, /AND \(s\.next_retry_at IS NULL OR s\.next_retry_at <= now\(\)\)/);
});

test('lead-manager count SQL: no longer calls array_length on the jsonb lead_managers column', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /(?<!jsonb_)array_length\(lead_managers/);
  assert.match(script, /jsonb_array_length\(lead_managers\)/);
});

// --- fix-round audit-pool-utc: every audit Pool pins the DB session to UTC --
// (packages/shared/src/db/timezone-config.ts) — the DB server default session
// tz is Asia/Calcutta while naive `timestamp` columns hold UTC wall-clock, so
// an un-pinned pool makes every now()-relative age check in this file fire
// 5.5h early with no visible symptom (a document BLOCKED_ALL for 18.5h reads
// as >24h). Source-level assertion: every `new pg.Pool(` block in the script
// must carry the UTC pin, and count-matching keeps this from being satisfied
// by a single stray occurrence while a second Pool block goes unpinned.

test('audit-detection-floor.mjs: uses createUtcPool + installUtcTimestampParsing, no direct new Pool(', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  assert.match(script, /createUtcPool[\s\S]*from '\.\/lib\/pg-utc\.mjs'/);
  assert.match(script, /installUtcTimestampParsing\(\)/);
  assert.match(script, /createUtcPool\(/);
  assert.doesNotMatch(script, /new pg\.Pool\(/);
  assert.doesNotMatch(script, /new Pool\(/);
});

test('audit-detection-floor.mjs: main() asserts the DB session (timezone + parser round-trip) before running checks', () => {
  const script = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  assert.match(script, /async function assertSessionTimezoneUtc\s*\(/);
  assert.match(script, /assertUtcSession\(pool\)/);
  const mainBody = script.slice(script.indexOf('async function main('));
  assert.match(
    mainBody.slice(0, mainBody.indexOf('\n', mainBody.indexOf('\n') + 1) + 200),
    /await assertSessionTimezoneUtc\(\)/,
    'assertSessionTimezoneUtc() must run at the very start of main(), before any check'
  );
});

test('audit-ipo-coverage.mjs: uses createUtcPool + installUtcTimestampParsing, no direct new Pool(', () => {
  const script = readFileSync(new URL('../audit-ipo-coverage.mjs', import.meta.url), 'utf8');
  assert.match(script, /createUtcPool[\s\S]*from '\.\/lib\/pg-utc\.mjs'/);
  assert.match(script, /installUtcTimestampParsing\(\)/);
  assert.match(script, /createUtcPool\(/);
  assert.doesNotMatch(script, /new pg\.Pool\(/);
  assert.doesNotMatch(script, /new Pool\(/);
});

test('audit-ipo-coverage.mjs: main() asserts the DB session before running checks', () => {
  const script = readFileSync(new URL('../audit-ipo-coverage.mjs', import.meta.url), 'utf8');
  assert.match(script, /assertUtcSession\(pool\)/);
  const mainBody = script.slice(script.indexOf('async function main('));
  assert.match(
    mainBody.slice(0, mainBody.indexOf('\n', mainBody.indexOf('\n') + 1) + 300),
    /await assertUtcSession\(pool\)/,
    'assertUtcSession(pool) must run at the very start of main(), before any check'
  );
});

// audit-substance-plausibility.mjs and fix-substance-corruption.mjs coverage
// (createUtcPool, installUtcTimestampParsing, assertUtcSession, no direct
// Pool construction) now lives in scripts/tests/pg-utc.test.mjs — kept as one
// copy there to avoid two source-of-truth assertions drifting apart.

// ---- round 7: schema-backed column-membership check for m_extraction_stuck's query ----
// The `d.doc_type does not exist` failure on staging (documents' real column is
// `type`, not `doc_type` — document_fetch_state uses `doc_type`) is the SAME
// query-shape class audit-substance-plausibility.test.mjs guards for `ipos`/
// `listing_performance`. Extended here for the extractionStuckRows query's three
// aliases: i (ipos), d (documents), fs (document_fetch_state).

function extractTableColumnsForFloorTest(schemaSource, constName) {
  const noComments = schemaSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const declMarker = `export const ${constName} = pgTable(`;
  const declStart = noComments.indexOf(declMarker);
  assert.ok(declStart !== -1, `could not find "export const ${constName} = pgTable(" in schema.ts`);
  const braceStart = noComments.indexOf('{', declStart);
  assert.ok(braceStart !== -1, `could not find the columns object opening brace for ${constName}`);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < noComments.length; i++) {
    if (noComments[i] === '{') depth++;
    else if (noComments[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end !== -1, `unbalanced braces while scanning ${constName}'s columns object`);
  const block = noComments.slice(braceStart + 1, end);
  const columns = new Set();
  const colRe = /\b[A-Za-z_][A-Za-z0-9_]*\(\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = colRe.exec(block)) !== null) columns.add(m[1]);
  return columns;
}

function extractColumnRefsForFloorTest(sql, alias) {
  const refs = new Set();
  const re = new RegExp(`\b${alias}\.([a-z_][a-z0-9_]*)`, 'g');
  let m;
  while ((m = re.exec(sql)) !== null) refs.add(m[1]);
  return refs;
}

function extractExtractionStuckSql(auditSource) {
  const marker = 'SELECT i.company_name, i.slug, i.status AS ipo_status';
  const start = auditSource.indexOf(marker);
  assert.ok(start !== -1, 'extractionStuckRows query not found in audit-detection-floor.mjs — has it been renamed/moved?');
  const endMarker = "starts_with(d.extraction_error, 'blocked_after_'))";
  const end = auditSource.indexOf(endMarker, start);
  assert.ok(end !== -1, 'could not locate the end of the extractionStuckRows query');
  return auditSource.slice(start, end + endMarker.length);
}

test('m_extraction_stuck query: every i./d./fs.<col> reference is a real column of ipos/documents/document_fetch_state (schema.ts SSOT)', () => {
  const auditSource = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const schemaSource = readFileSync(new URL('../../packages/shared/src/db/schema.ts', import.meta.url), 'utf8');
  const sql = extractExtractionStuckSql(auditSource);

  const iposColumns = extractTableColumnsForFloorTest(schemaSource, 'ipos');
  const documentsColumns = extractTableColumnsForFloorTest(schemaSource, 'documents');
  const fetchStateColumns = extractTableColumnsForFloorTest(schemaSource, 'documentFetchState');

  // Canaries — prove the extractor still matches the real schema shape, and
  // pin the exact defect this round found: `documents` has NO `doc_type`.
  assert.ok(documentsColumns.has('type'), 'canary: "type" column not found on documents — extractor drifted');
  assert.ok(!documentsColumns.has('doc_type'), 'canary: documents unexpectedly has doc_type in schema.ts — has the schema changed?');
  assert.ok(fetchStateColumns.has('doc_type'), 'canary: "doc_type" column not found on document_fetch_state — extractor drifted');

  const checks = [
    ['i', iposColumns],
    ['d', documentsColumns],
    ['fs', fetchStateColumns],
  ];
  for (const [alias, columns] of checks) {
    const referenced = extractColumnRefsForFloorTest(sql, alias);
    const bogus = [...referenced].filter((c) => !columns.has(c));
    assert.deepEqual(bogus, [], `extractionStuckRows query references ${alias}.<col> not present on its real table: ${bogus.join(', ')}`);
  }
});

// ---- T-472: a_b_live_conflict extended to 6 fields against a NON-INGESTED
// oracle (ipowatch.in — the scraper never reads it) instead of Chittorgarh
// (which the scraper DOES ingest, so comparing against it proved nothing).
// The fixtures below are REAL pages captured 2026-09-07 (see file headers for
// URL + date), not typed from memory — same discipline the defect-fix
// contract requires for any parser/extractor brief.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ipowatch');
const INFRAX_HTML = readFileSync(join(FIXTURES_DIR, 'infrax-renewable-detail.html'), 'utf8');
const AMTECH_HTML = readFileSync(join(FIXTURES_DIR, 'amtech-esters-detail.html'), 'utf8');

test('(a/b oracle parser) extracts all six fields from the real Infrax Renewable fixture', () => {
  const v = parseIpowatchDetail(INFRAX_HTML);
  assert.ok(v, 'parser returned null on a real, well-formed page');
  assert.equal(v.openDate.slice(0, 10), '2026-09-09');
  assert.equal(v.closeDate.slice(0, 10), '2026-09-11');
  // Infrax is a FIXED-PRICE SME issue ("₹104 Per Share") -> min === max.
  assert.equal(v.priceRangeMin, 104);
  assert.equal(v.priceRangeMax, 104);
  assert.equal(v.lotSize, 2400, 'must read the FAQ answer AFTER the key-facts block, not the "related IPO" sidebar excerpt (Q-Line Biotech, 800 shares) that appears BEFORE it in the same document');
  assert.equal(v.issueSize, 40_88_00_00_0 /* Approx Rs 40.88 Cr */);
});

test('(a/b oracle parser) extracts a real book-built band from the Amtech Esters fixture', () => {
  const v = parseIpowatchDetail(AMTECH_HTML);
  assert.equal(v.priceRangeMin, 71);
  assert.equal(v.priceRangeMax, 75);
  assert.equal(v.lotSize, 3200);
  assert.equal(v.issueSize, 17_88_00_00_0 /* Approx Rs 17.88 Cr */);
});

test('(a/b oracle parser) date parsing is TZ-independent (calendar day, not local midnight)', () => {
  // Regression for the class this fix caught in dev: `new Date('September 9,
  // 2026')` returns a DIFFERENT calendar day on a UTC box vs an IST box once
  // read back via .toISOString().slice(0,10) -- a nightly cron (UTC) and a
  // laptop run (IST) must never disagree about what day was published.
  assert.equal(parseIpowatchDate('September 9, 2026'), '2026-09-09T00:00:00.000Z');
  assert.equal(parseIpowatchDate('January 1, 2027'), '2027-01-01T00:00:00.000Z');
});

test('(a/b oracle parser) TBA/not-yet-priced fields parse to null, not zero or a false band', () => {
  assert.deepEqual(parsePriceBand('₹[.] to ₹[.] Per Share'), { min: null, max: null });
  assert.equal(parseRupeeAmount('Approx ₹[.] Crores'), null);
});

test('(a/b oracle parser) UNVERIFIABLE (null), never a fabricated PASS, when the key-facts block is missing', () => {
  assert.equal(parseIpowatchDetail('<html><body>this is not an ipowatch IPO detail page</body></html>'), null);
});

test('(a/b, GitHub #199 real-data proof) Amtech Esters UPCOMING issue_size disagreement: ours=0 (data gap) vs ipowatch=Rs 17.88 Cr — FAILs, not silently skipped', () => {
  const oracleValues = parseIpowatchDetail(AMTECH_HTML);
  const ipoRows = [{
    id: 'staging-amtech', companyName: 'Amtech Esters Ltd.', status: 'UPCOMING',
    values: {
      openDate: oracleValues.openDate, closeDate: oracleValues.closeDate, // dates agree on staging
      priceRangeMin: 71, priceRangeMax: 75, // band agrees on staging
      lotSize: null, // not stored on staging -- null is skipped, not compared
      issueSize: 0, // REAL staging value, measured via the tunnel 2026-09-07 -- a data gap
    },
  }];
  const violations = findLiveCrossSourceDisagreements({
    ipoRows,
    oracleRows: [{ companyName: 'Amtech Esters', values: oracleValues }],
    conflictRows: [],
    oracleName: 'IPOWATCH',
  });
  assert.equal(violations.length, 1, 'only issueSize should disagree');
  assert.equal(violations[0].fieldName, 'issueSize');
  assert.match(violations[0].message, /issueSize=0.*IPOWATCH currently says 178800000/);
});

test('(a/b, band FAILs) a wrong price band on a live IPO is caught against the real Infrax oracle values', () => {
  const oracleValues = parseIpowatchDetail(INFRAX_HTML);
  const ipoRows = [{
    id: 'i-wrong-band', companyName: 'Infrax Renewable Ltd.', status: 'OPEN',
    values: { ...oracleValues, priceRangeMin: 90, priceRangeMax: 90 }, // corrupted band, everything else agrees
  }];
  const violations = findLiveCrossSourceDisagreements({
    ipoRows, oracleRows: [{ companyName: 'Infrax Renewable', values: oracleValues }], conflictRows: [], oracleName: 'IPOWATCH',
  });
  assert.equal(violations.length, 2, 'both priceRangeMin and priceRangeMax disagree (90 vs 104)');
  assert.ok(violations.every((v) => v.fieldName === 'priceRangeMin' || v.fieldName === 'priceRangeMax'));
});

test('(a/b, rupee tolerance) a sub-1% rounding difference on issueSize is NOT a violation', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Rounding Co Ltd', status: 'OPEN', values: { issueSize: 40_88_00_000 } }],
    oracleRows: [{ companyName: 'Rounding Co', values: { issueSize: 40_50_00_000 } }], // 0.93% off
    conflictRows: [], oracleName: 'IPOWATCH',
  });
  assert.equal(violations.length, 0);
});

test('(a/b, rupee tolerance) a >1% difference on priceRangeMax IS a violation', () => {
  const violations = findLiveCrossSourceDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Over Tolerance Ltd', status: 'OPEN', values: { priceRangeMax: 100 } }],
    oracleRows: [{ companyName: 'Over Tolerance', values: { priceRangeMax: 102 } }], // 2% off
    conflictRows: [], oracleName: 'IPOWATCH',
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].fieldName, 'priceRangeMax');
});

// T-506 (#415): lotSize moved OUT of the generic exact-match loop — ipowatch's
// figure is a minimum-BID-shares figure, not the exchange lot (see the T-506
// block above for findLotDisagreements/findMinApplicationDisagreements,
// which now own the lot-vs-min-application comparison with the segment
// multiplier applied). This generic-loop test is kept as a MAINBOARD-shaped
// exact-compare regression guard (multiplier is 1x there, so the direct
// exact-compare semantics below still describe findLotDisagreements'
// behavior for MAINBOARD, exercised directly rather than through the field loop).
test('(T-506) findLotDisagreements is compared exactly (no tolerance) for MAINBOARD (1x multiplier)', () => {
  const violations = findLotDisagreements({
    ipoRows: [{ id: 'i', companyName: 'Lot Mismatch Ltd', status: 'OPEN', segment: 'MAINBOARD', values: { lotSize: 2400 } }],
    oracleRows: [{ companyName: 'Lot Mismatch', values: { lotSize: 2401 } }],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].fieldName, 'lotSize');
});

test('ORACLE_COMPARABLE_FIELDS carries the five exact/tolerance-compared fields (lotSize handled separately, T-506)', () => {
  assert.deepEqual(ORACLE_COMPARABLE_FIELDS, ['openDate', 'closeDate', 'priceRangeMin', 'priceRangeMax', 'issueSize']);
});

// ---- T-472 round 2: oracle coverage floor -----------------------------------

test('(coverage floor) WARNs when zero live IPOs matched the oracle index despite live IPOs existing', () => {
  const w = computeOracleCoverageWarning({ liveCount: 5, matched: 0, unparseable: 0 });
  assert.match(w, /0 of 5 live IPOs matched/);
});

test('(coverage floor) WARNs when more than half of matched pages are unparseable (template drift)', () => {
  const w = computeOracleCoverageWarning({ liveCount: 10, matched: 4, unparseable: 3 });
  assert.match(w, /3 unparseable of 4 matched/);
});

test('(coverage floor) stays quiet (null) at or below the threshold', () => {
  assert.equal(computeOracleCoverageWarning({ liveCount: 10, matched: 4, unparseable: 2 }), null); // exactly 50%
  assert.equal(computeOracleCoverageWarning({ liveCount: 0, matched: 0, unparseable: 0 }), null, 'no live IPOs tonight is not a coverage problem');
  assert.equal(computeOracleCoverageWarning({ liveCount: 10, matched: 8, unparseable: 0 }), null);
});

// ---- MAJOR-2 fix (S4 review round 2): the card's required pull_overrides floor test -----------
// The card's Tests section required this file to carry a pull_overrides case, red on a planted
// expired row. It had zero mentions of pull_overrides before this fix -- checkS_pullOverrides
// (the SQL, the 42P01 PASS branch, record/notify wiring) was executed by no test; only the
// pure helper checkOverrideRow was covered, and only in scripts/tests/pull-policy-checks.test.mjs.
// This imports checkOverrideRow + validateOverrideRankSet from the SAME lib checkS_pullOverrides
// itself imports (scripts/lib/pull-policy-checks.mjs, not scripts/audit-detection-floor.mjs's own
// SQL wiring, which needs a live DB) so a weakened/deleted predicate fails here too.
import { checkOverrideRow, validateOverrideRankSet } from '../lib/pull-policy-checks.mjs';

const PULL_OVERRIDES_MANIFEST = {
  fields: {
    'ipos.issue_size': {
      class: 'D',
      rank: { MAINBOARD: ['DOC', 'CHITTORGARH'] },
      capability: { DOC: { capable: true }, CHITTORGARH: { capable: true } },
    },
  },
};

test('(pull_overrides floor) FAILS on a planted row past expires_at with expired_at not set', () => {
  const row = {
    id: 'ov-stale', tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
    rank1Source: 'CHITTORGARH', rank2Source: null, rank3Source: null,
    reason: 'valid override reason text here', expiresAt: new Date(Date.now() - 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) =>
    validateOverrideRankSet(PULL_OVERRIDES_MANIFEST, c.table, c.column, c.ranks)
  );
  assert.ok(result.violation !== null, 'expired-but-unflagged row must be a violation');
  assert.equal(result.stillTimeActive, false);
});

test('(pull_overrides floor) PASSES a clean, still-active, manifest-valid row', () => {
  const row = {
    id: 'ov-clean', tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
    rank1Source: 'CHITTORGARH', rank2Source: null, rank3Source: null,
    reason: 'valid override reason text here', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) =>
    validateOverrideRankSet(PULL_OVERRIDES_MANIFEST, c.table, c.column, c.ranks)
  );
  assert.equal(result.violation, null);
  assert.equal(result.stillTimeActive, true);
});

// ---- (i) identity: one IPO stored twice / two offerings folded into one company (#903) ----

test('(i) normalizeIdentityCompanyName folds bracketed text, trailing " - X" text, stopwords', () => {
  assert.equal(
    normalizeIdentityCompanyName("Rays of Belief Limited- For Profit Social Enterprise"),
    normalizeIdentityCompanyName("Rays of Belief Ltd.")
  );
  assert.equal(normalizeIdentityCompanyName("Purple Style Labs Ltd. (Pernia's Pop-Up Studio IPO)").includes("ipo"), false);
});

test('(i) stripIdentitySlugSuffix removes a trailing page-status suffix only', () => {
  assert.equal(stripIdentitySlugSuffix('rays-of-belief-ltd-o'), 'rays-of-belief-ltd');
  assert.equal(stripIdentitySlugSuffix('rays-of-belief-ltd'), 'rays-of-belief-ltd');
  assert.equal(stripIdentitySlugSuffix('technocraft-ventures-ltd'), 'technocraft-ventures-ltd');
});

// Real data from #903: the live Rays of Belief pair on prod+staging.
const RAYS_OF_BELIEF_A = {
  id: 'a1', slug: 'rays-of-belief-ltd', companyName: 'Rays of Belief Ltd.',
  cin: null, isin: null, symbol: 'MOMSBELIEF', bseScripCode: null,
  offeringType: 'IPO', status: 'CLOSED', openDate: '2026-08-20',
};
const RAYS_OF_BELIEF_B = {
  id: 'a2', slug: 'rays-of-belief-ltd-o', companyName: "Rays of Belief Limited- For Profit Social Enterprise",
  cin: null, isin: null, symbol: null, bseScripCode: null,
  offeringType: 'IPO', status: 'OPEN', openDate: '2026-09-01',
};

test('(i) i_same_ipo_two_rows FLAGS the real Rays of Belief pair (suffix-stripped slug match)', () => {
  const groups = findSameIpoTwoRows([RAYS_OF_BELIEF_A, RAYS_OF_BELIEF_B]);
  assert.ok(groups.length >= 1, 'expected at least one group');
  const flat = groups.flatMap((g) => g.rows.map((r) => r.slug));
  assert.ok(flat.includes('rays-of-belief-ltd'));
  assert.ok(flat.includes('rays-of-belief-ltd-o'));
});

// Real data from #903: two DIFFERENT companies with similar names — must NEVER pair.
const HIMALAYAN_SOLAR = {
  id: 'b1', slug: 'himalayan-solar-limited', companyName: 'Himalayan Solar Limited',
  cin: 'U40106HP2015PLC001111', isin: null, symbol: null, bseScripCode: null,
  offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-09-25',
};
const HIMALAYA_NUTRAVEDICS = {
  id: 'b2', slug: 'himalaya-nutravedics-india-limited', companyName: 'Himalaya Nutravedics India Limited',
  cin: 'U15400HR2016PLC002222', isin: null, symbol: null, bseScripCode: null,
  offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-09-22',
};
const TECHNOCRAFT_VENTURES = {
  id: 'c1', slug: 'technocraft-ventures-ltd', companyName: 'Technocraft Ventures Ltd.',
  cin: 'U29100GJ2018PLC003333', isin: null, symbol: null, bseScripCode: null,
  offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-08-07',
};
const TECHNOCRATS_PLASMA = {
  id: 'c2', slug: 'technocrats-plasma-systems-ltd', companyName: 'Technocrats Plasma Systems Ltd.',
  cin: 'U29100MH2019PLC004444', isin: null, symbol: null, bseScripCode: null,
  offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-08-14',
};

test('(i) i_same_ipo_two_rows does NOT flag the real Himalayan/Himalaya look-alike pair', () => {
  const groups = findSameIpoTwoRows([HIMALAYAN_SOLAR, HIMALAYA_NUTRAVEDICS]);
  assert.equal(groups.length, 0);
});

test('(i) i_same_ipo_two_rows does NOT flag the real Technocraft/Technocrats look-alike pair', () => {
  const groups = findSameIpoTwoRows([TECHNOCRAFT_VENTURES, TECHNOCRATS_PLASMA]);
  assert.equal(groups.length, 0);
});

test('(i) i_company_two_live_rows does NOT flag either real look-alike pair', () => {
  assert.equal(findCompanyTwoLiveRows([HIMALAYAN_SOLAR, HIMALAYA_NUTRAVEDICS]).length, 0);
  assert.equal(findCompanyTwoLiveRows([TECHNOCRAFT_VENTURES, TECHNOCRATS_PLASMA]).length, 0);
});

test('(i) i_same_ipo_two_rows FLAGS a G.V. Electricals-shaped 5-row group as one group (shared CIN)', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `gv${i}`, slug: `g-v-electricals-ltd${i ? '-' + i : ''}`, companyName: 'G.V. Electricals Ltd.',
    cin: 'U31200GJ2020PLC005555', isin: null, symbol: null, bseScripCode: null,
    offeringType: 'IPO', status: 'CLOSED', openDate: '2026-06-01',
  }));
  const groups = findSameIpoTwoRows(rows);
  assert.equal(groups.length, 1, 'all 5 rows should collapse into ONE group (same CIN)');
  assert.equal(groups[0].rows.length, 5);
});

test('(i) i_same_ipo_two_rows PASSES a clean single row', () => {
  const groups = findSameIpoTwoRows([{
    id: 'z1', slug: 'clean-company-ltd', companyName: 'Clean Company Ltd.',
    cin: 'U99999DL2021PLC009999', isin: null, symbol: 'CLEANCO', bseScripCode: null,
    offeringType: 'IPO', status: 'UPCOMING', openDate: '2026-10-01',
  }]);
  assert.equal(groups.length, 0);
});

test('(i) i_ipo_title_in_name FLAGS a real title-in-name slug (S3, purple-style-labs)', () => {
  const row = {
    slug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
    companyName: "Purple Style Labs Ltd. (Pernia's Pop-Up Studio IPO)",
  };
  assert.ok(checkIpoTitleInName(row) !== null);
});

test('(i) i_ipo_title_in_name FLAGS a page-status-suffixed slug (S1 shape)', () => {
  assert.ok(checkIpoTitleInName({ slug: 'rays-of-belief-ltd-o', companyName: 'Rays of Belief Ltd.' }) !== null);
});

test('(i) i_ipo_title_in_name PASSES a clean name/slug', () => {
  assert.equal(checkIpoTitleInName({ slug: 'clean-company-ltd', companyName: 'Clean Company Ltd.' }), null);
});

test('(i) i_company_two_live_rows FLAGS two live rows of the same company (S4 shape)', () => {
  const rowA = { id: 'd1', slug: 'polymatech-electronics-ltd', companyName: 'Polymatech Electronics Ltd.', status: 'WITHDRAWN', offeringType: 'IPO' };
  const rowB = { id: 'd2', slug: 'polymatech-electronics-ltd-2', companyName: 'Polymatech Electronics Ltd.', status: 'UPCOMING', offeringType: 'IPO' };
  const groups = findCompanyTwoLiveRows([rowA, rowB]);
  // WITHDRAWN is not in IDENTITY_LIVE_STATUSES, so only rowB is "live" -- no
  // pair with just one live row. Add a second concurrently-live row instead.
  assert.equal(groups.length, 0);
  const rowC = { id: 'd3', slug: 'polymatech-electronics-ltd-3', companyName: 'Polymatech Electronics Ltd.', status: 'OPEN', offeringType: 'IPO' };
  const groups2 = findCompanyTwoLiveRows([rowB, rowC]);
  assert.equal(groups2.length, 1);
  assert.equal(groups2[0].rows.length, 2);
});

test('(i) findNameBoundLiveRows FLAGS a live IPO row with no CIN/symbol/ISIN (OD-34)', () => {
  const row = { id: 'e1', slug: 'no-id-yet-ltd', companyName: 'No Id Yet Ltd.', offeringType: 'IPO', status: 'UPCOMING', cin: null, symbol: null, isin: null };
  const out = findNameBoundLiveRows([row]);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'no-id-yet-ltd');
});

test('(i) findNameBoundLiveRows PASSES a live IPO row that already carries a CIN', () => {
  const row = { id: 'e2', slug: 'has-cin-ltd', companyName: 'Has Cin Ltd.', offeringType: 'IPO', status: 'UPCOMING', cin: 'U12345DL2020PLC000001', symbol: null, isin: null };
  assert.equal(findNameBoundLiveRows([row]).length, 0);
});

test('(i) findUndecidedIdentityHolds FLAGS a recent OD-68 hold nobody has decided, by name', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const holds = [
    { slug: 'rays-of-belief-ltd', companyName: 'Rays of Belief Ltd.', candidates: 'rays-of-belief-ltd', at: '2026-09-23T04:00:00Z' },
    { slug: 'rays-of-belief-ltd', companyName: 'Rays of Belief Ltd.', candidates: 'rays-of-belief-ltd', at: '2026-09-22T04:00:00Z' },
  ];
  const out = findUndecidedIdentityHolds(holds, [], now);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'rays-of-belief-ltd');
  assert.equal(out[0].at, '2026-09-23T04:00:00Z');
});

test('(i) findUndecidedIdentityHolds keeps the hold details.reason so the nightly line names the refusing rule (#928)', () => {
  const now = new Date('2026-09-26T10:00:00Z');
  const reason = 'slug_taken: CIN differs (U31909DL2005PLC139412 vs U85110DL2017PLC322623)';
  const out = findUndecidedIdentityHolds(
    [{ slug: 'rays-of-belief-ltd', companyName: 'Rays of Belief Limited', candidates: 'rays-of-belief-ltd', reason, at: '2026-09-26T04:00:00Z' }],
    [], now,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, reason);
});

test('(i) findUndecidedIdentityHolds PASSES a hold a human overrode afterwards, and a hold older than 2 days', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const holds = [
    { slug: 'a-ltd', companyName: 'A Ltd', at: '2026-09-23T04:00:00Z' },
    { slug: 'b-ltd', companyName: 'B Ltd', at: '2026-09-18T04:00:00Z' },
  ];
  const overrides = [{ slug: 'a-ltd', at: '2026-09-23T05:00:00Z' }];
  assert.equal(findUndecidedIdentityHolds(holds, overrides, now).length, 0);
  // An override BEFORE a newer hold does not clear the newer one.
  assert.equal(findUndecidedIdentityHolds([{ slug: 'a-ltd', at: '2026-09-23T06:00:00Z' }], overrides, now).length, 1);
});

test('(i) checkIpoTitleInName: the page-status slug suffix is anchored to a legal suffix (PR #910 MINOR-4)', () => {
  assert.equal(checkIpoTitleInName({ companyName: 'Om Metallogic P', slug: 'om-metallogic-p' }), null);
  assert.match(checkIpoTitleInName({ companyName: 'Rays of Belief Ltd.', slug: 'rays-of-belief-ltd-o' }), /page-status suffix/);
});

// ---- (i) mutation-proof: break each predicate, assert red, then restore ----

test('(i) MUTATION: matching disabled misses the Rays of Belief pair the real predicate catches', () => {
  const brokenFind = () => []; // simulate the predicate being gutted
  const before = findSameIpoTwoRows([RAYS_OF_BELIEF_A, RAYS_OF_BELIEF_B]);
  assert.ok(before.length > 0, 'RED-then-GREEN baseline: real predicate must catch it');
  const after = brokenFind();
  assert.equal(after.length, 0, 'mutation (matching disabled) reproduces the miss the owner corrected');
});

test('(i) MUTATION: dropping the slug rule from checkIpoTitleInName misses a clean-name/dirty-slug row the real predicate still catches', () => {
  const rowSlugOnly = { slug: 'h-r-hygiene-products-ltd-h-r-hygiene-products-ipo', companyName: 'H.R. Hygiene Products Ltd.' };
  assert.ok(checkIpoTitleInName(rowSlugOnly) !== null, 'real predicate catches it via the slug -ipo(-|$) rule');
  const mutatedNoSlugRule = (r) => {
    const violations = [];
    if (/\(\s*[^)]*\bipo\b[^)]*\)/i.test(r.companyName || '')) violations.push('x');
    if (/\bipo\b\s*$/i.test((r.companyName || '').trim())) violations.push('x');
    // slug rules intentionally dropped
    return violations.length ? 'flagged' : null;
  };
  assert.equal(mutatedNoSlugRule(rowSlugOnly), null, 'mutation (slug rules dropped) misses this clean-name/dirty-slug fixture');
});

// ---- s_settled_field_rewritten (OD-73 / OD-65 / OD-75, #908) -----------------------------
import {
  findSettledFieldRewrites, writerPriority, policyWriterOnFromEnv, comparable,
  SETTLED_FIELD_COLUMNS, settledCurrentValueSql,
} from '../lib/detection-floor-checks.mjs';

// The WRITER's ranking (review round 1, MAJOR-2): generated from getSourcePriority itself.
const WRITER_RANKING = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scraper', 'config', 'writer-source-ranking.json'), 'utf8')
);
const settledRow = (o) => ({ slug: 'x', segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'], updatedAt: '2026-09-23 03:15:19', ...o });
const kinds = (f) => f.map((x) => `${x.slug}:${x.kind}`);

test('s_settled_field_rewritten: flags the staging Adroit re-stamp (CHITTORGARH->CHITTORGARH, 126 -> 126) as IDENTICAL_RESTAMP', () => {
  const f = findSettledFieldRewrites([
    settledRow({ slug: 'adroit-industries-india-ltd', segment: 'SME', listingExchanges: ['NSE'], fieldName: 'priceRangeMin', source: 'CHITTORGARH', previousSource: 'CHITTORGARH', previousValue: '126', currentValue: '126' }),
    settledRow({ slug: 'adroit-industries-india-ltd', segment: 'SME', listingExchanges: ['NSE'], fieldName: 'openDate', source: 'CHITTORGARH', previousSource: 'CHITTORGARH', previousValue: '2026-09-23', currentValue: '2026-09-23' }),
  ], WRITER_RANKING, false);
  assert.deepEqual(f.map((x) => `${x.slug}:${x.fieldName}:${x.kind}`), [
    'adroit-industries-india-ltd:priceRangeMin:IDENTICAL_RESTAMP',
    'adroit-industries-india-ltd:openDate:IDENTICAL_RESTAMP',
  ]);
});

test('s_settled_field_rewritten: passes the Vivekanand higher-rank replacement (issue size BSE Rs 19.2 cr -> CHITTORGARH Rs 22.2 cr) under both flag states', () => {
  for (const on of [false, true]) {
    const f = findSettledFieldRewrites([
      settledRow({ slug: 'vivekanand-cotspin-ltd', segment: 'SME', listingExchanges: ['BSE'], fieldName: 'issueSize', source: 'CHITTORGARH', previousSource: 'BSE', previousValue: '192000000.00', currentValue: '222000000.00' }),
    ], WRITER_RANKING, on);
    assert.deepEqual(f, [], `ENABLE_POLICY_WRITER=${on}`);
  }
});

// Review round 1 MAJOR-2: the three false positives the manifest-ranked check raised, each a
// write the writer itself makes. Ranked by the writer, all three PASS.
test('s_settled_field_rewritten: PASSES the three reviewer false positives (writer ranking, flag off)', () => {
  const f = findSettledFieldRewrites([
    settledRow({ slug: 'doc-date-over-cg', fieldName: 'openDate', source: 'DRHP', previousSource: 'CHITTORGARH', previousValue: '2026-09-20', currentValue: '2026-09-22' }),
    settledRow({ slug: 'mc-date-over-cg', fieldName: 'openDate', source: 'MONEYCONTROL', previousSource: 'CHITTORGARH', previousValue: '2026-09-20', currentValue: '2026-09-22' }),
    settledRow({ slug: 'nse-size-over-bse', fieldName: 'issueSize', source: 'NSE', previousSource: 'BSE', previousValue: '100', currentValue: '120' }),
  ], WRITER_RANKING, false);
  assert.deepEqual(f, []);
});

test('s_settled_field_rewritten: the SAME row is judged by the slot flag — NSE over BSE issue size is a finding only with ENABLE_POLICY_WRITER on (NSE and BSE both unranked there)', () => {
  const row = settledRow({ slug: 'nse-size-over-bse', fieldName: 'issueSize', source: 'NSE', previousSource: 'BSE', previousValue: '100', currentValue: '120' });
  assert.equal(writerPriority(WRITER_RANKING, true, 'issueSize', 'MAINBOARD', 'BSE,NSE', 'NSE'), -1);
  assert.deepEqual(kinds(findSettledFieldRewrites([row], WRITER_RANKING, true)), ['nse-size-over-bse:EQUAL_RANK_REWRITE']);
  assert.deepEqual(findSettledFieldRewrites([row], WRITER_RANKING, false), []);
});

test('s_settled_field_rewritten: passes exchange postponements (incl. allotment) and a first write; flags identical re-stamps, a website moving its own date, lower/equal rank rewrites', () => {
  const f = findSettledFieldRewrites([
    settledRow({ slug: 'postponed', fieldName: 'openDate', source: 'NSE', previousSource: 'NSE', previousValue: '2026-09-24', currentValue: '2026-09-29' }),
    settledRow({ slug: 'allotment-postponed', fieldName: 'allotmentDate', source: 'BSE', previousSource: 'BSE', previousValue: '2026-09-26', currentValue: '2026-09-30' }),
    settledRow({ slug: 'first', fieldName: 'lotSize', source: 'BSE', previousSource: null, previousValue: null, currentValue: '120' }),
    settledRow({ slug: 'identical', fieldName: 'closeDate', source: 'NSE', previousSource: 'NSE', previousValue: '2026-09-25', currentValue: '2026-09-25' }),
    settledRow({ slug: 'site-moved-date', fieldName: 'closeDate', source: 'CHITTORGARH', previousSource: 'CHITTORGARH', previousValue: '2026-09-20', currentValue: '2026-09-22' }),
    settledRow({ slug: 'lower-lot', fieldName: 'lotSize', source: 'NSE', previousSource: 'BSE', previousValue: '100', currentValue: '120' }),
    settledRow({ slug: 'higher-lot', fieldName: 'lotSize', source: 'BSE', previousSource: 'NSE', previousValue: '100', currentValue: '120' }),
    settledRow({ slug: 'unranked-both', fieldName: 'priceRangeMin', source: 'CHITTORGARH', previousSource: 'INVESTORGAIN_GMP', previousValue: '100', currentValue: '101' }),
    settledRow({ slug: 'live-figure', fieldName: 'status', source: 'NSE', previousSource: 'NSE', previousValue: 'OPEN', currentValue: 'CLOSED' }),
  ], WRITER_RANKING, false);
  assert.deepEqual(kinds(f), [
    'identical:IDENTICAL_RESTAMP',
    'site-moved-date:SELF_CHANGE_REWRITE',
    'lower-lot:LOWER_RANK_REWRITE',
    'unranked-both:EQUAL_RANK_REWRITE',
  ]);
});

test('s_settled_field_rewritten: MINOR-5 — a stored plain date (real staging shape) and an ISO instant compare by IST day', () => {
  // Real staging previous_value, 2026-09-23: every date row is plain YYYY-MM-DD (224 of 224).
  assert.equal(comparable('2026-09-25'), '2026-09-25');
  // 18:30Z on the 19th is 00:00 IST on the 20th — slicing the first 10 chars would say the 19th.
  assert.equal(comparable('2026-09-19T18:30:00.000Z'), '2026-09-20');
  assert.equal(comparable('2026-09-20T05:00:00+05:30'), '2026-09-20');
  const f = findSettledFieldRewrites([
    settledRow({ slug: 'utc-instant-same-ist-day', fieldName: 'openDate', source: 'BSE', previousSource: 'NSE', previousValue: '2026-09-19T18:30:00.000Z', currentValue: '2026-09-20' }),
  ], WRITER_RANKING, false);
  assert.deepEqual(kinds(f), ['utc-instant-same-ist-day:IDENTICAL_RESTAMP']);
});

test('s_settled_field_rewritten: policyWriterOnFromEnv mirrors slotAwareFlagDefault (unset -> DEPLOY_SLOT, explicit truthy, fail-closed)', () => {
  assert.equal(policyWriterOnFromEnv({}), false);
  assert.equal(policyWriterOnFromEnv({ DEPLOY_SLOT: 'staging' }), true);
  assert.equal(policyWriterOnFromEnv({ DEPLOY_SLOT: 'staging', ENABLE_POLICY_WRITER: 'false' }), false);
  assert.equal(policyWriterOnFromEnv({ ENABLE_POLICY_WRITER: 'ON' }), true);
  assert.equal(policyWriterOnFromEnv({ DEPLOY_SLOT: 'staging', ENABLE_POLICY_WRITER: '' }), false);
  assert.equal(policyWriterOnFromEnv({ ENABLE_POLICY_WRITER: 'maybe' }), false);
});

test('s_settled_field_rewritten: the SQL reads a stored column for every field the writer snapshot settles', () => {
  assert.deepEqual(Object.keys(SETTLED_FIELD_COLUMNS).sort(), [...WRITER_RANKING.fields].sort());
  const sql = settledCurrentValueSql();
  for (const f of WRITER_RANKING.fields) assert.match(sql, new RegExp(`WHEN '${f}' THEN i\\.[a-z_]+::text`));
});

// ---- #717 / OD-76: closed-IPO job recorded DONE without a walk ----------------
// Real staging shape, read-only 2026-09-23: Advit Jewels Ltd. DONE, 0 plan rows,
// 0 rows walked (one of the ten the job wrote DONE that night).
test('(OD-76) findClosedIpoDoneWithoutWalk FLAGS a DONE row whose IPO has 0 plan rows', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: '437ed611', companyName: 'Advit Jewels Ltd.', outcome: 'DONE', planRows: 0, walkedRows: 0 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].companyName, 'Advit Jewels Ltd.');
});

test('(OD-76) findClosedIpoDoneWithoutWalk FLAGS a DONE row whose plan exists but no row was ever asked', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: 'x', companyName: 'Planned Never Walked Ltd.', outcome: 'DONE', planRows: 189, walkedRows: 0, unsettledRows: 189 },
  ]);
  assert.equal(out.length, 1);
});

test('(OD-73) findClosedIpoDoneWithoutWalk PASSES a never-asked DONE whose EVERY plan row is settled', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: 's', companyName: 'All Settled Ltd.', outcome: 'DONE', planRows: 40, walkedRows: 0, unsettledRows: 0 },
    { ipoId: 't', companyName: 'String Settled Ltd.', outcome: 'DONE', planRows: '40', walkedRows: '0', unsettledRows: '0' },
  ]);
  assert.equal(out.length, 0);
});

// OD-79 (review round 3 probe): walked 5 fields, 3 answered, 37 rows still open, recorded DONE.
test('(OD-79) findClosedIpoDoneWithoutWalk FLAGS a WALKED DONE row that still has an unsettled plan row', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: 'p', companyName: 'Probe Walked Ltd.', outcome: 'DONE', planRows: 40, walkedRows: 5, unsettledRows: 37 },
    { ipoId: 'q', companyName: 'String Probe Ltd.', outcome: 'DONE', planRows: '40', walkedRows: '5', unsettledRows: '1' },
  ]);
  assert.deepEqual(out.map((r) => r.ipoId), ['p', 'q']);
});

test('(OD-76) findClosedIpoDoneWithoutWalk PASSES a genuinely walked DONE, and any PARTIAL/FAILED', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: 'a', companyName: 'Walked Ltd.', outcome: 'DONE', planRows: 189, walkedRows: 189, unsettledRows: 0 },
    { ipoId: 'b', companyName: 'Reopened Ltd.', outcome: 'PARTIAL', planRows: 0, walkedRows: 0 },
    { ipoId: 'c', companyName: 'No Plan Ltd.', outcome: 'FAILED', planRows: 0, walkedRows: 0 },
  ]);
  assert.deepEqual(out, []);
});

test('(OD-76) findClosedIpoDoneWithoutWalk reads numbers that arrive as strings from pg', () => {
  const out = findClosedIpoDoneWithoutWalk([
    { ipoId: 'd', companyName: 'String Ltd.', outcome: 'DONE', planRows: '0', walkedRows: '0' },
    { ipoId: 'e', companyName: 'String Walked Ltd.', outcome: 'DONE', planRows: '4', walkedRows: '4', unsettledRows: '0' },
  ]);
  assert.deepEqual(out.map((r) => r.ipoId), ['d']);
});

test('(OD-76) the audit query counts walked rows by last_attempt_at and reads only DONE rows', () => {
  const src = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function checkClosedIpoDoneWithoutWalk'), src.indexOf('// ---- (i): identity'));
  assert.match(body, /last_attempt_at IS NOT NULL/);
  assert.match(body, /NOT IN \('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED'\)/);
  assert.match(body, /WHERE r\.outcome = 'DONE'/);
  assert.match(body, /record\('closed_ipo_done_without_walk'/);
});

// ---- i_source_key_conflict (OD-85, PR #945 Tier A review MEDIUM-1 + LOW) ----------------------
{
  const NOW = new Date('2026-09-24T00:00:00Z');
  const key = (o) => ({ slug: 'dhanwel-hybrid-seeds-ltd', ipoId: 'ipo-1', source: 'BSE', keyType: 'BSE_IPO_NO', state: 'ACTIVE', changedAt: '2026-09-20T00:00:00Z', ...o });

  test('(i_source_key_conflict) FAILS on a planted two-ACTIVE-keys-of-one-source row (Dhanwel 7794 + 7900 after a merge with no supersede)', () => {
    const r = evaluateSourceKeyConflicts({ keys: [key({ value: '7794' }), key({ value: '7900' })], now: NOW });
    assert.equal(r.status, 'FAIL');
    assert.equal(r.doubleActive.length, 1);
    assert.match(r.detail, /dhanwel-hybrid-seeds-ltd two ACTIVE BSE BSE_IPO_NO \(7794,7900\)/);
  });

  test('(i_source_key_conflict) FAILS on a key DISPUTED by the ISIN re-check inside 30 days (Himalaya values)', () => {
    const r = evaluateSourceKeyConflicts({ now: NOW, keys: [key({ slug: 'himalayan-solar-ltd', ipoId: 'ipo-2', source: 'CHITTORGARH', keyType: 'CG_PAGE_ID',
      value: '2716', state: 'DISPUTED', reason: 'key_contradiction: ISIN differs (INE1OTR01013 vs INE1B7I01014)', changedAt: '2026-09-23T10:00:00Z' })] });
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /himalayan-solar-ltd DISPUTED CHITTORGARH CG_PAGE_ID 2716/);
  });

  test('(i_source_key_conflict) PASSES clean data: one ACTIVE key per source per row, keys of different sources/rows, an old dispute', () => {
    const r = evaluateSourceKeyConflicts({ now: NOW, keys: [
      key({ value: '7900' }),
      key({ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', value: '2790' }),
      key({ ipoId: 'ipo-3', slug: 'other-ltd', value: '7901' }),
      key({ ipoId: 'ipo-4', slug: 'old-dispute-ltd', value: '7000', state: 'DISPUTED', changedAt: '2026-08-01T00:00:00Z' }),
    ] });
    assert.equal(r.status, 'PASS');
    assert.equal(r.detail, '0 double-ACTIVE, 0 DISPUTED in 30 days');
  });

  test('(i_source_key_conflict) a missing table is UNVERIFIABLE, never PASS; an unreadable one too', () => {
    assert.equal(evaluateSourceKeyConflicts({ tableMissing: true }).status, 'UNVERIFIABLE');
    assert.equal(evaluateSourceKeyConflicts({ readError: 'permission denied for table ipo_source_keys' }).status, 'UNVERIFIABLE');
  });

  // PR #945 Tier A round-3: a DB that has simply never run migration 0053 is not "blind" -- it is
  // "this class cannot exist here yet". Only a table missing AFTER 0053 is confirmed applied is a
  // genuine detection gap.
  test('(i_source_key_conflict) missing table + migration 0053 confirmed NOT applied -> PASS, not-applicable (never a nightly BLIND)', () => {
    const r = evaluateSourceKeyConflicts({ tableMissing: true, migration0053Applied: false });
    assert.equal(r.status, 'PASS');
    assert.match(r.detail, /not applicable.*migration 0053/);
  });

  test('(i_source_key_conflict) missing table + migration 0053 confirmed applied -> UNVERIFIABLE (a real detection gap)', () => {
    const r = evaluateSourceKeyConflicts({ tableMissing: true, migration0053Applied: true });
    assert.equal(r.status, 'UNVERIFIABLE');
  });

  test('(i_source_key_conflict) missing table + migration state unknown (read error) -> UNVERIFIABLE, never guessed as not-applicable', () => {
    const r = evaluateSourceKeyConflicts({ tableMissing: true, migration0053Applied: null });
    assert.equal(r.status, 'UNVERIFIABLE');
  });

  // Mutation guard: a version of the fix that ignores migration0053Applied and always reports
  // UNVERIFIABLE on a missing table must fail case (a) above (red on the not-applicable PASS).
}

// ---- PULL-NOBLANK (item 10, OD-42): scripts/lib/pull-noblank-checks.mjs -----------------------

test('(pull_noblank) toSnake converts camelCase to snake_case', () => {
  assert.equal(toSnake('issueSize'), 'issue_size');
  assert.equal(toSnake('priceRangeMax'), 'price_range_max');
  assert.equal(toSnake('slug'), 'slug');
});

test('(pull_noblank) resolveColumn matches the field_name as-is first', () => {
  const columns = new Set(['issuesize', 'issue_size']);
  assert.equal(resolveColumn(columns, 'issuesize'), 'issuesize');
});

test('(pull_noblank) resolveColumn falls back to the snake_case form', () => {
  const columns = new Set(['issue_size', 'id']);
  assert.equal(resolveColumn(columns, 'issueSize'), 'issue_size');
});

test('(pull_noblank) resolveColumn returns null (unresolvable) when neither form matches', () => {
  const columns = new Set(['id', 'slug']);
  assert.equal(resolveColumn(columns, 'gmpPercentage'), null);
});

test('(pull_noblank) isBlankCurrentValue treats NULL/undefined/"" as blank, never 0 or false', () => {
  assert.equal(isBlankCurrentValue(null), true);
  assert.equal(isBlankCurrentValue(undefined), true);
  assert.equal(isBlankCurrentValue(''), true);
  assert.equal(isBlankCurrentValue(0), false);
  assert.equal(isBlankCurrentValue(false), false);
  assert.equal(isBlankCurrentValue('126'), false);
});

test('(pull_noblank) hadPreviousValue requires a non-empty (after trim) string', () => {
  assert.equal(hadPreviousValue(null), false);
  assert.equal(hadPreviousValue(undefined), false);
  assert.equal(hadPreviousValue(''), false);
  assert.equal(hadPreviousValue('   '), false);
  assert.equal(hadPreviousValue('126'), true);
});

test('(pull_noblank) isSafeTableName accepts snake_case identifiers, rejects anything else', () => {
  assert.equal(isSafeTableName('ipo_details'), true);
  assert.equal(isSafeTableName('ipos'), true);
  assert.equal(isSafeTableName('ipos; DROP TABLE ipos'), false);
  assert.equal(isSafeTableName('Ipos'), false);
  assert.equal(isSafeTableName(''), false);
});

// Mutation guard: a check that trusted a re-blanked row (previousValue had a value, current
// value is blank) as healthy would pass silently. Assert the exact planted-vs-clean shape the
// real checkS_pullNoblank query relies on these three predicates for.
test('(pull_noblank) planted re-blanked row is caught: hadPreviousValue true + isBlankCurrentValue true', () => {
  const row = { previousValue: '95-99', currentValue: null };
  assert.equal(hadPreviousValue(row.previousValue) && isBlankCurrentValue(row.currentValue), true);
});

test('(pull_noblank) a clean row (value carried forward) is not flagged', () => {
  const row = { previousValue: '95-99', currentValue: '95-99' };
  assert.equal(hadPreviousValue(row.previousValue) && isBlankCurrentValue(row.currentValue), false);
});

// ---- evaluatePullNoblank: drives the real query path, not just the pure helpers (Tier B
// reviewer finding 1, MAJOR) --------------------------------------------------------------

function fakeQ(handlers) {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    for (const h of handlers) {
      if (h.match.test(sql)) return h.rows(params);
    }
    throw new Error(`fakeQ: no handler for SQL: ${sql}`);
  };
  q.calls = calls;
  return q;
}

test('(pull_noblank) evaluatePullNoblank: a planted blanked row is an offender (red case)', async () => {
  const rows = [{ ipoId: 'ipo-1', slug: 'acme', tableName: 'ipo_details', fieldName: 'priceRangeMax', previousValue: '99' }];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'price_range_max' }] },
    { match: /SELECT "price_range_max"/, rows: () => [{ v: null }] },
  ]);
  const { checked, offenders, unresolvable } = await evaluatePullNoblank(rows, q);
  assert.equal(checked.length, 1);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].field, 'priceRangeMax');
  assert.equal(unresolvable.length, 0);
});

test('(pull_noblank) evaluatePullNoblank: same row with a carried-forward current value passes (green case)', async () => {
  const rows = [{ ipoId: 'ipo-1', slug: 'acme', tableName: 'ipo_details', fieldName: 'priceRangeMax', previousValue: '99' }];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'price_range_max' }] },
    { match: /SELECT "price_range_max"/, rows: () => [{ v: '99' }] },
  ]);
  const { offenders } = await evaluatePullNoblank(rows, q);
  assert.equal(offenders.length, 0);
});

test('(pull_noblank) evaluatePullNoblank: an unknown field is unresolvable, never silently skipped', async () => {
  const rows = [{ ipoId: 'ipo-1', slug: 'acme', tableName: 'ipo_details', fieldName: 'gmpPercentage', previousValue: '5' }];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'price_range_max' }] },
  ]);
  const { offenders, unresolvable } = await evaluatePullNoblank(rows, q);
  assert.equal(offenders.length, 0);
  assert.equal(unresolvable.length, 1);
  assert.match(unresolvable[0], /ipo_details\.gmpPercentage/);
});

test('(pull_noblank) evaluatePullNoblank: two rows for the same ipo_id (e.g. anchor_investors) is ambiguous unresolvable, never guessed', async () => {
  const rows = [{ ipoId: 'ipo-1', slug: 'acme', tableName: 'anchor_investors', fieldName: 'investorName', previousValue: 'ABC Fund' }];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'investor_name' }] },
    { match: /SELECT "investor_name"/, rows: () => [{ v: null }, { v: 'ABC Fund' }] },
  ]);
  const { offenders, unresolvable } = await evaluatePullNoblank(rows, q);
  assert.equal(offenders.length, 0);
  assert.equal(unresolvable.length, 1);
  assert.match(unresolvable[0], /ambiguous/);
});

test('(pull_noblank) evaluatePullNoblank: ipos uses idCol "id", other tables use "ipo_id"', async () => {
  const rows = [
    { ipoId: 'ipo-1', slug: 'acme', tableName: 'ipos', fieldName: 'slug', previousValue: 'acme-old' },
    { ipoId: 'ipo-1', slug: 'acme', tableName: 'ipo_details', fieldName: 'priceRangeMax', previousValue: '99' },
  ];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'slug' }, { column_name: 'price_range_max' }] },
    { match: /SELECT/, rows: () => [{ v: 'acme' }] },
  ]);
  await evaluatePullNoblank(rows, q);
  const iposRead = q.calls.find((c) => /FROM ipos WHERE/.test(c.sql));
  const detailsRead = q.calls.find((c) => /FROM ipo_details WHERE/.test(c.sql));
  assert.match(iposRead.sql, /WHERE id = \$1/);
  assert.match(detailsRead.sql, /WHERE ipo_id = \$1/);
});

test('(pull_noblank) evaluatePullNoblank information_schema query scopes to table_schema = public', async () => {
  const rows = [{ ipoId: 'ipo-1', slug: 'acme', tableName: 'ipo_details', fieldName: 'priceRangeMax', previousValue: '99' }];
  const q = fakeQ([
    { match: /information_schema\.columns/, rows: () => [{ column_name: 'price_range_max' }] },
    { match: /SELECT "price_range_max"/, rows: () => [{ v: '99' }] },
  ]);
  await evaluatePullNoblank(rows, q);
  const schemaCall = q.calls.find((c) => /information_schema\.columns/.test(c.sql));
  assert.match(schemaCall.sql, /table_schema = 'public'/);
});

// Mutation guard: invert isBlankCurrentValue's null check to confirm case (a) above actually
// goes red when the guard is broken, then restore the original (git diff must be exact after).
test('(pull_noblank) mutation guard: an inverted isBlankCurrentValue would make the red case pass -- confirms the test can fail', () => {
  const brokenIsBlank = (v) => !(v === null || v === undefined || v === '');
  assert.equal(brokenIsBlank(null), false, 'inverted predicate would wrongly call null "not blank", masking the offender');
});

// ---- c_upcoming_source_drift (#349) ----------------------------------------
// Fixtures captured 2026-09-26 from three LIVE chittorgarh.com IPO detail
// pages (scripts/tests/fixtures/chittorgarh-issue-size/), each carrying real
// "Total Issue Size" rows: Nityas Gems & Jewellery 108 Cr, Vishal Nirmiti
// 178 Cr, SRIT India 218 Cr.
const CHITTORGARH_ISSUE_SIZE_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'chittorgarh-issue-size');
function readCgFixture(name) {
  return readFileSync(join(CHITTORGARH_ISSUE_SIZE_FIXTURES_DIR, name), 'utf8');
}

test('(upcoming_source_drift) parses the real Nityas Gems & Jewellery detail page (108 Cr)', () => {
  const parsed = parseChittorgarhIssueSizeDetail(readCgFixture('nityas-gems-jewellery-detail.html'));
  assert.ok(parsed);
  assert.equal(parsed.unit, 'Cr');
  assert.equal(parsed.amountRupees, 108 * 1_00_00_000);
  assert.equal(parsed.shares, 1_44_56_000);
});

test('(upcoming_source_drift) parses the real Vishal Nirmiti detail page (178 Cr)', () => {
  const parsed = parseChittorgarhIssueSizeDetail(readCgFixture('vishal-nirmiti-detail.html'));
  assert.ok(parsed);
  assert.equal(parsed.amountRupees, 178 * 1_00_00_000);
});

test('(upcoming_source_drift) parses the real SRIT India detail page (218 Cr)', () => {
  const parsed = parseChittorgarhIssueSizeDetail(readCgFixture('srit-india-detail.html'));
  assert.ok(parsed);
  assert.equal(parsed.amountRupees, 218 * 1_00_00_000);
});

test('(upcoming_source_drift) returns null (UNVERIFIABLE, never a silent zero) on a page missing the Total Issue Size row', () => {
  assert.equal(parseChittorgarhIssueSizeDetail('<html><body>not an IPO page</body></html>'), null);
  assert.equal(parseChittorgarhIssueSizeDetail(''), null);
});

function ipoRow({ id, companyName, slug, issueSize, issueSizeSource = 'CHITTORGARH', issueSizeUpdatedAt = '2026-09-20T00:00:00Z' }) {
  return { id, companyName, slug, normalizedKey: normalizeCompanyKey(companyName), issueSize, issueSizeSource, issueSizeUpdatedAt };
}

test('(upcoming_source_drift) FAILS on the Karamtara shape: stored 1,750 Cr vs page 875 Cr, names the slug', () => {
  const ipoRows = [ipoRow({ id: 'ipo-karamtara', companyName: 'Karamtara Engineering Ltd', slug: 'karamtara-engineering-ltd', issueSize: 17_500_000_000 })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Karamtara Engineering Ltd'), { ok: true, parsed: { amountRupees: 875 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.examined, 1);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0].message, /"karamtara-engineering-ltd"/);
  assert.equal(result.violations[0].provenanceSource, 'CHITTORGARH');
});

test('(upcoming_source_drift) PASSES when stored equals the Chittorgarh page figure exactly', () => {
  const ipoRows = [ipoRow({ id: 'ipo-srit', companyName: 'SRIT India Ltd', slug: 'srit-india-ltd', issueSize: 218 * 1_00_00_000 })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('SRIT India Ltd'), { ok: true, parsed: { amountRupees: 218 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.violations.length, 0);
  assert.equal(result.examined, 1);
});

test('(upcoming_source_drift) PASSES within the 2-decimal-crore rounding tolerance (Rs 1 lakh)', () => {
  const ipoRows = [ipoRow({ id: 'ipo-round', companyName: 'Rounding Co Ltd', slug: 'rounding-co-ltd', issueSize: 108 * 1_00_00_000 + ROUNDING_TOLERANCE_RUPEES })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Rounding Co Ltd'), { ok: true, parsed: { amountRupees: 108 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.violations.length, 0, 'a Rs 1 lakh diff is within the 2-decimal-crore print tolerance');
});

test('(upcoming_source_drift) FAILS just beyond the rounding tolerance', () => {
  const ipoRows = [ipoRow({ id: 'ipo-round2', companyName: 'Rounding Co Two Ltd', slug: 'rounding-co-two-ltd', issueSize: 108 * 1_00_00_000 + ROUNDING_TOLERANCE_RUPEES + 1 })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Rounding Co Two Ltd'), { ok: true, parsed: { amountRupees: 108 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.violations.length, 1);
});

test('(upcoming_source_drift) an unreachable/unparseable page is EXCLUDED, never silently passed', () => {
  const ipoRows = [ipoRow({ id: 'ipo-x', companyName: 'Unreachable Co Ltd', slug: 'unreachable-co-ltd', issueSize: 500_00_00_000 })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Unreachable Co Ltd'), { ok: false, reason: 'fetch failed' }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.violations.length, 0);
  assert.equal(result.unreachable, 1);
  assert.equal(result.examined, 1);
  assert.equal(result.consideredForVerdict, 0);
  assert.equal(result.allUnreachable, true, 'the only examined row was unreachable -> caller must report UNVERIFIABLE, not PASS');
});

test('(upcoming_source_drift) allUnreachable is false when at least one page WAS readable', () => {
  const ipoRows = [
    ipoRow({ id: 'ipo-x', companyName: 'Unreachable Co Ltd', slug: 'unreachable-co-ltd', issueSize: 500_00_00_000 }),
    ipoRow({ id: 'ipo-srit', companyName: 'SRIT India Ltd', slug: 'srit-india-ltd', issueSize: 218 * 1_00_00_000 }),
  ];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Unreachable Co Ltd'), { ok: false, reason: 'fetch failed' }],
    [normalizeCompanyKey('SRIT India Ltd'), { ok: true, parsed: { amountRupees: 218 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.allUnreachable, false);
  assert.equal(result.consideredForVerdict, 1);
});

test('(upcoming_source_drift) a NULL stored issue_size is excluded (a different check\'s population)', () => {
  const ipoRows = [ipoRow({ id: 'ipo-null', companyName: 'Null Co Ltd', slug: 'null-co-ltd', issueSize: null })];
  const pageResultsByKey = new Map([
    [normalizeCompanyKey('Null Co Ltd'), { ok: true, parsed: { amountRupees: 108 * 1_00_00_000, unit: 'Cr' } }],
  ]);
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey });
  assert.equal(result.violations.length, 0);
});

test('(upcoming_source_drift) an IPO not matched on the Chittorgarh dashboard at all is outside this check\'s reach, not a violation', () => {
  const ipoRows = [ipoRow({ id: 'ipo-unmatched', companyName: 'Unmatched Co Ltd', slug: 'unmatched-co-ltd', issueSize: 500_00_00_000 })];
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey: new Map() });
  assert.equal(result.examined, 0);
  assert.equal(result.violations.length, 0);
  assert.equal(result.allUnreachable, false);
});

// Round-1 review finding (#1128): live IPOs exist but ZERO matched the
// dashboard -> examined=0, allUnreachable=false (needs examined>0) -> old
// caller fell through to a false PASS on zero evidence. Must be UNVERIFIABLE.
test('(upcoming_source_drift) (a) live IPOs exist but NONE matched the dashboard -> noneMatched=true, names the unmatched slugs', () => {
  const ipoRows = [
    ipoRow({ id: 'ipo-a', companyName: 'Alpha Co Ltd', slug: 'alpha-co-ltd', issueSize: 100_00_00_000 }),
    ipoRow({ id: 'ipo-b', companyName: 'Beta Co Ltd', slug: 'beta-co-ltd', issueSize: 200_00_00_000 }),
  ];
  const result = evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey: new Map() });
  assert.equal(result.totalLiveIpos, 2);
  assert.equal(result.examined, 0);
  assert.equal(result.noneMatched, true, 'a live population with 0 matches must be flagged distinctly from "0 live IPOs" or "0 violations"');
  assert.deepEqual(result.unmatchedSlugs.sort(), ['alpha-co-ltd', 'beta-co-ltd']);
});

// (b) genuinely zero live IPOs -> not applicable, PASS, never confused with (a).
test('(upcoming_source_drift) (b) zero live IPOs -> noneMatched=false (genuinely not applicable)', () => {
  const result = evaluateUpcomingSourceDrift({ ipoRows: [], pageResultsByKey: new Map() });
  assert.equal(result.totalLiveIpos, 0);
  assert.equal(result.noneMatched, false, 'an empty live-IPO population is "not applicable", not "BLIND" — must not trip the (a) branch');
});

// Mutation guard: dropping `totalLiveIpos > 0` from noneMatched would make
// case (b) (0 live IPOs) wrongly report noneMatched=true too.
test('(upcoming_source_drift) mutation guard: noneMatched must require totalLiveIpos > 0', () => {
  const brokenNoneMatched = (totalLiveIpos, examined) => examined === 0; // missing the totalLiveIpos>0 guard
  assert.equal(brokenNoneMatched(0, 0), true, 'without the guard, 0 live IPOs would be wrongly classified as (a) noneMatched instead of (b) not-applicable');
});

// Mutation guard: an inverted tolerance comparison would make the red Karamtara case pass.
test('(upcoming_source_drift) mutation guard: inverting the diff>tolerance check would mask the Karamtara defect', () => {
  const diff = Math.abs(17_500_000_000 - 875 * 1_00_00_000);
  const brokenPredicate = (d, tol) => !(d > tol);
  assert.equal(brokenPredicate(diff, ROUNDING_TOLERANCE_RUPEES), false, 'inverted predicate would wrongly call the Karamtara-shaped drift "within tolerance"');
});

// Item 10 zip_member_rows: its tests live in their own file; imported here so
// they run in the pr-gate detection-floor step, which names only this file.
import './zip-member-rows.test.mjs';
