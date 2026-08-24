/**
 * Registrar allotment-URL health-check cadence guard for the one-shot
 * production scraper (T-300F, fixing T-300C finding F1).
 *
 * `runRegistrarHealthCheck()` was only ever registered in
 * `SchedulerService.init()` (`scheduler.ts`, cron `'30 6 * * *'` IST), but
 * production runs `pm2 start tsx -- src/index.ts --source=all` on a flat
 * 30-minute `cron_restart` and NEVER imports `SchedulerService` — the repo's
 * own T-179/T-176 comments document this exact trap
 * (`docs/monitoring/scrape-cadence-measurement.md`). `SchedulerService`'s
 * intended cadence for this job was DAILY, not every 30 minutes: the job
 * does ~19 sequential outbound HTTP fetches (12s timeout each,
 * `registrarHealthCheck: 300` = 5 min lock TTL in `LOCK_TTL`), so running it
 * every cycle would hammer registrar sites every 30 minutes instead of once
 * a day.
 *
 * This guard reproduces the ORIGINAL `'30 6 * * *'` cadence on top of the
 * flat 30-min one-shot trigger, the same technique
 * `shouldRunListingPerformanceUpdate` (`listing-performance-cadence.ts`,
 * T-179) uses for the identical class of problem: the one-shot cycle whose
 * IST wall-clock lands in the 06:30-06:59 window runs the check; every other
 * cycle skips it, giving exactly one run per day.
 */

import { toIst } from './listing-performance-cadence.js';

// T-306 (T-300C2 advisory): the window above is evaluated fresh every
// one-shot cycle with no memory of whether today's run actually happened. A
// cycle that lands even slightly outside the 06:30-06:59 window (a slow
// prior cycle, a restart, a missed cron_restart tick) means NO cycle that day
// falls in-window, and the check silently skips for 24h with nothing to
// notice. This is the catch-up threshold: once this long has passed since the
// last confirmed run, run on the very next cycle regardless of the window.
const CATCHUP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether THIS one-shot cycle should run the registrar health check,
 * matching the original `'30 6 * * *'` IST daily cron intent — with a
 * catch-up fallback so a missed window doesn't silently skip a whole day.
 *
 * @param lastRunAt - the last CONFIRMED run's timestamp (persisted by the
 *   caller, e.g. in Redis). Pass explicit `null` when the caller checked and
 *   found no confirmed run (fresh deploy / lost store) -- treated as
 *   "infinitely stale", so catch-up fires immediately rather than waiting for
 *   the next 06:30 IST window. OMITTING the argument entirely preserves the
 *   original window-only behavior (in-window only) for callers that don't yet
 *   track last-run state.
 */
export function shouldRunRegistrarHealthCheck(now: Date, lastRunAt?: Date | null): boolean {
  const { hour, minute } = toIst(now);
  if (hour === 6 && minute >= 30) return true;

  if (lastRunAt === undefined) return false; // caller doesn't track last-run -- window-only.
  if (lastRunAt === null) return true; // caller confirmed there is no prior run -- catch up now.
  return now.getTime() - lastRunAt.getTime() > CATCHUP_THRESHOLD_MS;
}
