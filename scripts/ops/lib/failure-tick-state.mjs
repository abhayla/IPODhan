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
 * Carries forward issueNumber + firstSeen from the previous state and applies --track
 * overrides, in place, on every entry in currentMap. Does NOT decide NEW/GONE/SAME —
 * that's `diff()` in failure-delta.mjs; this only resolves tracked status.
 * @param {Map<string, object>} currentMap keyed failures for this run (mutated)
 * @param {Record<string, object>} previousFailures state.failures from the last run
 * @param {{matchType: string, value: string, issueNumber: number}[]} trackRules
 */
export function resolveTrackedState(currentMap, previousFailures, trackRules) {
  for (const [key, f] of currentMap) {
    const prev = previousFailures[key];
    f.issueNumber = prev?.issueNumber ?? null;
    f.firstSeen = prev?.firstSeen ?? f.firstSeen;
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
