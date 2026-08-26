/**
 * Served-SHA drift monitor (T-324 ITEM 2, MECHANISM-DUE
 * 'automated-deploy-failing-unnoticed'). Prod (or staging) sitting behind
 * origin/main with NOTHING paging the owner is the second half of the
 * incident this task exists for -- deploy-linux.yml failed 4 consecutive
 * push-to-main runs on 2026-08-25 and prod sat stale for hours undetected.
 *
 * This module compares each slot's served `/api/version` sha against
 * origin/main HEAD (via `git ls-remote` -- no local `.git` needed, see
 * `getMainShaFromOrigin`) once an hour. Wiring lives in `index.ts`
 * (`triggerDeployDriftMonitor`), gated by the SAME `catch-up-cadence.ts`
 * mechanism the T-311 wire-or-retire jobs already use -- `SchedulerService`
 * (`scheduler.ts`) is dead code in production (PM2 only ever runs the
 * one-shot `--source=all` CLI, see
 * `docs/monitoring/scrape-cadence-measurement.md`), so this deliberately
 * does NOT register a second cron/scheduler.
 *
 * Grace period + one-page-per-drift: a fresh drift is not paged
 * immediately (a deploy in flight looks identical to a stuck deploy for
 * the first few minutes) -- only once the SAME drift (same mainSha) has
 * persisted past `DRIFT_GRACE_MS` does this fire, and it fires EXACTLY
 * ONCE per (slot, mainSha) pair. State is tracked in Redis rather than
 * relying solely on Notifier's dedupeKey cooldown, because this job's own
 * 60-minute cadence is longer than Notifier's 30-minute dedupe window --
 * dedupeKey alone would re-page every cycle for as long as the drift lasts.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import type Redis from 'ioredis';
import logger from '../utils/logger.js';
import { notifyOwner, type OwnerSeverity } from './owner-notify.js';

const execFileAsync = promisify(execFile);

export type DeploySlot = 'prod' | 'staging';

/** Canonical origin, matching `package.json`'s `repository.url`. */
const REPO_URL = 'https://github.com/abhayla/IPODhan.git';

/** DoD: "if prod has been behind main for > 60 min". */
const DRIFT_GRACE_MS = 60 * 60 * 1000;

const STATE_KEY_PREFIX = 'deploy-drift:state:';

/** State persisted per slot so a re-run within the same drift never re-alerts. */
export interface DriftState {
  mainSha: string;
  firstSeenAt: string; // ISO
  alertedForSha: string | null;
}

export interface SlotDriftResult {
  slot: DeploySlot;
  mainSha: string;
  servedSha: string | null;
  drifting: boolean;
  alerted: boolean;
  reason?: 'served-sha-unknown' | 'grace-period' | 'already-alerted';
}

type NotifyFn = (severity: OwnerSeverity, title: string, opts?: { body?: string; type?: string; dedupeKey?: string }) => void;

export interface DeployDriftDeps {
  getMainSha: () => Promise<string | null>;
  getServedSha: (slot: DeploySlot) => Promise<string | null>;
  redis: Pick<Redis, 'get' | 'set' | 'del'>;
  now?: () => Date;
  notify?: NotifyFn;
}

/**
 * Real implementation: `git ls-remote` against the repo's canonical origin.
 * Deliberately does NOT require a local `.git` directory or `origin`
 * remote -- deploy-linux.sh's release directories are `git archive`
 * exports (see that script's comment above its `pm2 start` calls), so a
 * plain `git -C <release-dir> ls-remote origin` would fail there. Passing
 * the URL directly works from any cwd with git + network access.
 */
export async function getMainShaFromOrigin(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', REPO_URL, 'refs/heads/main'], {
      timeout: 15_000,
    });
    const sha = stdout.trim().split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] git ls-remote failed (non-fatal)'
    );
    return null;
  }
}

/**
 * Real implementation: reads the slot's PORT from the shared env file --
 * the SAME file/convention `deploy-linux.yml`'s own "Verify /api/version"
 * step reads (`$ROOT/shared/env/<slot>/web.env.local`) -- and curls
 * `/api/version` on localhost. The scraper runs on the SAME box as web
 * (T-242 M3), so this never needs a public URL, extra credentials, or a
 * documented staging domain (none exists).
 */
export async function getServedShaForSlot(slot: DeploySlot): Promise<string | null> {
  const root = process.env.DEPLOY_ROOT ?? '/var/www/ipodhan';
  const envFile = `${root}/shared/env/${slot}/web.env.local`;

  let port = '3000';
  try {
    const content = await readFile(envFile, 'utf-8');
    const match = content.match(/^PORT=(.+)$/m);
    if (match) port = match[1].trim();
  } catch (error) {
    logger.warn(
      { slot, envFile, error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] could not read slot env file for PORT (non-fatal)'
    );
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: controller.signal });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: { sha?: string } };
    return payload?.data?.sha ?? null;
  } catch (error) {
    logger.warn(
      { slot, port, error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] served-sha probe failed (non-fatal)'
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compare a served sha (deploy-linux.sh:394 serves the 8-char
 * `$SHORT_SHA` via `NEXT_PUBLIC_BUILD_SHA`) against the 40-char
 * `origin/main` HEAD sha (`getMainShaFromOrigin`) by PREFIX, not `===` --
 * the two are different lengths by design, so a strict equality check can
 * never match and would false-page every slot, every cycle, forever. Both
 * sides must be non-empty hex of at least 7 chars (the shortest sha git
 * itself will abbreviate to) before either `startsWith` check runs.
 */
function shasMatch(servedSha: string, mainSha: string): boolean {
  const hex7Plus = /^[0-9a-f]{7,}$/i;
  if (!hex7Plus.test(servedSha) || !hex7Plus.test(mainSha)) return false;
  return servedSha.startsWith(mainSha) || mainSha.startsWith(servedSha);
}

async function loadState(redis: Pick<Redis, 'get'>, slot: DeploySlot): Promise<DriftState | null> {
  try {
    const raw = await redis.get(`${STATE_KEY_PREFIX}${slot}`);
    return raw ? (JSON.parse(raw) as DriftState) : null;
  } catch {
    return null;
  }
}

async function saveState(redis: Pick<Redis, 'set'>, slot: DeploySlot, state: DriftState): Promise<void> {
  try {
    // 7-day TTL: generous self-heal if a drift resolves without this job's
    // clear-on-equal path ever running again for this slot.
    await redis.set(`${STATE_KEY_PREFIX}${slot}`, JSON.stringify(state), 'EX', 7 * 24 * 60 * 60);
  } catch (error) {
    logger.debug(
      { slot, error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] state persist failed (non-fatal)'
    );
  }
}

async function clearState(redis: Pick<Redis, 'del'>, slot: DeploySlot): Promise<void> {
  try {
    await redis.del(`${STATE_KEY_PREFIX}${slot}`);
  } catch (error) {
    logger.debug(
      { slot, error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] state clear failed (non-fatal)'
    );
  }
}

async function checkSlot(
  slot: DeploySlot,
  mainSha: string,
  deps: { getServedSha: DeployDriftDeps['getServedSha']; redis: DeployDriftDeps['redis']; now: () => Date; notify: NotifyFn }
): Promise<SlotDriftResult> {
  const servedSha = await deps.getServedSha(slot);

  if (servedSha === null) {
    // Unknown -- do not alert on a probe failure, and clear any prior drift
    // state so a transient outage doesn't fast-track an alert once the
    // probe recovers against a possibly-unrelated drift.
    await clearState(deps.redis, slot);
    return { slot, mainSha, servedSha: null, drifting: false, alerted: false, reason: 'served-sha-unknown' };
  }

  if (shasMatch(servedSha, mainSha)) {
    await clearState(deps.redis, slot);
    return { slot, mainSha, servedSha, drifting: false, alerted: false };
  }

  const now = deps.now();
  const existing = await loadState(deps.redis, slot);

  if (!existing || existing.mainSha !== mainSha) {
    // A NEW drift (first time this slot has been seen behind THIS mainSha)
    // -- start the grace-period clock, do not alert yet.
    await saveState(deps.redis, slot, { mainSha, firstSeenAt: now.toISOString(), alertedForSha: null });
    return { slot, mainSha, servedSha, drifting: true, alerted: false, reason: 'grace-period' };
  }

  const elapsedMs = now.getTime() - new Date(existing.firstSeenAt).getTime();

  if (elapsedMs <= DRIFT_GRACE_MS) {
    return { slot, mainSha, servedSha, drifting: true, alerted: false, reason: 'grace-period' };
  }

  if (existing.alertedForSha === mainSha) {
    // Already paged once for this exact drift -- "one page per drift, not
    // one per hour" (DoD).
    return { slot, mainSha, servedSha, drifting: true, alerted: false, reason: 'already-alerted' };
  }

  const severity: OwnerSeverity = slot === 'prod' ? 'P1' : 'P2';
  const minutesBehind = Math.round(elapsedMs / 60_000);
  deps.notify(severity, `IPODhan ${slot} served SHA behind main`, {
    body: `${slot} is serving ${servedSha.slice(0, 7)}; origin/main is at ${mainSha.slice(0, 7)}. Drift first observed ${minutesBehind}min ago.`,
    type: 'deploy-drift',
    dedupeKey: mainSha,
  });

  await saveState(deps.redis, slot, { ...existing, alertedForSha: mainSha });

  return { slot, mainSha, servedSha, drifting: true, alerted: true };
}

/**
 * Run one drift-check cycle across both slots. Never throws
 * (non-fatal-side-effects.md); if `mainSha` can't be resolved this cycle,
 * the cycle aborts cleanly (nothing to compare against) without touching
 * persisted state.
 */
export async function checkDeployDrift(deps: DeployDriftDeps): Promise<SlotDriftResult[]> {
  const now = deps.now ?? (() => new Date());
  const notify: NotifyFn = deps.notify ?? notifyOwner;

  let mainSha: string | null;
  try {
    mainSha = await deps.getMainSha();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      '[deploy-drift-monitor] getMainSha threw (non-fatal)'
    );
    mainSha = null;
  }

  if (!mainSha) {
    logger.debug('[deploy-drift-monitor] main sha unresolved this cycle -- skipping');
    return [];
  }

  const results: SlotDriftResult[] = [];
  for (const slot of ['prod', 'staging'] as const) {
    try {
      results.push(await checkSlot(slot, mainSha, { getServedSha: deps.getServedSha, redis: deps.redis, now, notify }));
    } catch (error) {
      logger.warn(
        { slot, error: error instanceof Error ? error.message : String(error) },
        '[deploy-drift-monitor] slot check failed (non-fatal)'
      );
    }
  }

  logger.info({ mainSha, results }, '[deploy-drift-monitor] cycle complete');
  return results;
}
