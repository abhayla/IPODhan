// #663: two invariants nothing checks today.
//
// Before PR #660, pm2's `--cron-restart` both bounded AND woke the scraper —
// a scraper that stopped restarting was visible in `pm2 status`. After #660
// the wake lives in the deploying user's crontab, outside pm2 entirely; pm2
// keeps `--no-autorestart` and merely holds the process, so `pm2 status` can
// no longer tell whether the wake is alive — a scraper that is never woken
// shows an app that exited cleanly, which is exactly what `--no-autorestart`
// is SUPPOSED to look like.
//
// `scripts/ops/wake-delta.mjs` reads the SAME log this file's freshness
// check reads, but it is a session/ssh TICK tool a human or Fable runs by
// hand — it has never run unattended, and it only diffs FAILURE lines
// (wake-failed / ceiling-tripped) against the previous run's state. It
// cannot see the crontab line at all, and a cron line that stops firing
// entirely produces NO new failure line ever — `wake-delta.mjs` would read
// that as "no wake failures" forever, which is precisely the silent-success
// shape this issue is about. These two checks are the nightly-floor
// equivalent: they run for real on the box via cron (same convention as
// `checkH`'s pm2 checks in `audit-detection-floor.mjs`), and they check the
// crontab and the log FILE directly rather than diffing a state file.
//
// Both predicates are PURE — crontab text / a parsed timestamp in, a
// violation string or null out — so they are unit-testable against fixture
// crontab text and log lines without ssh, a box, or a live cron.

/** IST crontab cadence per slot, verbatim from scripts/deploy-linux.sh's SCRAPER_CRON defaults. */
export const SCRAPER_WAKE_CADENCE_BY_SLOT = { prod: '*/30 * * * *', staging: '15,45 * * * *' };

/** The data wake fires every 30 minutes on both slots (offset, never simultaneous — W-178). */
export const SCRAPER_WAKE_CADENCE_MINUTES = 30;

/**
 * A wake that fires exactly on cadence should never be older than the
 * cadence itself; the slack absorbs a slow cycle, a delayed cron tick, or a
 * `wake-skipped` line landing a few seconds late — not a genuinely missed
 * wake.
 */
export const SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES = 15;

function markerFor(slot) {
  return `# ipodhan-scraper-wake:${slot}`;
}

/** The `current` symlink each slot's crontab line must invoke (scripts/deploy-linux.sh CURRENT_LINK). */
export function expectedWakeScriptFragment(slot) {
  return slot === 'prod' ? '/current/scripts/scraper-wake.sh' : `/current-${slot}/scripts/scraper-wake.sh`;
}

/**
 * FAIL — the deploying user's crontab does not carry exactly one line for
 * this slot's data wake, naming the `current` symlink and this slot's
 * cadence. #663 check 1.
 */
export function checkScraperWakeCrontabLine(slot, crontabText) {
  const cadence = SCRAPER_WAKE_CADENCE_BY_SLOT[slot];
  if (!cadence) return `unknown slot "${slot}" — expected one of ${Object.keys(SCRAPER_WAKE_CADENCE_BY_SLOT).join(', ')}`;

  const marker = markerFor(slot);
  const matching = String(crontabText ?? '')
    .split(/\r?\n/)
    .filter((line) => line.includes(marker));

  if (matching.length === 0) {
    return `no crontab line carries the marker "${marker}" — the scraper has no wake on slot ${slot} (pm2 no longer restarts it since #660)`;
  }
  if (matching.length > 1) {
    return `${matching.length} crontab lines carry the marker "${marker}" for slot ${slot} — exactly one is expected: ${matching.join(' | ')}`;
  }

  const line = matching[0];
  if (!line.trim().startsWith(cadence)) {
    return `crontab line for slot ${slot} does not start with the expected cadence "${cadence}": "${line.trim()}"`;
  }
  const expectedFragment = expectedWakeScriptFragment(slot);
  if (!line.includes(expectedFragment)) {
    return `crontab line for slot ${slot} does not invoke the deploy's "current" symlink (expected to contain "${expectedFragment}"): "${line.trim()}"`;
  }
  return null;
}

/**
 * FAIL — the newest line in the wake log is older than one cadence interval
 * plus slack, or the log has no parseable wake line at all. The line
 * existing (check 1) is necessary and not sufficient: cron can fire a
 * command that fails instantly (the exit-78 refusals in scraper-wake.sh),
 * which leaves the crontab line present while the scraper stays asleep.
 * #663 check 2.
 */
export function checkScraperWakeFreshness(slot, newestWakeAt, now) {
  const ceilingMinutes = SCRAPER_WAKE_CADENCE_MINUTES + SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES;
  if (!newestWakeAt) {
    return `no wake line found in the log for slot ${slot} — the log is empty, missing, or the crontab line has never fired`;
  }
  const nowMs = new Date(now).getTime();
  const thenMs = new Date(newestWakeAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) {
    return `slot ${slot}: could not compute an age from newest wake timestamp "${newestWakeAt}" and now "${now}"`;
  }
  const ageMinutes = (nowMs - thenMs) / 60_000;
  if (ageMinutes <= ceilingMinutes) return null;
  return `slot ${slot}: newest wake log line is ${ageMinutes.toFixed(1)} min old, exceeds the ${ceilingMinutes} min ceiling (${SCRAPER_WAKE_CADENCE_MINUTES}min cadence + ${SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES}min slack) — a wake has not actually happened recently even if the crontab line is present`;
}
