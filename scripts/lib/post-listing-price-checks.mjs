// #1310 (listed-rotation-stall, 2nd write path): the post-listing price job's own log shape
// that proves the class is happening RIGHT NOW, not just that the code changed. The write-time
// fix (priceLastAttemptAt ordering, scraper/src/scheduler/post-listing-price.ts) stops a
// never-priceable row from pinning the queue forever; this check is the independent audit that
// catches the NEXT write path this class recurs on, per recurrence-detection-gate.md — a write
// guard stops one call site, only an audit catches the next.
//
// Same "runs for real on the box, UNVERIFIABLE elsewhere" convention as
// scripts/lib/scraper-wake-detection.mjs: cron redirects the scraper's own stdout (pino JSON,
// scraper/src/utils/logger.ts) into the SAME per-slot log file
// (SCRAPER_WAKE_LOG_PATH_BY_SLOT in scripts/audit-detection-floor.mjs) that the wake script's
// own log() lines land in, so this reads that file too — no new log plumbing needed.
//
// Pure: raw log text in, a violation string or null out, so it is unit-testable against
// fixture pino JSON lines without a box, a DB, or a live cron.

/** The exact `msg` prefix `post-listing-price-wake.ts` logs on every completed run. */
export const PRICE_JOB_RUN_COMPLETE_MSG_PREFIX = 'Post-listing price job: run complete';

/** N consecutive zero-priced runs (each with candidates>0) is the starved-rotation shape. */
export const PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD = 3;

/**
 * Parses the price job's pino JSON "run complete" lines out of the raw wake log text, in file
 * order. A line that isn't valid JSON, or isn't this job's run-complete line, is skipped rather
 * than treated as a parse failure — the same file also carries scraper-wake.sh's own plain-text
 * log() lines and every OTHER scraper job's pino output.
 */
export function parsePriceJobRuns(raw) {
  const runs = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof obj.msg !== 'string' || !obj.msg.startsWith(PRICE_JOB_RUN_COMPLETE_MSG_PREFIX)) continue;
    const candidates = Number(obj.candidates);
    if (!Number.isFinite(candidates)) continue;
    const updated = Number(obj.updated) || 0;
    const confirmed = Number(obj.confirmed) || 0;
    const unchanged = Number(obj.unchanged) || 0;
    const stale = Number(obj.stale) || 0;
    runs.push({
      candidates,
      priced: updated + confirmed + unchanged + stale,
      time: typeof obj.time === 'string' ? obj.time : null,
    });
  }
  return runs;
}

/**
 * FAIL — the newest PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD run-complete lines all walked at
 * least one candidate (candidates > 0) and priced NONE of them: the exact shape #1310 measured
 * on staging (candidates 132, updated 0, every run from 04:12Z). Returns null (never a false
 * FAIL) when there are fewer than the threshold's worth of parseable run lines, or when a
 * `candidates: 0` run breaks the streak (outside market hours / a holiday — not a violation of
 * this check; `isPriceJobWindowIST`/the holiday gate already cover that case, and a genuinely
 * empty candidate set is not starvation).
 */
export function checkPriceJobZeroPricedStreak(raw) {
  const runs = parsePriceJobRuns(raw);
  if (runs.length < PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD) return null;
  const tail = runs.slice(-PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD);
  if (!tail.every((r) => r.candidates > 0 && r.priced === 0)) return null;
  const last = tail[tail.length - 1];
  return `the newest ${PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD} post-listing price runs each walked candidates>0 and priced=0 (last run: ${last.candidates} candidates, ${last.time ?? 'unknown time'}) — a starved rotation (listed-rotation-stall, #1310)`;
}
