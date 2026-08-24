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
