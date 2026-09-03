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

// T-311F (checker MEDIUM finding): the previous implementation was a plain
// GET-then-SET — two separate round trips — while its own comment claimed
// "atomically reserve the slot". Two overlapping one-shot cycles (e.g. a
// slow-running cycle overlapping with cron_restart firing the next one)
// could both read the same stale last-run value before either SET landed,
// and both would claim the slot. This Lua script makes the read-check-write
// a single atomic command: Redis executes a script to completion before
// serving any other command, so a second concurrent caller for the SAME key
// only ever sees the result of the FIRST caller's write, never a
// stale mid-way state. `KEYS[1]` is the cadence key; `ARGV` carries the
// current time, the interval in ms, and the TTL in seconds so all the
// arithmetic below is identical to the pre-atomic version.
const CADENCE_LUA = `
local lastRunRaw = redis.call('GET', KEYS[1])
local lastRun = tonumber(lastRunRaw) or 0
local now = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])
if lastRun > 0 and (now - lastRun) < intervalMs then
  return 0
end
redis.call('SET', KEYS[1], tostring(now), 'EX', ttlSeconds)
return 1
`;

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
  const intervalMs = intervalMinutes * 60_000;
  // TTL is generous (4x the interval) so a stuck key still self-heals.
  const ttlSeconds = Math.max(60, intervalMinutes * 60 * 4);

  try {
    const result = await redis.eval(CADENCE_LUA, 1, key, String(now.getTime()), String(intervalMs), String(ttlSeconds));
    return Number(result) === 1;
  } catch (error) {
    logger.warn(
      { jobName, error: error instanceof Error ? error.message : String(error) },
      '[catch-up-cadence] Redis unavailable — failing open (running this cycle)'
    );
    return true;
  }
}

/**
 * Round-3 M2 (Tier-A review of round 1): `shouldRunOnCatchUpCadence` stamps the
 * key at CHECK time. That is right for a job whose only cost of a double-run is
 * duplicate work, but wrong for the due-step cycle: PM2 force-restarts the
 * process every 30 minutes, so a kill (or a throw) between the stamp and the
 * job actually finishing left the key stamped and the job skipped for the whole
 * 24h interval — one lost aggregator/API-fallback day per unlucky restart.
 *
 * `isCatchUpCadenceDue` is the READ-ONLY half (no write, so a crash right after
 * it changes nothing) and `markCatchUpCadenceRan` is the explicit stamp the
 * caller makes AFTER the work succeeded. Both fail OPEN on a Redis error, same
 * as the combined function, which stays exactly as it is for its existing
 * callers (listing-performance / registrar-health-check).
 *
 * Trade-off, stated plainly: split check-then-mark is NOT atomic, so two
 * genuinely concurrent cycles could both see "due". The due-step cycle is
 * already serialized by the `scraper:cycle` whole-cycle Redis lock in
 * `index.ts`, so that window does not exist on this path; the combined atomic
 * function remains the right tool for callers with no such lock.
 */
export async function isCatchUpCadenceDue(
  redis: Redis,
  jobName: string,
  intervalMinutes: number,
  now: Date = new Date()
): Promise<boolean> {
  const key = `${KEY_PREFIX}${jobName}`;
  try {
    const raw = await redis.get(key);
    const lastRun = Number(raw);
    if (!raw || !Number.isFinite(lastRun) || lastRun <= 0) return true;
    return now.getTime() - lastRun >= intervalMinutes * 60_000;
  } catch (error) {
    logger.warn(
      { jobName, error: error instanceof Error ? error.message : String(error) },
      '[catch-up-cadence] Redis unavailable on due check — failing open (running this cycle)'
    );
    return true;
  }
}

/** Stamp `jobName` as having run at `now`. Call only AFTER the work succeeded. */
export async function markCatchUpCadenceRan(
  redis: Redis,
  jobName: string,
  intervalMinutes: number,
  now: Date = new Date()
): Promise<void> {
  const key = `${KEY_PREFIX}${jobName}`;
  const ttlSeconds = Math.max(60, intervalMinutes * 60 * 4);
  try {
    await redis.set(key, String(now.getTime()), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn(
      { jobName, error: error instanceof Error ? error.message : String(error) },
      '[catch-up-cadence] Redis unavailable on mark-ran — cadence key not stamped (job may re-run next cycle)'
    );
  }
}
