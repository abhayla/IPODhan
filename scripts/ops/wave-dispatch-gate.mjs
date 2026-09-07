#!/usr/bin/env node
// scripts/ops/wave-dispatch-gate.mjs — T-499, .claude/rules/signal-ownership.md
// R4 ("New beats standing" — a NEW failing id is acted on before queued
// feature work).
//
// PreToolUse hook body (wrapped by .claude/hooks/wave-dispatch-gate.sh,
// matcher: Agent) that refuses an Agent-tool dispatch whose prompt LOOKS
// like a build/wave brief (contains both "Budget:" and "Class:" — the
// required lines per .claude/rules/defect-fix-contract.md and
// claude-behavior.md rule 5's task-tracking pattern) while
// scripts/ops/state/floor-issues.json still lists a NEW floor FAIL id with
// no issue number recorded against it. Reviewer dispatches are never
// blocked — the review IS the response to a signal, not competing queued
// work. Reviewer briefs in this project ALSO carry Budget:/Class: lines, so
// the reviewer check runs FIRST, on the opening 200 chars only ("review" +
// "Tier A"/"Tier B"); only when that's absent does Budget:+Class: mark a
// prompt as a build brief (round 3 — round 2's Budget:/Class:-first order
// falsely blocked every review in this project).
//
// Escape hatch: SIGNAL_GATE_ALLOW=1 in the environment always allows.
// Fails open (allow, exit 0) when the state file is missing/unreadable, or
// on any unexpected error — this hook must never be the reason a session
// can't dispatch anything.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
// Round 3: allow tests (and any caller) to point this at a temp file instead
// of the real per-laptop state, via WAVE_DISPATCH_GATE_STATE_FILE.
const ISSUES_FILE = process.env.WAVE_DISPATCH_GATE_STATE_FILE
  || path.join(REPO_ROOT, 'scripts', 'ops', 'state', 'floor-issues.json');

/** Pure. Reads floor-issues.json shape { entries: [{id, issue}] } and
 * returns the ids with no issue number yet. `available: false` covers both
 * "file missing" and "file unreadable/corrupt" — both are fail-open cases. */
export function loadFloorIssueIds(filePath) {
  if (!existsSync(filePath)) return { available: false, ids: [] };
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const ids = entries.filter((e) => e && (e.issue === null || e.issue === undefined)).map((e) => e.id);
    return { available: true, ids };
  } catch {
    return { available: false, ids: [] };
  }
}

/** Pure decision function — the whole gate's logic, unit-testable without
 * touching the filesystem or env. */
export function evaluateDispatch({ toolName, prompt, unresolvedIds, allowOverride }) {
  if (allowOverride) {
    return { block: false, reason: 'SIGNAL_GATE_ALLOW=1' };
  }
  if (toolName !== 'Agent') {
    return { block: false, reason: 'not an Agent dispatch' };
  }
  const text = typeof prompt === 'string' ? prompt : '';
  // Round 3: reviewer-first. In this project a real reviewer brief ALSO
  // carries Budget:/Class: lines, so Budget:/Class: alone can't decide
  // "build brief" — it must be checked AFTER the reviewer signal, not
  // before. Reviewer is judged ONLY on the opening 200 chars (real build
  // briefs open with "Task T-..."; a build brief whose own "review: Tier B"
  // line happens to land past char 200 is not this shape and still gates).
  const head = text.slice(0, 200);
  const isReviewer = /\breview/i.test(head) && /\b(Tier A|Tier B)\b/.test(head);
  if (isReviewer) {
    return { block: false, reason: 'reviewer prompt (review + Tier A/B in the opening 200 chars) — never blocked' };
  }
  const looksLikeBuildBrief = text.includes('Budget:') && text.includes('Class:');
  if (!looksLikeBuildBrief) {
    return { block: false, reason: 'not a build/wave brief (no Budget:+Class: lines)' };
  }
  if (!unresolvedIds || unresolvedIds.length === 0) {
    return { block: false, reason: 'no NEW floor FAIL id lacking an issue number' };
  }
  return {
    block: true,
    reason: `NEW floor FAIL id(s) with no issue number: ${unresolvedIds.join(', ')}`,
  };
}

export function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf-8');
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`wave-dispatch-gate: fail-open (could not parse hook stdin JSON: ${err.message})\n`);
    process.exit(0);
  }

  try {
    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const prompt = typeof toolInput.prompt === 'string' ? toolInput.prompt : '';
    const allowOverride = process.env.SIGNAL_GATE_ALLOW === '1';

    const { available, ids } = loadFloorIssueIds(ISSUES_FILE);
    if (!available) {
      process.exit(0); // fail-open: no state = nothing to gate on
    }

    const verdict = evaluateDispatch({ toolName, prompt, unresolvedIds: ids, allowOverride });
    if (verdict.block) {
      process.stderr.write(
        `BLOCKED (wave-dispatch-gate): ${verdict.reason}. File the issue(s) and record it in ` +
          `scripts/ops/state/floor-issues.json (set "issue": <number>) before dispatching a build/wave ` +
          `brief — signal-ownership.md R4 ("New beats standing"). Escape hatch: SIGNAL_GATE_ALLOW=1.\n`,
      );
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`wave-dispatch-gate: fail-open (unexpected error: ${err.message})\n`);
    process.exit(0);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
