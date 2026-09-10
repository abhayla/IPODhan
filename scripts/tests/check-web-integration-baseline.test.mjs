// Self-test for scripts/check-web-integration-baseline.mjs (item 1 slice s3d).
//
// Imports the ACTUAL exported functions from the script under test — never a
// re-implementation — so a weakened guard turns this red. Fixtures (both the
// vitest-JSON-report fixtures and the baseline file used per-test) are
// written under os.tmpdir(), never into the checkout, per this task's brief.
//
// Run: node --test scripts/tests/check-web-integration-baseline.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  extractFailingFiles,
  normalizeFileName,
  diffAgainstBaseline,
} from '../check-web-integration-baseline.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'check-web-integration-baseline.mjs');

const tmpDirs = [];
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'web-integration-baseline-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

function vitestReport(entries) {
  // Jest-compatible shape vitest's --reporter=json emits.
  return {
    success: entries.every((e) => e.status !== 'failed'),
    testResults: entries.map((e) => ({
      name: e.name,
      status: e.status,
      message: e.status === 'failed' ? 'AssertionError' : '',
      assertionResults: [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Unit-level: extractFailingFiles / normalizeFileName / diffAgainstBaseline
// ---------------------------------------------------------------------------

test('extractFailingFiles: returns only failing file names, sorted', () => {
  const report = vitestReport([
    { name: '/repo/web/tests/integration/b.integration.test.ts', status: 'failed' },
    { name: '/repo/web/tests/integration/a.integration.test.ts', status: 'passed' },
    { name: '/repo/web/tests/integration/c.integration.test.ts', status: 'failed' },
  ]);
  const failing = extractFailingFiles(report, '/repo');
  assert.deepEqual(failing, [
    'web/tests/integration/b.integration.test.ts',
    'web/tests/integration/c.integration.test.ts',
  ]);
});

test('extractFailingFiles: throws on a malformed report (no testResults array)', () => {
  assert.throws(() => extractFailingFiles({ notATestResultsArray: true }), /testResults/);
});

test('normalizeFileName: relativizes an absolute path under the given root', () => {
  assert.equal(
    normalizeFileName('/repo/web/tests/integration/foo.integration.test.ts', '/repo'),
    'web/tests/integration/foo.integration.test.ts'
  );
});

test('normalizeFileName: falls back to the web/tests/integration/ anchor for a foreign root', () => {
  assert.equal(
    normalizeFileName(
      '/home/runner/work/IPODhan/IPODhan/web/tests/integration/foo.integration.test.ts',
      '/repo'
    ),
    'web/tests/integration/foo.integration.test.ts'
  );
});

test('diffAgainstBaseline: exact match against the baseline has no new failures and no stale entries', () => {
  const result = diffAgainstBaseline(
    ['web/tests/integration/a.integration.test.ts', 'web/tests/integration/b.integration.test.ts'],
    ['web/tests/integration/a.integration.test.ts', 'web/tests/integration/b.integration.test.ts']
  );
  assert.deepEqual(result.newFailures, []);
  assert.deepEqual(result.staleEntries, []);
});

test('diffAgainstBaseline: an empty baseline with no live failures has no new failures and no stale entries', () => {
  const result = diffAgainstBaseline([], []);
  assert.deepEqual(result.newFailures, []);
  assert.deepEqual(result.staleEntries, []);
});

test('diffAgainstBaseline: a failing file not in the baseline is a NEW failure', () => {
  const result = diffAgainstBaseline(
    ['web/tests/integration/a.integration.test.ts', 'web/tests/integration/smuggled.integration.test.ts'],
    ['web/tests/integration/a.integration.test.ts']
  );
  assert.deepEqual(result.newFailures, ['web/tests/integration/smuggled.integration.test.ts']);
  assert.deepEqual(result.staleEntries, []);
});

test('diffAgainstBaseline: a baseline entry that is no longer failing is STALE', () => {
  const result = diffAgainstBaseline(
    ['web/tests/integration/a.integration.test.ts'],
    ['web/tests/integration/a.integration.test.ts', 'web/tests/integration/fixed.integration.test.ts']
  );
  assert.deepEqual(result.newFailures, []);
  assert.deepEqual(result.staleEntries, ['web/tests/integration/fixed.integration.test.ts']);
});

// ---------------------------------------------------------------------------
// CLI-level: run the real script as a subprocess against fixture files, the
// mandatory proof this task's brief requires — a constructed fixture,
// pasted, for each of the two failure modes. --baseline= points at a tmp
// file so these tests never touch the real config/web-integration-baseline.json.
// ---------------------------------------------------------------------------

function runChecker(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

test('CLI: a NEW failing file not in the baseline exits 1 and names the file', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(
    baselinePath,
    JSON.stringify({ count: 1, files: ['web/tests/integration/known-broken.integration.test.ts'] }, null, 2)
  );
  const report = vitestReport([
    { name: `${dir}/web/tests/integration/known-broken.integration.test.ts`, status: 'failed' },
    { name: `${dir}/web/tests/integration/new-regression.integration.test.ts`, status: 'failed' },
  ]);
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /NEW: web\/tests\/integration\/new-regression\.integration\.test\.ts/);
});

test('CLI: a stale baseline entry (no longer failing) exits 1 and names the file', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        count: 2,
        files: [
          'web/tests/integration/still-broken.integration.test.ts',
          'web/tests/integration/now-fixed.integration.test.ts',
        ],
      },
      null,
      2
    )
  );
  const report = vitestReport([
    { name: `${dir}/web/tests/integration/still-broken.integration.test.ts`, status: 'failed' },
    { name: `${dir}/web/tests/integration/now-fixed.integration.test.ts`, status: 'passed' },
  ]);
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /STALE: web\/tests\/integration\/now-fixed\.integration\.test\.ts/);
});

test('CLI: an exact match against the baseline exits 0', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(
    baselinePath,
    JSON.stringify({ count: 1, files: ['web/tests/integration/known-broken.integration.test.ts'] }, null, 2)
  );
  const report = vitestReport([
    { name: `${dir}/web/tests/integration/known-broken.integration.test.ts`, status: 'failed' },
    { name: `${dir}/web/tests/integration/healthy.integration.test.ts`, status: 'passed' },
  ]);
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 0, `expected exit 0, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

test('CLI: an empty baseline with no live failures exits 0', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const report = vitestReport([
    { name: `${dir}/web/tests/integration/healthy-a.integration.test.ts`, status: 'passed' },
    { name: `${dir}/web/tests/integration/healthy-b.integration.test.ts`, status: 'passed' },
  ]);
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 0, `expected exit 0, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

test('CLI: --update regenerates the baseline from the report and exits 0', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        count: 2,
        files: [
          'web/tests/integration/a.integration.test.ts',
          'web/tests/integration/b.integration.test.ts',
        ],
      },
      null,
      2
    )
  );
  const report = vitestReport([{ name: `${dir}/web/tests/integration/a.integration.test.ts`, status: 'failed' }]);
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`, '--update']);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code}. stderr:
${result.stderr}`);

  const verify = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);
  assert.equal(verify.code, 0, `expected exit 0 after --update, got ${verify.code}. stderr:
${verify.stderr}`);
});

test('CLI: missing --report argument exits 1', () => {
  const result = runChecker([]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required --report/);
});

// ---------------------------------------------------------------------------
// Dead-on-arrival class (MINOR-8): every way vitest can die/misconfigure
// BEFORE producing a real report must fail closed with a reason, never pass
// silently and never crash with a raw stack. These are the cases that decide
// whether the gate can be bypassed by anything that kills vitest early.
// ---------------------------------------------------------------------------

test('CLI: report file missing exits 1 and names the path', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const missingReportPath = join(dir, 'does-not-exist.json');

  const result = runChecker([`--report=${missingReportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /report file not found/);
  assert.match(result.stderr, /does-not-exist\.json/);
});

test('CLI: empty report file exits 1 with a parse-failure reason', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, '');

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /could not parse report JSON/);
});

test('CLI: malformed JSON report exits 1 with a parse-failure reason', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, '{ "testResults": [ this is not json');

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /could not parse report JSON/);
});

test('CLI: valid JSON with no testResults key exits 1 with a reason, never a raw stack', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ success: false }));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /\[web-integration-baseline\] FAIL/);
  assert.match(result.stderr, /testResults/);
  assert.doesNotMatch(result.stderr, /at extractFailingFiles/, 'must print a reason, not a raw stack trace');
});

test('CLI: testResults: [] (zero test files collected) exits 1, never PASSes (MAJOR-3)', () => {
  const dir = makeTmpDir();
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ count: 0, files: [] }, null, 2));
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ success: true, testResults: [] }));

  const result = runChecker([`--report=${reportPath}`, `--baseline=${baselinePath}`]);

  assert.equal(result.code, 1, `expected exit 1, got ${result.code}. stderr:
${result.stderr}`);
  assert.match(result.stderr, /\[web-integration-baseline\] FAIL/);
  assert.match(result.stderr, /ZERO test files/);
  assert.doesNotMatch(result.stdout, /PASS/, 'a broken/empty run must never print PASS');
});

test('extractFailingFiles: throws on testResults: [] (zero files collected)', () => {
  assert.throws(() => extractFailingFiles({ success: true, testResults: [] }), /ZERO test files/);
});
