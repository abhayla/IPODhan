// Pure state-transition helpers for scripts/ops/failure-delta.mjs, split out so the
// R2 escalation logic ("no number = new = escalate this tick") is unit-testable without
// spawning ssh/gh subprocesses. T-496 round 2.

/**
 * Parses one `--track <ipoId>|<errorClass>=<#issue>` argument.
 * @param {string} raw
 * @param {string[]} knownClasses
 * @returns {{matchType: 'ipoId'|'errorClass', value: string, issueNumber: number}}
 */
export function parseTrackArg(raw, knownClasses) {
  const eq = raw.lastIndexOf('=');
  if (eq === -1) throw new Error(`--track expects <ipoId>|<errorClass>=<#issue>, got "${raw}"`);
  const value = raw.slice(0, eq);
  const issueNumber = Number(raw.slice(eq + 1).replace(/^#/, ''));
  if (!value || !Number.isFinite(issueNumber)) {
    throw new Error(`--track expects <ipoId>|<errorClass>=<#issue>, got "${raw}"`);
  }
  return { matchType: knownClasses.includes(value) ? 'errorClass' : 'ipoId', value, issueNumber };
}

/**
 * Carries forward issueNumber + firstSeen from the previous state, applies a persisted
 * class-level track (state.classIssues) to any entry not already carrying a per-key
 * issueNumber — including a key first seen THIS run, never before in previousFailures —
 * then applies this run's --track overrides, in place, on every entry in currentMap.
 * A per-key --track (matchType 'ipoId') always wins because it is applied last and only
 * touches matching entries; a class rule this run also updates the persisted classIssues
 * map the caller writes back to state (T-502).
 * Does NOT decide NEW/GONE/SAME — that's `diff()` in failure-delta.mjs; this only
 * resolves tracked status.
 * @param {Map<string, object>} currentMap keyed failures for this run (mutated)
 * @param {Record<string, object>} previousFailures state.failures from the last run
 * @param {{matchType: string, value: string, issueNumber: number}[]} trackRules
 * @param {Record<string, number>} [classIssues] state.classIssues from the last run —
 *   errorClass -> issue number, persisted by a prior `--track <errorClass>=<#issue>`
 */
export function resolveTrackedState(currentMap, previousFailures, trackRules, classIssues = {}) {
  for (const [key, f] of currentMap) {
    const prev = previousFailures[key];
    f.issueNumber = prev?.issueNumber ?? null;
    f.firstSeen = prev?.firstSeen ?? f.firstSeen;
  }
  for (const f of currentMap.values()) {
    if (f.issueNumber == null && classIssues[f.errorClass] != null) {
      f.issueNumber = classIssues[f.errorClass];
    }
  }
  for (const f of currentMap.values()) {
    for (const rule of trackRules) {
      const matches = rule.matchType === 'errorClass' ? f.errorClass === rule.value : f.ipoId === rule.value;
      if (matches) f.issueNumber = rule.issueNumber;
    }
  }
  return currentMap;
}

/**
 * R2: "no number = new = escalate this tick" — untracked (no issueNumber) counts toward
 * exit 3 on EVERY run it appears in, whether NEW or SAME. Only GONE entries are exempt
 * (they no longer appear this run at all).
 * @param {Map<string, {issueNumber: number|null}>} currentMap
 * @returns {number}
 */
export function countUntracked(currentMap) {
  let n = 0;
  for (const f of currentMap.values()) {
    if (!f.issueNumber) n++;
  }
  return n;
}

/**
 * Formats an ssh/exec failure as one plain-text reason line — never a stack trace (R6:
 * failures carry their cause, but the CAUSE, not the raw exception object).
 * @param {{stderr?: {toString?: () => string}, message?: string}} err
 * @returns {string}
 */
export function formatSshFailure(err) {
  const reason = err?.stderr?.toString?.().trim() || err?.message || String(err);
  return `failure-delta: ssh read failed: ${reason}`;
}

// #429: `scraper/src/index.ts` logs this exact msg once at the end of every
// cycle (level 30), win or lose. It is the only cycle-boundary marker
// already present in the log — no new instrumentation needed.
export const CYCLE_BOUNDARY_MSG = 'Scraper execution completed';

/**
 * Bounds a parsed log window down to the LATEST COMPLETE cycle (the span
 * between the two most recent cycle-boundary markers), instead of the raw
 * fixed-line-count scan `failure-delta.mjs` reads over ssh.
 *
 * Without this, a failure logged hours ago stays inside the scanned window
 * (default last 5000 lines) long after it stopped recurring, and
 * `extractFailures` + `diff()` keep reporting it SAME — it can never report
 * GONE while its one occurrence is still in range (#429). Bounding to the
 * latest complete cycle means a failure that did NOT recur in the newest
 * finished cycle is simply absent from `currentMap`, so `diff()`'s existing
 * NEW/GONE/SAME logic reports it GONE on its own — no new "is this still
 * failing" check needed against production (which this ops-only fix must
 * not touch — no ssh, no DB tunnel, no VPS run).
 *
 * Fewer than 2 boundary markers in the scanned window means there is no
 * complete cycle to bound to yet (e.g. right after a slot's first-ever run,
 * or a tiny test fixture) — falls back to the full window unchanged rather
 * than guessing.
 * @param {object[]} parsedLines
 * @param {string} [boundaryMsg]
 * @returns {object[]}
 */
export function latestCycleWindow(parsedLines, boundaryMsg = CYCLE_BOUNDARY_MSG) {
  const boundaryIdxs = [];
  for (let i = 0; i < parsedLines.length; i++) {
    if (parsedLines[i]?.msg === boundaryMsg) boundaryIdxs.push(i);
  }
  if (boundaryIdxs.length < 2) return parsedLines;
  const start = boundaryIdxs[boundaryIdxs.length - 2] + 1;
  return parsedLines.slice(start);
}
