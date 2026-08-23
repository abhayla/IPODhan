/**
 * Registrar allotment-URL health check JOB (P1-2, T-300, round-5 review).
 *
 * Round-5 evidence: 13 of 15 registrar `allotmentCheckUrl` values were dead
 * (404/406/444/no-resolve) with NOTHING validating the table since 2025-10
 * — the breakage was silent until a manual audit found it, by which point
 * 88 of 192 FK-linked IPOs were sending users to broken allotment pages.
 * This job is the standing daily guard against that recurring silently:
 * fetch every active registrar's `allotmentCheckUrl`, persist the result on
 * the row (`allotment_url_healthy` / `allotment_url_checked_at` — see
 * schema migration 0032), and page the owner via Notifier the moment a URL
 * goes dead instead of waiting for the next manual audit.
 *
 * The web serving layer (see `web/lib/repositories/registrar-repository.ts`
 * / registrar display components) reads `allotment_url_healthy` to decide
 * whether to render the allotment-check CTA — this job is what keeps that
 * flag current, not a live per-request fetch (a live fetch per page view
 * would be slow and itself a new failure mode).
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import logger from '../../utils/logger.js';
import { notifyOwner } from '../../services/owner-notify.js';
import { CacheInvalidator } from '../cache-invalidator.js';

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; IPODhan-RegistrarHealthCheck/1.0)';

export interface RegistrarHealthCheckResult {
  checked: number;
  healthy: number;
  newlyDead: string[]; // registrar names that flipped healthy -> dead this run
  stillDead: string[];
}

async function isUrlHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    // Some registrar sites don't implement HEAD (405/501) — retry with GET
    // before concluding dead, same fallback curl needed during manual
    // verification for this task.
    if (!res.ok || res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one health-check cycle over every active registrar with a non-null
 * `allotmentCheckUrl`. Never throws — a fetch failure marks that one
 * registrar unhealthy, it does not abort the cycle (same "one flaky
 * downstream must not poison the run" posture as
 * `non-fatal-side-effects.md`).
 */
export async function runRegistrarHealthCheck(): Promise<RegistrarHealthCheckResult> {
  logger.info('[registrar-health-check] cycle start');

  const registrars = await db
    .select({
      id: schema.registrars.id,
      name: schema.registrars.name,
      allotmentCheckUrl: schema.registrars.allotmentCheckUrl,
      allotmentUrlHealthy: schema.registrars.allotmentUrlHealthy,
    })
    .from(schema.registrars)
    .where(and(eq(schema.registrars.active, true), isNotNull(schema.registrars.allotmentCheckUrl)));

  const newlyDead: string[] = [];
  const stillDead: string[] = [];
  let healthyCount = 0;
  let statusChanged = false;

  for (const r of registrars) {
    const url = r.allotmentCheckUrl!;
    let healthy: boolean;
    try {
      healthy = await isUrlHealthy(url);
    } catch (error) {
      // isUrlHealthy already catches its own errors; this is a last-resort
      // guard so one unexpected throw (e.g. DNS module crash) can't take
      // down the whole cycle.
      logger.warn(
        { registrarId: r.id, name: r.name, url, error: error instanceof Error ? error.message : String(error) },
        '[registrar-health-check] URL check crashed (non-fatal, treated as unhealthy)'
      );
      healthy = false;
    }

    if (healthy) healthyCount++;
    else if (r.allotmentUrlHealthy) newlyDead.push(r.name);
    else stillDead.push(r.name);

    if (healthy !== r.allotmentUrlHealthy) statusChanged = true;

    try {
      await db
        .update(schema.registrars)
        .set({ allotmentUrlHealthy: healthy, allotmentUrlCheckedAt: new Date() })
        .where(eq(schema.registrars.id, r.id));
    } catch (error) {
      logger.warn(
        { registrarId: r.id, name: r.name, error: error instanceof Error ? error.message : String(error) },
        '[registrar-health-check] status write failed (non-fatal)'
      );
    }
  }

  for (const name of newlyDead) {
    notifyOwner('P1', `Registrar allotment URL went dead: ${name}`, {
      body: `A registrar's allotment-check URL failed its health check. The web layer will hide its CTA until it recovers. See registrars table for the current URL.`,
      type: 'registrar-health',
      dedupeKey: `registrar-url-dead:${name}`,
    });
  }

  if (statusChanged) {
    try {
      const invalidator = new CacheInvalidator(getRedisClient());
      await invalidator.invalidateRegistrars();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        '[registrar-health-check] cache invalidation failed (non-fatal)'
      );
    }
  }

  const result: RegistrarHealthCheckResult = {
    checked: registrars.length,
    healthy: healthyCount,
    newlyDead,
    stillDead,
  };
  logger.info({ ...result }, '[registrar-health-check] cycle complete');
  return result;
}
