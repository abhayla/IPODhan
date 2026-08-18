/**
 * Owner alerts + uptime heartbeats -> the Notifier gateway (separate service,
 * github.com/abhayla/Notifier). Adapted from the claude-best-practices hub
 * template (core/.claude/templates/owner-notify.ts); contract in
 * .claude/rules/notifier-integration.md (T-194).
 *
 * NON-BREAKING BY CONSTRUCTION (fail-open):
 *  - no-op when NOTIFIER_URL / NOTIFIER_KEY are unset (dev, CI, or before the
 *    prod env lands on the VPS) -- nothing changes for local/test runs.
 *  - fire-and-forget with a 2s timeout: never awaited in the scrape cycle's
 *    critical path, never throws. A dead/slow Notifier can NEVER break a
 *    scrape run (same non-fatal-side-effect discipline as
 *    triggerStatusUpdate() in index.ts).
 *
 * Usage (scraper CLI, server-side only):
 *   import { heartbeat, notifyOwner, flushOwnerNotify } from './owner-notify.js';
 *   heartbeat('watchdog', 30);                    // at end of the one-shot cycle
 *   notifyOwner('P1', 'scraper NSE degraded', { body: reason });
 *   await flushOwnerNotify();                     // before process.exit() -- see index.ts
 */

import { logger } from '../utils/logger.js';

export type OwnerSeverity = 'P0' | 'P1' | 'P2' | 'info';

// In-flight sends, so the one-shot CLI entry point (index.ts) can flush
// before process.exit() -- an explicit exit would otherwise abort the
// fire-and-forget fetch mid-air.
const inFlight = new Set<Promise<void>>();

function send(path: '/notify' | '/heartbeat', payload: Record<string, unknown>): void {
  const url = process.env.NOTIFIER_URL;
  const key = process.env.NOTIFIER_KEY;
  if (!url || !key) return; // not configured -> silent no-op

  // Read per-call (not module-load-time) so a test/deploy env change without
  // a process restart is picked up on the very next send.
  const project = process.env.NOTIFIER_PROJECT ?? 'ipodhan';

  const p = (async () => {
    try {
      await fetch(`${url.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({ project, ...payload }),
        signal: AbortSignal.timeout(2000),
      });
    } catch (err) {
      // Owner-alerting must never disturb the scrape run -- log and move on.
      logger.debug(
        { path, error: err instanceof Error ? err.message : String(err) },
        'owner-notify send failed (non-fatal)'
      );
    }
  })();
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

/**
 * Fire-and-forget owner alert -> Notifier's /notify. Notifier routes it to
 * Telegram/WhatsApp/email per its own config.yaml; the same dedupeKey within
 * Notifier's cooldown window is suppressed as a duplicate. Never throws,
 * never blocks the scrape cycle.
 */
export function notifyOwner(
  severity: OwnerSeverity,
  title: string,
  opts: { body?: string; type?: string; dedupeKey?: string } = {}
): void {
  send('/notify', { severity, title, body: opts.body, type: opts.type, dedupeKey: opts.dedupeKey });
}

/**
 * Uptime heartbeat -> Notifier's missed-heartbeat watchdog (dead-man's
 * switch). Call at run-completion only, with the SAME name and
 * intervalMinutes every time -- a crashed or silently-dead cron stops
 * beating, and the watchdog alerts the owner per Notifier's
 * `projects.ipodhan.heartbeats` config. No-ops until NOTIFIER_URL/
 * NOTIFIER_KEY land on the VPS and the Notifier-side heartbeat block is
 * re-armed (see this PR's DEPLOY-AND-RE-ARM section).
 */
export function heartbeat(name: string, intervalMinutes: number): void {
  send('/heartbeat', { name, intervalMinutes });
}

/**
 * Await all in-flight sends (each already bounded by the 2s timeout and
 * guaranteed not to reject). MUST be called before process.exit() in the
 * one-shot scraper CLI so an explicit exit doesn't abort a send mid-air.
 */
export async function flushOwnerNotify(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}
