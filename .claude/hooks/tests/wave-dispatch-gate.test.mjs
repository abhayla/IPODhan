// T-499 — red-then-green tests for scripts/ops/wave-dispatch-gate.mjs
// (PreToolUse hook body, matcher: Agent). Run:
//   node --test .claude/hooks/tests/wave-dispatch-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateDispatch, loadFloorIssueIds } from '../../../scripts/ops/wave-dispatch-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(__dirname, '../../../scripts/ops/wave-dispatch-gate.mjs');

const BUILD_BRIEF = 'Do the thing.\nBudget: 30 min wall-clock, 60 tool calls\nClass: every X\nProof: ...';
const REVIEWER_BRIEF = 'Tier A review of the diff.\nBudget: 20 min, 40 tool calls\nClass: n/a\nreview the changes';

test('evaluateDispatch allows a non-Agent tool untouched', () => {
  const v = evaluateDispatch({ toolName: 'Bash', prompt: BUILD_BRIEF, unresolvedIds: ['x'], allowOverride: false });
  assert.equal(v.block, false);
});

test('evaluateDispatch allows a prompt with no Budget:+Class: lines (not a brief)', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: 'just look something up', unresolvedIds: ['x'], allowOverride: false });
  assert.equal(v.block, false);
});

test('evaluateDispatch allows when there are no unresolved NEW floor ids', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: BUILD_BRIEF, unresolvedIds: [], allowOverride: false });
  assert.equal(v.block, false);
});

test('evaluateDispatch BLOCKS a build/wave brief while a NEW floor FAIL id has no issue number', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: BUILD_BRIEF, unresolvedIds: ['check-x', 'check-y'], allowOverride: false });
  assert.equal(v.block, true);
  assert.match(v.reason, /check-x/);
  assert.match(v.reason, /check-y/);
});

test('evaluateDispatch never blocks a reviewer prompt (Tier A/B + review), even with unresolved ids', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: REVIEWER_BRIEF, unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, false);
  assert.match(v.reason, /reviewer/);
});

test('evaluateDispatch allows via SIGNAL_GATE_ALLOW override regardless of everything else', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: BUILD_BRIEF, unresolvedIds: ['check-x'], allowOverride: true });
  assert.equal(v.block, false);
  assert.match(v.reason, /SIGNAL_GATE_ALLOW/);
});

test('loadFloorIssueIds: missing file is fail-open (available:false, no ids)', () => {
  const r = loadFloorIssueIds(path.join(tmpdir(), `t499-does-not-exist-${Date.now()}.json`));
  assert.equal(r.available, false);
  assert.deepEqual(r.ids, []);
});

test('loadFloorIssueIds: corrupt JSON is fail-open', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-'));
  const file = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(file, '{ not valid json');
    const r = loadFloorIssueIds(file);
    assert.equal(r.available, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadFloorIssueIds: returns only entries with issue null/undefined', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-'));
  const file = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(
      file,
      JSON.stringify({
        entries: [
          { id: 'check-resolved', issue: 411 },
          { id: 'check-open', issue: null },
          { id: 'check-legacy' }, // no issue field at all
        ],
      }),
    );
    const r = loadFloorIssueIds(file);
    assert.equal(r.available, true);
    assert.deepEqual(r.ids.sort(), ['check-legacy', 'check-open']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- End-to-end: drive the actual hook script as a subprocess (stdin JSON in,
// exit code out) the way Claude Code's PreToolUse harness does, so the CLI
// wiring (stdin parsing, ISSUES_FILE resolution, exit codes) is proven too,
// not just the pure functions.
function runHook(payload, env = {}) {
  try {
    execFileSync('node', [HOOK_SCRIPT], {
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (err) {
    return err.status ?? -1;
  }
}

test('end-to-end: with no floor-issues.json state, the hook fails open (exit 0) even for a build brief', () => {
  // The repo's real scripts/ops/state/floor-issues.json does not exist in a
  // clean checkout — this proves the "missing state = fail open" contract
  // against the real file the hook reads, not a stub.
  const code = runHook({ tool_name: 'Agent', tool_input: { prompt: BUILD_BRIEF } });
  assert.equal(code, 0);
});
