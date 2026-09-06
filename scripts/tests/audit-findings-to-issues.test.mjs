// Mutation-proof self-tests for scripts/audit-findings-to-issues.mjs
// (recurrence loop, part 2: nightly audit findings -> GitHub issues).
//
// planIssueSync() is a pure function with NO side effects (no gh calls) — the
// tests exercise it directly with synthetic findings/openIssues/previousState
// fixtures. Run: node --test scripts/tests/audit-findings-to-issues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('new FAIL with no prior state and no open issue -> create', () => {
  const actions = planIssueSync({
    findings: { c_test: finding() },
    openIssues: [],
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
    openIssues: [{ number: 42, title }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'skip');
  assert.match(actions[0].reason, /unchanged/);
});

test('changed row-key set -> comment listing new and resolved keys', () => {
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
    openIssues: [{ number: 42, title }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1', 'row-2'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'comment');
  assert.equal(actions[0].issueNumber, 42);
  assert.deepEqual(actions[0].newKeys, ['row-3']);
  assert.deepEqual(actions[0].resolvedKeys, ['row-2']);
});

test('check now PASS with an open issue -> close with a PASS comment', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'PASS', rows: [] }) },
    openIssues: [{ number: 42, title }],
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-05', lastRowKeys: ['row-1'] } },
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'close');
  assert.equal(actions[0].issueNumber, 42);
  assert.match(actions[0].comment, /PASS on 2026-09-07/);
});

test('check now PASS with no open issue -> skip', () => {
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'PASS', rows: [] }) },
    openIssues: [],
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
    findings, openIssues: [], previousState: {}, today: '2026-09-07', maxIssues: 2,
  });
  const creates = actions.filter((a) => a.type === 'create');
  const skips = actions.filter((a) => a.type === 'skip');
  assert.equal(creates.length, 2);
  assert.equal(skips.length, 1);
  assert.match(skips[0].reason, /max-issues cap/);
});

test('UNVERIFIABLE finding with no open issue -> create (treated like FAIL)', () => {
  const actions = planIssueSync({
    findings: { c_test: finding({ status: 'UNVERIFIABLE', detail: 'oracle unreachable' }) },
    openIssues: [],
    previousState: {},
    today: '2026-09-07',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'create');
  assert.equal(actions[0].finding.status, 'UNVERIFIABLE');
});

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

test('renderCommentBody lists new and resolved keys separately', () => {
  const body = renderCommentBody({
    newKeys: ['row-3'], resolvedKeys: ['row-2'], finding: finding(), runDate: '2026-09-07',
  });
  assert.match(body, /New \(1\)/);
  assert.match(body, /row-3/);
  assert.match(body, /Resolved \(1\)/);
  assert.match(body, /row-2/);
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

test('DATA_REPAIR_CHECK_IDS is a non-empty set used to classify labels', () => {
  assert.ok(DATA_REPAIR_CHECK_IDS.size > 0);
  assert.ok(DATA_REPAIR_CHECK_IDS.has('c_issue_size_floor'));
});
