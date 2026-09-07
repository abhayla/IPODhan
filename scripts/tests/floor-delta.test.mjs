// Mutation-proof self-tests for scripts/ops/floor-delta.mjs (T-497).
//
// Fixtures are REAL: scripts/ops/fixtures/floor-today.txt is the actual
// staging detection-floor run captured 2026-09-07T19:00 IST
// (C:\Users\itsab\AppData\Local\Temp\claude\...\scratchpad\floor-staging-1900.log,
// copied verbatim — Class item 4/defect-fix-contract.md). floor-yesterday.txt
// is a trimmed copy of the same real run with:
//   - the entire `g_repeated_warn` [FAIL] line removed -> that check id is
//     absent from "yesterday" and present in "today" => must report as NEW.
//   - the "PIYUSH LIMITED" entity dropped from the still-present
//     `c_issue_size_floor` [FAIL] line -> that entity is absent from
//     "yesterday" and present in "today" for a check that fails BOTH nights
//     => must report as a NEW entity for that check (SAME id, not NEW id).
//
// Run: node --test scripts/tests/floor-delta.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseFloorOutput, diffFloor, formatReport } from '../ops/floor-delta.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TODAY_PATH = join(REPO_ROOT, 'scripts', 'ops', 'fixtures', 'floor-today.txt');
const YESTERDAY_PATH = join(REPO_ROOT, 'scripts', 'ops', 'fixtures', 'floor-yesterday.txt');

const todayText = readFileSync(TODAY_PATH, 'utf-8');
const yesterdayText = readFileSync(YESTERDAY_PATH, 'utf-8');

test('parseFloorOutput resolves real [FAIL]/[PASS] lines to check ids with entities', () => {
  const checks = parseFloorOutput(todayText);
  assert.equal(checks.get('c_issue_size_floor').status, 'FAIL');
  assert.ok(checks.get('c_issue_size_floor').entities.has('NIRBHAY COLOURS INDIA LTD'));
  assert.equal(checks.get('c_issue_size_consistency').status, 'PASS');
  // UNVERIFIABLE lines (h_pm2_env_tz etc.) are neither FAIL nor PASS and MUST
  // be ignored, never silently counted as passing.
  assert.equal(checks.has('h_pm2_env_tz'), false);
});

test('diffFloor: red before the fix — a naive equality diff on line text would call everything NEW', () => {
  // This is the failing-test-first proof: if floor-delta just diffed raw
  // line TEXT (the naive, wrong approach), reordering or a single changed
  // digit anywhere would make the whole check look "NEW" even when its id
  // and entity set are identical. Assert the real function is id/entity
  // -keyed, not line-keyed, by checking the SAME ids include ones whose full
  // line text differs only in the removed entity (c_issue_size_floor).
  const today = parseFloorOutput(todayText);
  const yesterday = parseFloorOutput(yesterdayText);
  const { sameIds } = diffFloor(today, yesterday);
  assert.ok(sameIds.includes('c_issue_size_floor'), 'must classify by check id, not by exact line text');
});

test('diffFloor: g_repeated_warn (removed from yesterday) is NEW today', () => {
  const today = parseFloorOutput(todayText);
  const yesterday = parseFloorOutput(yesterdayText);
  const { newIds, goneIds } = diffFloor(today, yesterday);
  assert.deepEqual(newIds, ['g_repeated_warn']);
  assert.deepEqual(goneIds, []);
});

test('diffFloor: "PIYUSH LIMITED" is a NEW entity on the still-failing c_issue_size_floor check', () => {
  const today = parseFloorOutput(todayText);
  const yesterday = parseFloorOutput(yesterdayText);
  const { newEntitiesByCheck } = diffFloor(today, yesterday);
  assert.deepEqual(newEntitiesByCheck.get('c_issue_size_floor'), ['PIYUSH LIMITED']);
});

test('diffFloor: unrelated still-failing checks with unchanged entities produce no NEW entities', () => {
  const today = parseFloorOutput(todayText);
  const yesterday = parseFloorOutput(yesterdayText);
  const { newEntitiesByCheck } = diffFloor(today, yesterday);
  // d_lot_band_window is untouched between the two fixtures — must not
  // false-positive just because SOME check in the run has a new entity.
  assert.equal(newEntitiesByCheck.has('d_lot_band_window'), false);
  assert.equal(newEntitiesByCheck.has('d_corporate_action_shape'), false);
});

test('formatReport prints NEW/GONE/SAME and the escalate verdict when something is NEW', () => {
  const today = parseFloorOutput(todayText);
  const yesterday = parseFloorOutput(yesterdayText);
  const delta = diffFloor(today, yesterday);
  const report = formatReport(delta);
  assert.match(report, /NEW \(1\): g_repeated_warn/);
  assert.match(report, /GONE \(0\)/);
  assert.match(report, /NEW ENTITIES.*c_issue_size_floor/s);
  assert.match(report, /VERDICT: NEW FINDINGS/);
});

test('formatReport reports "no new findings" when a night is diffed against itself', () => {
  const today = parseFloorOutput(todayText);
  const delta = diffFloor(today, today);
  assert.deepEqual(delta.newIds, []);
  assert.equal(delta.newEntitiesByCheck.size, 0);
  assert.match(formatReport(delta), /VERDICT: no new findings/);
});

test('CLI: exits 3 and prints NEW on the real trimmed-vs-full fixture pair (no --notify => no network)', () => {
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'ops', 'floor-delta.mjs'), TODAY_PATH, YESTERDAY_PATH], { encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout;
    status = err.status;
  }
  assert.equal(status, 3);
  assert.match(stdout, /NEW \(1\): g_repeated_warn/);
});

test('CLI: exits 0 when today is diffed against itself (no NEW)', () => {
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'ops', 'floor-delta.mjs'), TODAY_PATH, TODAY_PATH], { encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout;
    status = err.status;
  }
  assert.equal(status, 0);
  assert.match(stdout, /VERDICT: no new findings/);
});

test('CLI: --notify skips cleanly with no NOTIFIER_URL/NOTIFIER_KEY set (never throws)', () => {
  const env = { ...process.env };
  delete env.NOTIFIER_URL;
  delete env.NOTIFIER_KEY;
  delete env.NOTIFIER_KEY_IPODHAN;
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'ops', 'floor-delta.mjs'), TODAY_PATH, YESTERDAY_PATH, '--notify'], { encoding: 'utf-8', env });
  } catch (err) {
    stdout = err.stdout;
    status = err.status;
  }
  assert.equal(status, 3);
  assert.match(stdout, /NOTIFY-SKIP/);
});

test('CLI: usage error (missing args) exits 2', () => {
  let status = 0;
  try {
    execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'ops', 'floor-delta.mjs')], { encoding: 'utf-8' });
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 2);
});
