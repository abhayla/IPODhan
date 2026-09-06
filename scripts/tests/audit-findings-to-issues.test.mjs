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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  planIssueSync,
  renderIssueBody,
  renderCommentBody,
  parseArgs,
  buildNextState,
  DEFAULT_MAX_ISSUES,
  LOCK_STALE_MS,
  localDateStamp,
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
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-01', lastRowKeys: ['row-1'] } },
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
    previousState: { c_test: { issueNumber: 42, firstSeen: '2026-09-01', lastRowKeys: ['row-1'] } },
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

test('M1/H1: PASS -> FAIL -> PASS flap keeps the SAME issue (state carries issueNumber across close)', () => {
  const title = '[nightly-audit] c_test: test check';
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

  // Night 3: FAIL again, issue #7 is now CLOSED — our own state has closedAt
  // from night 2, so this must REOPEN #7, never create a new issue.
  const night3 = planIssueSync({
    findings: { c_test: finding() }, // rows: ['row-1'] again
    issues: [{ number: 7, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 7, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-02' } },
    today: '2026-09-03',
  });
  assert.equal(night3.length, 1);
  assert.equal(night3[0].type, 'reopen');
  assert.equal(night3[0].issueNumber, 7);
});

// ---- H1: our own auto-close vs a human close --------------------------------

test('H1 case 1: an issue WE auto-closed (closedAt in state) that fails again -> reopen', () => {
  const title = '[nightly-audit] c_test: test check';
  const actions = planIssueSync({
    findings: { c_test: finding() }, // FAIL again, same row-1
    issues: [{ number: 9, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 9, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-02' } },
    today: '2026-09-03',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'reopen');
  assert.equal(actions[0].issueNumber, 9);
  assert.match(actions[0].comment, /Failing again on 2026-09-03/);
});

test('H1 case 2: an issue a HUMAN closed (no closedAt in state) is never reopened', () => {
  const title = '[nightly-audit] c_test: test check';
  // Unchanged rows -> skip, not reopen.
  const unchangedActions = planIssueSync({
    findings: { c_test: finding() },
    issues: [{ number: 9, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 9, firstSeen: '2026-09-01', lastRowKeys: ['row-1'] } }, // no closedAt
    today: '2026-09-03',
  });
  assert.equal(unchangedActions[0].type, 'skip');
  assert.match(unchangedActions[0].reason, /closed by a human/);

  // Changed rows -> comment on the closed issue, still never reopen.
  const changedActions = planIssueSync({
    findings: { c_test: finding({ rows: [{ rowKey: 'row-9', title: 'Row 9', body: 'x' }] }) },
    issues: [{ number: 9, title, state: 'CLOSED' }],
    previousState: { c_test: { issueNumber: 9, firstSeen: '2026-09-01', lastRowKeys: ['row-1'] } }, // no closedAt
    today: '2026-09-03',
  });
  assert.equal(changedActions[0].type, 'comment');
  assert.equal(changedActions[0].targetState, 'CLOSED');
  assert.notEqual(changedActions[0].type, 'reopen');
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

test('the cron script defaults to dry-run via an issues-live marker file, not a bare AUDIT_ISSUES_DRY_RUN', () => {
  const cron = readFileSync(join(REPO_ROOT, 'scripts', 'vps-data-audit-cron.sh'), 'utf8');
  assert.match(cron, /issues-live/);
  assert.match(cron, /AUDIT_ISSUES_DRY_RUN=1 node scripts\/audit-findings-to-issues\.mjs/);
  assert.match(cron, /ISSUES-DRY-RUN: no .*issues-live marker; touch it to go live/);
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
  const dryRunBlockMatch = src.match(/if \(opts\.dryRun\) \{[\s\S]*?return;\s*\n\s*\}/);
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

// ---- M4: dry-run still reads (list is not gated by dryRun) -----------------

test('M4: the gh-available branch calls listIssues even under --dry-run (only writes are gated)', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  // The `available` branch's try-block calls listIssues(repo) unconditionally
  // (no `if (!opts.dryRun)` guarding that specific call) — writes (ensureLabels
  // args, applyAction) are what carry the dryRun flag instead.
  const availableBranch = src.match(/} else \{\s*try \{\s*degradedCount \+= await ensureLabels\(repo, opts\.dryRun\);\s*issues = await listIssues\(repo\);/);
  assert.ok(availableBranch, 'expected listIssues(repo) to be called unconditionally in the gh-available branch');
});

test('M4: the no-gh branch prints the documented dry-run fallback message', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /DRY-RUN \(no gh\): assuming no existing issues/);
});

// ---- LOW (d): malformed --max-issues falls back to the default -------------

test('LOW(d): a non-numeric --max-issues falls back to DEFAULT_MAX_ISSUES with a warning', () => {
  const opts = parseArgs(['--max-issues', 'not-a-number']);
  assert.equal(opts.maxIssues, DEFAULT_MAX_ISSUES);
});

test('LOW(d): a valid --max-issues is respected', () => {
  const opts = parseArgs(['--max-issues', '5']);
  assert.equal(opts.maxIssues, 5);
});

// ---- LOW (e): lockfile ------------------------------------------------------

test('LOW(e): a second acquireLock in the same state dir is refused while the lock is fresh', async () => {
  const { acquireLock, releaseLock } = await import('../audit-findings-to-issues.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'audit-lock-test-'));
  try {
    const lock1 = acquireLock(dir);
    assert.ok(lock1, 'first acquireLock should succeed');
    const lock2 = acquireLock(dir);
    assert.equal(lock2, null, 'second acquireLock should be refused while the lock is fresh');
    releaseLock(lock1);
    const lock3 = acquireLock(dir);
    assert.ok(lock3, 'acquireLock should succeed again after release');
    releaseLock(lock3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LOW(e): a stale lock (older than LOCK_STALE_MS) is reclaimed, not honoured', async () => {
  const { acquireLock } = await import('../audit-findings-to-issues.mjs');
  const { utimesSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'audit-lock-test-'));
  try {
    const lockPath = join(dir, 'issues-sync.lock');
    writeFileSync(lockPath, '12345');
    const staleSeconds = (Date.now() - LOCK_STALE_MS - 60000) / 1000;
    utimesSync(lockPath, staleSeconds, staleSeconds);
    const reacquired = acquireLock(dir);
    assert.ok(reacquired, 'a lock older than LOCK_STALE_MS must be reclaimable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- MEDIUM: a failed action must not mutate state --------------------------

test('MEDIUM: a failed reopen keeps closedAt set in the written state', () => {
  const action = { type: 'reopen', checkId: 'c_test', issueNumber: 9, rowKeys: ['row-1'], finding: finding() };
  const previousState = { c_test: { issueNumber: 9, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-05' } };
  const nextState = buildNextState({ actions: [action], actionResults: [false], previousState, runDate: '2026-09-07' });
  assert.equal(nextState.c_test.closedAt, '2026-09-05', 'closedAt must survive a failed reopen — the issue is still closed on GitHub');
  assert.equal(nextState.c_test.issueNumber, 9);
});

test('MEDIUM: a successful reopen clears closedAt', () => {
  const action = { type: 'reopen', checkId: 'c_test', issueNumber: 9, rowKeys: ['row-1'], finding: finding() };
  const previousState = { c_test: { issueNumber: 9, firstSeen: '2026-09-01', lastRowKeys: ['row-1'], closedAt: '2026-09-05' } };
  const nextState = buildNextState({ actions: [action], actionResults: [true], previousState, runDate: '2026-09-07' });
  assert.equal(nextState.c_test.closedAt, undefined);
});

test('MEDIUM: a failed create records no issueNumber (no state entry at all)', () => {
  const action = { type: 'create', checkId: 'c_test', firstSeen: '2026-09-07', rowKeys: ['row-1'], finding: finding() };
  const nextState = buildNextState({ actions: [action], actionResults: [false], previousState: {}, runDate: '2026-09-07' });
  assert.equal(nextState.c_test, undefined);
});

test('MEDIUM: a successful create records issueNumber: null (resolved later from a fresh list)', () => {
  const action = { type: 'create', checkId: 'c_test', firstSeen: '2026-09-07', rowKeys: ['row-1'], finding: finding() };
  const nextState = buildNextState({ actions: [action], actionResults: [true], previousState: {}, runDate: '2026-09-07' });
  assert.equal(nextState.c_test.issueNumber, null);
  assert.deepEqual(nextState.c_test.lastRowKeys, ['row-1']);
});

// ---- LOW (a): lockfile atomicity ---------------------------------------------

test('LOW(a): acquireLock uses an atomic create-exclusive write (wx), not check-then-write', () => {
  const src = readFileSync(join(__dirname, '..', 'audit-findings-to-issues.mjs'), 'utf8');
  assert.match(src, /flag:\s*'wx'/);
});

test('localDateStamp formats a Date as local YYYY-MM-DD', () => {
  const d = new Date(2026, 8, 6); // month is 0-indexed: September 6, 2026
  assert.equal(localDateStamp(d), '2026-09-06');
});
