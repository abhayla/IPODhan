// T-425 — mechanism for registry class `merged-fix-never-deployed-while-bug-live`
// (see #265; first occurrence T-327: fix merged 26 Aug, not served until 28
// Aug because staging/prod env lacked TZ and the T-324 deploy-failure alert
// was one-shot). This file owns ONE predicate: is a merged `fixes-live-bug`
// PR actually reaching production?
//
// PURE, no DB/HTTP/gh reached here — same convention as
// scripts/lib/document-state-checks.mjs and scripts/lib/detection-floor-checks.mjs.
// scripts/audit-detection-floor.mjs does the I/O (gh CLI + the served-SHA HTTP
// fetch, read the same way the T-324 SHA-drift monitor reads it — GET
// {BASE_URL}/api/version, see .github/workflows/deploy-linux.yml "Verify
// /api/version reflects the deployed SHA") and hands this function plain data.

/** A merged fix not yet served past this age is a real outage, not a deploy-lag blip. */
export const FIX_NOT_SERVED_FAIL_HOURS = 24;

/**
 * checkFixMergedNotServed — is every merged `fixes-live-bug` PR served yet?
 *
 * @param {object} input
 * @param {Array<{number:number, mergedAt:string}>|null} input.mergedPRs
 *   Merged PRs carrying the `fixes-live-bug` label. `null` means the caller
 *   could not list them (gh unavailable) — UNVERIFIABLE, never a silent PASS.
 * @param {string|null} input.servedSha - the SHA currently served at BASE_URL,
 *   or null if it could not be read (down, or /api/version returned "unknown").
 * @param {string|null} input.servedCommitTime - ISO timestamp of servedSha's
 *   commit (the audit reads this via local git history: `git log -1 --format=%cI <sha>`).
 *   null if the commit could not be dated (unreachable, or not in local history).
 * @param {Date|string} [input.now]
 * @returns {{status:'PASS'|'WARN'|'FAIL'|'UNVERIFIABLE', reason:string, offenders:Array}}
 */
export function checkFixMergedNotServed({ mergedPRs, servedSha, servedCommitTime, now }) {
  const nowMs = new Date(now ?? Date.now()).getTime();

  if (!servedSha || !servedCommitTime) {
    return {
      status: 'UNVERIFIABLE',
      reason: !servedSha
        ? 'served SHA unavailable (BASE_URL/api/version unreachable or returned "unknown")'
        : 'served SHA has no locally-known commit time (git log could not date it)',
      offenders: [],
    };
  }
  if (mergedPRs === null || mergedPRs === undefined) {
    return { status: 'UNVERIFIABLE', reason: 'could not list merged fixes-live-bug PRs (gh unavailable or not authenticated)', offenders: [] };
  }

  const servedMs = new Date(servedCommitTime).getTime();
  const failOffenders = [];
  const warnOffenders = [];

  for (const pr of mergedPRs) {
    const mergedMs = new Date(pr.mergedAt).getTime();
    // Linear history to main: the served commit's time already tells us
    // whether this merge is included — no ancestry walk needed.
    if (servedMs >= mergedMs) continue;
    const ageHours = (nowMs - mergedMs) / 3_600_000;
    const offender = { number: pr.number, mergedAt: pr.mergedAt, ageHours: Math.round(ageHours * 10) / 10 };
    if (ageHours > FIX_NOT_SERVED_FAIL_HOURS) failOffenders.push(offender);
    else warnOffenders.push(offender);
  }

  if (failOffenders.length > 0) {
    return {
      status: 'FAIL',
      reason: `${failOffenders.length} merged fixes-live-bug PR(s) not served for more than ${FIX_NOT_SERVED_FAIL_HOURS}h: ${failOffenders.map((o) => `#${o.number} (${o.ageHours}h)`).join(', ')}`,
      offenders: failOffenders,
    };
  }
  if (warnOffenders.length > 0) {
    return {
      status: 'WARN',
      reason: `${warnOffenders.length} merged fixes-live-bug PR(s) not yet served, within the ${FIX_NOT_SERVED_FAIL_HOURS}h deploy-lag grace period: ${warnOffenders.map((o) => `#${o.number} (${o.ageHours}h)`).join(', ')}`,
      offenders: warnOffenders,
    };
  }
  return {
    status: 'PASS',
    reason: mergedPRs.length === 0
      ? 'no merged fixes-live-bug PRs found'
      : `all ${mergedPRs.length} merged fixes-live-bug PR(s) are served (served commit is at or after their merge)`,
    offenders: [],
  };
}

// --- deploy-failure STATUS row (DoD item 2) --------------------------------
// T-324's "Alert owner on deploy failure" step in deploy-linux.yml pages ONCE
// on failure and never again — a fix landing hours later leaves no record
// that a deploy is still broken. These two pure functions decide the shape of
// a STATUS row that stays open until a later deploy on the SAME slot succeeds;
// scripts/deploy-status.mjs (I/O) reads/writes it to disk.

/** Build the STATUS row written when a deploy fails. */
export function buildDeployFailureStatusRow({ slot, sha, runUrl, gateReason, failedAt }) {
  return {
    slot,
    sha,
    runUrl,
    gateReason,
    failedAt: new Date(failedAt ?? Date.now()).toISOString(),
  };
}

/**
 * clearDeployStatus — given the current status map (slot -> row) and a slot
 * that just deployed successfully, return the map with that slot's row
 * removed (a successful deploy always clears its own slot's open failure).
 */
export function clearDeployStatus(statusMap, slot) {
  const next = { ...(statusMap ?? {}) };
  delete next[slot];
  return next;
}

/** setDeployFailureStatus — write/refresh the row for `slot` in the map. */
export function setDeployFailureStatus(statusMap, slot, row) {
  return { ...(statusMap ?? {}), [slot]: row };
}
