import logger from './logger.js';

export interface RaceWithTimeoutOptions {
  /** Milliseconds to wait before giving up on `task`. */
  timeoutMs?: number;
  /** Label used in the timeout warn line, e.g. "lock release". */
  label?: string;
}

/**
 * W-140 round 2 (W-152): default bound for how long the SIGTERM/SIGINT
 * signal path waits for lock release before exiting anyway. Overridable via
 * `SIGNAL_LOCK_RELEASE_TIMEOUT_MS` so a slow-but-healthy Redis in one
 * environment doesn't need a code change.
 */
export const DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS = 5000;

/**
 * Runs `task` and races it against a timeout so a hung dependency (e.g. a
 * Redis that never responds) cannot block process exit forever. Resolves
 * when `task` completes OR when the timeout elapses, whichever is first, and
 * logs exactly one warn line if the timeout wins. Never rejects — this is
 * used on an exit path where nothing downstream can act on a rejection, and
 * locks left held past this point still expire via their own TTL.
 */
export async function raceWithTimeout(
  task: () => Promise<void>,
  options: RaceWithTimeoutOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
  const label = options.label ?? 'task';

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`${label} timed out after ${timeoutMs}ms — exiting anyway (locks expire by TTL)`);
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });

  const taskPromise = task().catch((error) => {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      `${label} failed (non-fatal)`
    );
  });

  await Promise.race([taskPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);
}
