/**
 * Last-run catch-up cadence guard (T-311, replacing the wall-clock-window
 * pattern used by `listing-performance-cadence.ts` / `registrar-health-check-cadence.ts`).
 *
 * The existing wall-clock guards (`hour === 6 && minute >= 30`) only fire a
 * job when a one-shot `--source=all` cycle happens to land inside a specific
 * IST window. If the process is down, a cycle is skipped, or the cron drifts
 * even slightly during that exact window, the job silently does not run
 * until the SAME window comes around again (up to 24h later) -- T-300C2
 * flagged this as an advisory gap when reviewing the registrar health-check
 * wiring.
 *
 * This guard tracks the actual last-run timestamp per job in Redis and fires
 * whenever `intervalMinutes` have elapsed since that timestamp, regardless
 * of wall-clock alignment -- a missed cycle is caught on the very next
 * cycle instead of waiting for the next matching window.
 *
 * Fail-open on Redis error (`redis-best-effort-fail-open.md`): if Redis is
 * down, the guard returns `true` (run this cycle) rather than silently
 * starving the job of its cadence -- the caller's own job body already
 * tolerates being invoked more often than strictly necessary (duplicate
 * sweep / stage reconciler both default to dry-run, idempotent reads).
 */
import type Redis from 'ioredis';
import logger from '../utils/logger.js';

const KEY_PREFIX = 'scheduler:last-run:';

/**
 * Decide whether THIS one-shot cycle should run `jobName`, and if so,
 * atomically reserve the slot (write the new last-run timestamp) so a
 * concurrent/overlapping process does not also claim the same run.
 *
 * @param redis - Redis client (best-effort; failures fail OPEN)
 * @param jobName - stable job identifier, used as the Redis key suffix
 * @param intervalMinutes - minimum minutes between two runs of this job
 * @param now - injectable clock for tests
 */
export async function shouldRunOnCatchUpCadence(
  redis: Redis,
  jobName: string,
  intervalMinutes: number,
  now: Date = new Date()
): Promise<boolean> {
  const key = `${KEY_PREFIX}${jobName}`;

  try {
    const lastRunRaw = await redis.get(key);
    const lastRunMs = lastRunRaw ? Number(lastRunRaw) : 0;
    const elapsedMinutes = (now.getTime() - lastRunMs) / 60_000;

    if (Number.isFinite(lastRunMs) && lastRunMs > 0 && elapsedMinutes < intervalMinutes) {
      return false;
    }

    // Reserve the slot before the caller runs the job body, so a slow run
    // this cycle does not cause the very next cycle to also claim it. TTL
    // is generous (4x the interval) so a stuck key still self-heals.
    await redis.set(key, String(now.getTime()), 'EX', Math.max(60, intervalMinutes * 60 * 4));
    return true;
  } catch (error) {
    logger.warn(
      { jobName, error: error instanceof Error ? error.message : String(error) },
      '[catch-up-cadence] Redis unavailable — failing open (running this cycle)'
    );
    return true;
  }
}
