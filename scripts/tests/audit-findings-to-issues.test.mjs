// Mutation-proof self-tests for scripts/audit-findings-to-issues.mjs
// (recurrence loop, part 2: nightly audit findings -> GitHub issues).
//
// planIssueSync() is a pure function with NO side effects (no gh calls) — the
// tests exercise it directly with synthetic findings/issues/previousState
// fixtures. Run: node --test scripts/tests/audit-findings-to-issues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  planIssueSync,
  renderIssueBody,
  renderCommentBody,
  DATA_REPAIR_CHECK_IDS,
} from '../audit-findings-to-issues.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function finding(overrides = {}) {
  return {
    status: 'FAIL',
    name: 'test check',
    detail: 'something is wrong',
    rows: [{ rowKey: 'row-1', title: 'Row 1', body: 'detail 1' }],
    ...overrides,
  };
}

test('new FAIL with no prior state and no issue -> create', () => {
  const actions = planIssueSync({
    findings: { c_test: finding() },
    issues: [],
    previousState: {},
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'create');
  assert.equal(actions[0].checkId, 'c_test');
  assert.equal(actions[0].firstSeen, '2026-09-07');
  assert.deepEqual(actions[0].rowKeys, ['row-1']);
});

test('unchanged row-key set on an already-open issue -> skip (no comment)', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: { c_test: finding() },
    issues: [{ number: 42, title, state: 'OPEN' }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'skip');
  assert.match(actions[0].reason, /unchanged/);
});

test('changed row-key set on an open issue -> comment listing new and resolved keys', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: {
      c_test: finding({
        rows: [
          { rowKey: 'row-1', title: 'Row 1', body: 'still bad' },
          { rowKey: 'row-3', title: 'Row 3', body: 'new offender' },
        ],
      }),
    },
    issues: [{ number: 42, title, state: 'OPEN' }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1', 'row-2'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'comment');
  assert.equal(actions[0].targetState, 'OPEN');
  assert.equal(actions[0].issueNumber, 42);
  assert.deepEqual(actions[0].newKeys, ['row-3']);
  assert.deepEqual(actions[0].resolvedKeys, ['row-2']);
});

test('check now PASS with an open issue -> close with a PASS comment', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'PASS', rows: [] }) },
    issues: [{ number: 42, title, state: 'OPEN' }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'close');
  assert.equal(actions[0].issueNumber, 42);
  assert.match(actions[0].comment, /PASS on 2026-09-07/);
});

test('check now PASS with no issue -> skip', () => {
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'PASS', rows: [] }) },
    issues: [],
    previousState: {},
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'skip');
  assert.match(actions[0].reason, /PASS/);
});

test('max-issues cap is respected — extra new-FAIL checks are skipped, not filed', () => {
  const findings = {
    c_a: finding({ name: 'a' }),
    c_b: finding({ name: 'b' }),
    c_c: finding({ name: 'c' }),
  };
  const actions = planIssueSync({
    findings, issues: [], previousState: {}, today: '2026-09-07', maxIssues: 2,
  });
  const creates = actions.filter((a) => a.type === 'create');
  const skips = actions.filter((a) => a.type === 'skip');
  assert.equal(creates.length, 2);
  assert.equal(skips.length, 1);
  assert.match(skips[0].reason, /max-issues cap/);
});

test('UNVERIFIABLE finding with no issue -> create (treated like FAIL)', () => {
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'UNVERIFIABLE', detail: 'oracle unreachable' }) },
    issues: [],
    previousState: {},
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'create');
  assert.equal(actions[0].finding.status, 'UNVERIFIABLE');
});

// ---- M1: closed-issue handling ---------------------------------------------

test('M1: a human-closed issue is NOT recreated when rows are unchanged', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: { c_test: finding() }, // still FAIL, same row-1
    issues: [{ number: 42, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-05' } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'skip');
  assert.match(actions[0].reason, /closed by a human/);
  assert.equal(actions[0].issueNumber, 42);
});

test('M1: a closed issue gets a non-reopening comment when rows changed', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: {
      c_test: finding({ rows: [{ rowKey: 'row-9', title: 'Row 9', body: 'new offender' }] }),
    },
    issues: [{ number: 42, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-05' } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'comment');
  assert.equal(actions[0].targetState, 'CLOSED');
  assert.equal(actions[0].issueNumber, 42);
  assert.deepEqual(actions[0].newKeys, ['row-9']);
  const body = renderCommentBody({ newKeys: actions[0].newKeys, resolvedKeys: actions[0].resolvedKeys, finding: actions[0].finding, runDate: '2026-09-07', targetState: 'CLOSED' });
  assert.match(body, /NOT reopening/);
  assert.match(body, /still failing/i);
});

test('M1: PASS -> FAIL -> PASS flap keeps the SAME issue (state carries issueNumber across close)', () => {
  const title = '[nightly-audit] c_test: test check';
  // Night 1: FAIL, no issue yet -> create.
  const night1 = planIssueSync({ findings: { c_test: finding() }, issues: [], previousState: {}, today: '2026-09-01' });
  assert.equal(night1[0].type, 'create');

  // Night 2: PASS, our own open issue #7 -> close (kept in state, not deleted).
  const night2 = planIssueSync({
    findings: { c_test: finding({ status: 'PASS', rows: [] }) },
    issues: [{ number: 7, title, state: 'OPEN' }],
    previousState: { c_test: { issueNumber: 7, firstSeen: '2026-09-01', lastRowKeys: ['row-1'] } },
    today: '2026-09-02',
  });
  assert.equal(night2[0].type, 'close');
  assert.equal(night2[0].issueNumber, 7);

  // Night 3: FAIL again, issue #7 is now CLOSED with the SAME rows as before
  // closing -> must NOT create a new issue; unchanged rows -> skip, not reopen.
  const night3 = planIssueSync({
    findings: { c_test: finding() }, // rows: ['row-1'] again
    issues: [{ number: 7, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 7, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-02' } },
    today: '2026-09-03',
  });
  assert.equal(night3.length, 1);
  assert.notEqual(night3[0].type, 'create');
  assert.equal(night3[0].issueNumber, 7);
});

// ---- renderIssueBody / renderCommentBody -----------------------------------

test('renderIssueBody includes status, detail, first-seen, and rows', () => {
  const body = renderIssueBody({
    checkId: 'c_test',
    finding: finding(),
    firstSeen: '2026-09-05',
    runDate: '2026-09-07',
    logPath: '/root/data-audit-ipodhan/state/run-2026-09-07.log',
    registryRow: null,
    severity: 'P1',
  });
  assert.match(body, /FAIL/);
  assert.match(body, /something is wrong/);
  assert.match(body, /2026-09-05/);
  assert.match(body, /Row 1/);
  assert.match(body, /Closed automatically when the check passes/);
});

test('renderIssueBody flags an UNVERIFIABLE check as blind, not passing', () => {
  const body = renderIssueBody({
    checkId: 'c_test',
    finding: finding({ status: 'UNVERIFIABLE', detail: 'NSE unreachable' }),
    firstSeen: '2026-09-05',
    runDate: '2026-09-07',
  });
  assert.match(body, /BLIND/);
});

test('renderCommentBody on an OPEN issue lists new and resolved keys separately', () => {
  const body = renderCommentBody({
    newKeys: ['row-3'], resolvedKeys: ['row-2'], finding: finding(), runDate: '2026-09-07', targetState: 'OPEN',
  });
  assert.match(body, /New \(1\)/);
  assert.match(body, /row-3/);
  assert.match(body, /Resolved \(1\)/);
  assert.match(body, /row-2/);
  assert.doesNotMatch(body, /NOT reopening/);
});

// ---- source assertions ------------------------------------------------------

test('the cron script invokes the new issue-sync step', () => {
  const cron = readFileSync(join(REPO_ROOT, 'scripts', 'vps-data-audit-cron.sh'), 'utf8');
  assert.match(cron, /audit-findings-to-issues\.mjs/);
});

test('the runner uses execFile with argv arrays, never exec() with a shell string', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /execFile\b/);
  assert.doesNotMatch(src, /[^.]\bexec\(/); // no bare exec(...) calls (execFile is fine)
});

test('M2: issue bodies are passed via --body-file, never --body <string>, on the gh argv path', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /--body-file/);
  // '--body', body  (an argv literal body string) must not appear as a real gh arg
  assert.doesNotMatch(src, /'--body',\s*body\b/);
});

test('M2: all three labels (nightly-audit, needs-decision, pipeline-failure) are ensured', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /MANAGED_LABELS/);
  assert.match(src, /needs-decision/);
  assert.match(src, /pipeline-failure/);
  assert.match(src, /ISSUES-DEGRADED/);
});

test('M3: main() has a runDate-is-today freshness guard', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /is not today/);
});

test('minor (a): dry-run branch never calls writeFileSync on the sync-state path', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  const dryRunBlockMatch = src.match(/if \(opts\.dryRun\) \{[\s\S]*?\n {2}\}/);
  assert.ok(dryRunBlockMatch, 'expected an early-return dry-run block in main()');
  assert.doesNotMatch(dryRunBlockMatch[0], /writeFileSync/);
});

test('minor (b): every DATA_REPAIR_CHECK_IDS entry is a real check id in detection-checks.json', () => {
  const registryPath = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks.json');
  assert.ok(existsSync(registryPath), 'detection-checks.json must exist');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const knownIds = new Set(registry.checks.map((c) => c.id));
  for (const id of DATA_REPAIR_CHECK_IDS) {
    assert.ok(knownIds.has(id), `DATA_REPAIR_CHECK_IDS has "${id}" which is not a check id in detection-checks.json`);
  }
});
