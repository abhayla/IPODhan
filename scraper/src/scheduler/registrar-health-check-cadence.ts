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

/**
 * Decide whether THIS one-shot cycle should run the registrar health check,
 * matching the original `'30 6 * * *'` IST daily cron intent.
 */
export function shouldRunRegistrarHealthCheck(now: Date): boolean {
  const { hour, minute } = toIst(now);
  return hour === 6 && minute >= 30;
}
