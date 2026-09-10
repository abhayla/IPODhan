/**
 * Which IPOs did this cycle actually WRITE to?
 *
 * OD-40 ends a cycle by calling one authenticated endpoint with the touched
 * slugs, so the pages that changed refresh now instead of waiting out two
 * independent cache timers. The design assumes something already collects those
 * slugs. Nothing did: `grep -rn "touchedSlugs|recordTouched|drainTouched"
 * scraper/src` returned nothing before this slice.
 *
 * The load-bearing rule is the NEGATIVE one. A re-verify that rewrote nothing
 * must not appear in this list. If it did, every cycle would report every IPO,
 * the endpoint would refresh all of them, and the reason for doing this at all —
 * a correction reaching the reader quickly BECAUSE only real corrections are
 * sent — would be gone. A list that always contains everything carries no
 * information. §2.5.2's "a re-ask must not rewrite an unchanged value" is the
 * same rule one layer down; this reuses its signal rather than redefining it.
 *
 * Scope, stated so nobody mistakes it for durability: this is an in-process Set.
 * A scraper that crashes after writing but before the revalidate step loses that
 * cycle's list, and those pages simply wait out their timed revalidate — which
 * is exactly today's behaviour, so the failure mode is the status quo, not a
 * regression.
 */

import { logger } from '../utils/logger.js';

/**
 * A bound on a leak with a named cause, not a correctness rule. Only the
 * all-sources cycle drains this; a `--source=bse` run records and never drains,
 * so in a long-lived watch process the set would grow for the life of the
 * process. One cycle touches a few hundred IPOs at most, so this cap is far
 * above any real cycle and only ever trips on the leak it exists to bound.
 */
export const TOUCHED_SLUG_CAP = 5000;

const touched = new Set<string>();
let capWarned = false;

/** The subset of ConsolidatedUpsertResult this decision actually reads. */
export interface TouchedDecisionInput {
  skipped: boolean;
  isNew: boolean;
  skipReason?: string;
  consolidation?: { fieldsUpdated?: number; fieldsProcessed?: number };
}

export function recordTouched(slug: string): void {
  if (typeof slug !== 'string' || slug.trim() === '') return;
  if (touched.size >= TOUCHED_SLUG_CAP) {
    if (!capWarned) {
      capWarned = true;
      logger.warn(
        { cap: TOUCHED_SLUG_CAP },
        '[TouchedIPOs] cap reached - this process is recording touched IPOs and never draining them, ' +
          'which happens when the cycle that calls the revalidate step is not the one running'
      );
    }
    return;
  }
  touched.add(slug);
}

/**
 * True only when this write actually changed what a reader would see.
 *
 * `skipped` covers both a lock miss and an error return, neither of which wrote
 * anything. An absent `consolidation` is absence of information (the
 * CONSOLIDATION_DISABLED path returns none) and is deliberately read as "no
 * change" — reading it as "changed" would refresh every page on a flag-off
 * cycle, which is the always-everything failure this module exists to avoid.
 */
export function recordTouchedIfChanged(slug: string, result: TouchedDecisionInput): void {
  if (result.skipped) return;
  const changed = result.isNew || (result.consolidation?.fieldsUpdated ?? 0) > 0;
  if (!changed) return;
  recordTouched(slug);
}

/** Empties the set and returns what it held. Always an array, never null. */
export function drainTouched(): string[] {
  const slugs = Array.from(touched);
  touched.clear();
  capWarned = false;
  return slugs;
}
