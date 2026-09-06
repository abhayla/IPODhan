/**
 * W-178: wrap a python extractor spawn so it runs at low CPU scheduling
 * priority on Linux.
 *
 * Prod and staging both run their scraper under pm2 with a cron-restart of
 * every 30 minutes on the hour and half hour (staging now offset — see
 * `scripts/deploy-linux.sh`'s `SCRAPER_CRON`). Even offset, a single slot's
 * `extract_filing.py` / `anchor_report_text.py` still spawns at the SAME
 * nice-0 priority as nginx/Next on a 2-vCPU box — measured on the prod VPS
 * 2026-09-06: two extractor processes at ~100% CPU each for 7+ minutes
 * starved nginx/Next long enough for Cloudflare to return 522s for 10/25
 * pages, with no 5xx at nginx and no accept-queue drops (i.e. a CPU
 * scheduling problem, not a capacity or crash problem). `nice` does not fix
 * memory pressure (that is `memory_guard.py`'s `RLIMIT_AS` ceiling, applied
 * INSIDE the python process once it starts) — it only tells the Linux
 * scheduler to prefer other runnable processes over the extractor whenever
 * both want the CPU at once, which is exactly the failure mode here.
 *
 * `nice` wraps the OUTSIDE of the spawn (which binary + args node execs);
 * `memory_guard.install_memory_ceiling()` runs INSIDE the resulting python
 * process once it is running, so the two compose in either order — nice
 * only affects scheduling priority of whatever process ends up running,
 * it does not touch what that process does to itself after it starts.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import defaultLogger from './logger.js';

type WarnLogger = Pick<typeof defaultLogger, 'warn'>;

/** `nice`'s PATH is always POSIX-delimited (this guard only ever activates
 * on `process.platform === 'linux'`) — hardcode ':' rather than
 * `path.delimiter`, which reflects the HOST os this process is actually
 * running on (';' when this file is exercised from a Windows dev box, even
 * with `process.platform` force-overridden to 'linux' in a test). */
const POSIX_PATH_DELIMITER = ':';

/** Default `nice` level (0-19, higher = lower priority) applied to every
 * python extractor spawn on Linux. Overridable via `EXTRACTOR_NICE`.
 * W-178 round 2 MINOR-5: lowered from 15 to 10 — 15 was more deference than
 * the measured 522 incident needed (a single extractor at nice-0 vs nice-10
 * still yields the CPU to nginx/Next under contention; 15 risked the
 * extractor starving itself behind unrelated low-priority work on a busy
 * box for no added protection). */
const DEFAULT_EXTRACTOR_NICE = 10;

/** Clamp to the valid POSIX `nice -n` range so a bad env value can never
 * produce an invalid or backwards (negative, root-only) priority. */
export function resolveExtractorNice(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EXTRACTOR_NICE;
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : DEFAULT_EXTRACTOR_NICE;
  if (!Number.isFinite(parsed)) return DEFAULT_EXTRACTOR_NICE;
  return Math.min(19, Math.max(0, parsed));
}

let cachedNiceOnPath: boolean | undefined;
let warnedNiceMissing = false;

/** Cheap, synchronous `which nice` — no subprocess spawn. Cached for the
 * life of the process; PATH does not change mid-run. Exposed for tests.
 * Also resets the paired "nice missing" warn-once flag (W-178 round 2
 * MINOR-2) — the two caches are about the same fact and always reset
 * together in tests. */
export function resetNiceOnPathCache(): void {
  cachedNiceOnPath = undefined;
  warnedNiceMissing = false;
}

/**
 * `pathExists` is injectable so tests can fake "a `nice` file lives at this
 * POSIX path" without needing a real Linux filesystem (a Windows dev box's
 * drive-letter paths, e.g. `C:\...`, cannot round-trip through a
 * `:`-delimited PATH string at all — the drive letter's own colon collides
 * with the delimiter). Production always uses the real `existsSync`.
 *
 * W-178 round 2 MINOR-2: when `nice` is absent, every extractor spawn
 * silently ran at normal priority with no signal anywhere that the W-178
 * mitigation was a no-op on this box. Logs ONE `logger.warn` per process
 * (not once per spawn — a scraper cycle spawns the extractor per document)
 * the first time the check resolves false; `resetNiceOnPathCache()` is the
 * only way to re-arm it, matching the PATH cache it rides along with.
 */
function niceResolvesOnPath(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (p: string) => boolean = existsSync,
  logger: WarnLogger = defaultLogger
): boolean {
  if (cachedNiceOnPath !== undefined) return cachedNiceOnPath;
  const pathVar = env.PATH ?? env.Path ?? '';
  cachedNiceOnPath = pathVar
    .split(POSIX_PATH_DELIMITER)
    .filter(Boolean)
    .some((dir) => pathExists(path.posix.join(dir, 'nice')));
  if (!cachedNiceOnPath && !warnedNiceMissing) {
    warnedNiceMissing = true;
    logger.warn('nice not found on PATH; extractor runs at normal priority (W-178)');
  }
  return cachedNiceOnPath;
}

export interface LowPrioritySpawn {
  bin: string;
  args: string[];
}

/**
 * Returns `{ bin: 'nice', args: ['-n', <level>, bin, ...args] }` when running
 * on Linux with `nice` available on PATH; otherwise returns `{ bin, args }`
 * unchanged (e.g. on Windows dev boxes, or a stripped container image with
 * no `nice`). Never throws — a missing `nice` is a silent no-op, not a spawn
 * failure, because CPU-priority is a best-effort mitigation, not a
 * correctness requirement.
 */
export function withLowPriority(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (p: string) => boolean = existsSync,
  logger: WarnLogger = defaultLogger
): LowPrioritySpawn {
  if (process.platform !== 'linux' || !niceResolvesOnPath(env, pathExists, logger)) {
    return { bin, args };
  }
  const level = String(resolveExtractorNice(env));
  return { bin: 'nice', args: ['-n', level, bin, ...args] };
}
