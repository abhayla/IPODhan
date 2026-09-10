/**
 * One call per cycle: tell the web app which IPO pages this cycle changed.
 *
 * OD-40. Two halves of this already shipped and neither did anything on its own:
 * slice 1 records which IPOs a cycle actually wrote to, slice 2 built the
 * endpoint that clears their caches and rebuilds their pages. Until this call
 * exists the tracker fills a Set nobody drains and the endpoint waits for a
 * caller that does not exist — two merged, tested, green halves adding up to
 * zero, which is the shape item 20's wiring gate was built for.
 *
 * Shaped after `triggerStatusUpdate` in index.ts deliberately: same env vars,
 * same Bearer auth, same non-fatal try/catch, same StepResult. It is one more
 * caller of a mechanism already in production, not a new one.
 *
 * `fetchImpl` and `env` are injected so this is unit-testable without a web app
 * or a live token. The cycle passes neither and gets the real ones.
 */
import { logger } from '../utils/logger.js';
import { drainTouched } from './touched-ipos-tracker.js';

/**
 * MUST match index.ts's `StepResult` exactly - it is a DISCRIMINATED UNION where
 * `reason` is REQUIRED on skipped and failed, and the two types meet at
 * `runStep(cycleId, step, fn)`.
 *
 * My first version declared `reason?: string` on all three, which is looser and
 * therefore not assignable: `{ status: 'skipped' }` satisfies the loose shape
 * and not the real one. It merged in #557 because nothing type-checks
 * `scraper/` - CLAUDE.md says so plainly ("Nothing type-checks scraper/ or
 * packages/shared/ at commit time"), and `tsc --noEmit` there is red with 94
 * other pre-existing errors, so one more was invisible.
 *
 * Not imported from index.ts on purpose: index.ts imports THIS module, so an
 * import back would be circular. Duplicated with the constraint stated instead.
 */
export type StepResult =
  | { status: 'ok'; reason?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export interface RevalidationTriggerDeps {
  env?: { WEB_INTERNAL_URL?: string; ADMIN_API_TOKEN?: string };
  fetchImpl?: typeof fetch;
}

export async function triggerPageRevalidation(
  deps: RevalidationTriggerDeps = {}
): Promise<StepResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;

  // DRAINED FIRST, and unconditionally. If a failed post left the slugs in
  // place, every later cycle would resend them and refresh pages nothing had
  // touched, and the list could only ever grow. The cost of draining before a
  // failure is that one cycle's refresh is lost — those pages then wait out
  // their timer, which is exactly today's behaviour.
  const slugs = drainTouched();

  if (slugs.length === 0) {
    // Most cycles change nothing. Posting an empty list every 30 minutes is a
    // request that can only ever be a no-op.
    //
    // LOGGED, not returned silently. Without this line a quiet cycle and a step
    // that never ran are the same absence in the log, so "no revalidation line"
    // could not be read as evidence either way — which is exactly what happened
    // on the 20:45:02Z staging cycle of 2026-09-10, where the missing line cost
    // a proof read (signal-ownership R6: a gate prints its reason).
    logger.info({ sent: 0, reason: 'no IPO was written this cycle' }, 'Page revalidation skipped');
    return { status: 'skipped', reason: 'no IPO was written this cycle' };
  }

  const baseUrl = env.WEB_INTERNAL_URL || 'http://localhost:3001';
  const token = env.ADMIN_API_TOKEN;
  if (!token) {
    // Unreachable under --source=all (assertRequiredEnvForCycle refuses to start
    // without it, T-340). A defensive skip rather than an unauthenticated post.
    logger.warn({ slugs: slugs.length }, 'ADMIN_API_TOKEN not set — skipping page revalidation');
    return { status: 'skipped', reason: 'ADMIN_API_TOKEN not set' };
  }

  try {
    const res = await doFetch(`${baseUrl}/api/admin/revalidate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, slugs }, 'Page revalidation returned non-OK');
      return { status: 'failed', reason: `revalidate endpoint returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data?: unknown };
    // Named, not counted: the endpoint reports what it revalidated, and the two
    // lists are compared to catch a slug silently dropped between the tracker
    // and the endpoint (signal-ownership R1).
    logger.info({ sent: slugs, result: body.data }, 'Page revalidation requested');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), slugs },
      'Page revalidation trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
