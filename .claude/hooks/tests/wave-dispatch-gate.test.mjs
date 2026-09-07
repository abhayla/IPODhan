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

test('evaluateDispatch never blocks a pure reviewer prompt (Tier A/B + review, no Budget:/Class:)', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: 'Tier A review of the diff, no brief here.', unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, false);
  assert.match(v.reason, /reviewer/);
});

test('(a) round 3: reviewer brief that ALSO carries Budget:+Class: is still allowed (reviewer-first)', () => {
  const v = evaluateDispatch({ toolName: 'Agent', prompt: REVIEWER_BRIEF, unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, false, 'reviewer signal in the opening 200 chars must win over Budget:/Class: appearing later');
  assert.match(v.reason, /reviewer/);
});

test('(b) round 3: build brief with "review: Tier B" AFTER the 200-char opening is still blocked', () => {
  const padding = 'y'.repeat(200); // pushes "review: Tier B" well past char 200
  const briefWithTierMentionLate = `Task T-1: ${padding}\nBudget: 30 min, 60 tool calls\nClass: every Y\nreview: Tier B\nProof: ...`;
  assert.ok(briefWithTierMentionLate.indexOf('Tier B') >= 200, 'fixture sanity: Tier B must land past char 200');
  const v = evaluateDispatch({ toolName: 'Agent', prompt: briefWithTierMentionLate, unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, true, 'Tier text outside the opening 200 chars must not exempt a build brief');
  assert.match(v.reason, /check-x/);
});

test('(c) round 3: pins the 200-char boundary — Tier text at char ~250 in a build brief still blocks', () => {
  const padding = 'x'.repeat(220); // pushes the Tier/review mention past char 200
  const brief = `Task T-1: ${padding}\nreview: Tier B\nBudget: 10 min, 20 tool calls\nClass: everything`;
  assert.ok(brief.indexOf('Tier B') >= 200, 'fixture sanity: Tier B must land past char 200');
  const v = evaluateDispatch({ toolName: 'Agent', prompt: brief, unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, true);
});

test('(d) round 3: dropping the "Tier B" alternative would falsely block a Tier-B-only reviewer (mutation guard)', () => {
  const tierBReviewer = 'Tier B review of the diff.\nBudget: 20 min, 40 tool calls\nClass: n/a\nreview the changes';
  const v = evaluateDispatch({ toolName: 'Agent', prompt: tierBReviewer, unresolvedIds: ['check-x'], allowOverride: false });
  assert.equal(v.block, false, 'a regex that only matches "Tier A" (dropping the Tier B alternative) would wrongly block this');
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

test('end-to-end: with a state file that has no unresolved ids, the hook allows (exit 0) even for a build brief', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-cli-'));
  const stateFile = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(stateFile, JSON.stringify({ entries: [] }));
    const code = runHook({ tool_name: 'Agent', tool_input: { prompt: BUILD_BRIEF } }, { WAVE_DISPATCH_GATE_STATE_FILE: stateFile });
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('end-to-end: missing state file (env points at a nonexistent path) fails open (exit 0)', () => {
  const stateFile = path.join(tmpdir(), `t499-cli-missing-${Date.now()}.json`);
  const code = runHook({ tool_name: 'Agent', tool_input: { prompt: BUILD_BRIEF } }, { WAVE_DISPATCH_GATE_STATE_FILE: stateFile });
  assert.equal(code, 0);
});

test('end-to-end: corrupt stdin JSON fails open (exit 0)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-cli-'));
  const stateFile = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(stateFile, JSON.stringify({ entries: [{ id: 'check-x', issue: null }] }));
    execFileSync('node', [HOOK_SCRIPT], {
      input: '{ not valid json',
      encoding: 'utf-8',
      env: { ...process.env, WAVE_DISPATCH_GATE_STATE_FILE: stateFile },
    });
    assert.ok(true);
  } catch (err) {
    assert.equal(err.status, 0, `expected exit 0 on corrupt stdin, got ${err.status}: ${err.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('end-to-end: a TEMP state file (never the real one) with an unresolved NEW id blocks a build brief (exit 2)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-cli-'));
  const stateFile = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(stateFile, JSON.stringify({ entries: [{ id: 'check-cli-e2e', issue: null }] }));
    const code = runHook({ tool_name: 'Agent', tool_input: { prompt: BUILD_BRIEF } }, { WAVE_DISPATCH_GATE_STATE_FILE: stateFile });
    assert.equal(code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('end-to-end: same TEMP state file, but a reviewer prompt is still allowed (exit 0)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-cli-'));
  const stateFile = path.join(dir, 'floor-issues.json');
  try {
    writeFileSync(stateFile, JSON.stringify({ entries: [{ id: 'check-cli-e2e', issue: null }] }));
    const code = runHook({ tool_name: 'Agent', tool_input: { prompt: REVIEWER_BRIEF } }, { WAVE_DISPATCH_GATE_STATE_FILE: stateFile });
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
