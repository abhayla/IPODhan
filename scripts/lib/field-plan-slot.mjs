// scripts/lib/field-plan-slot.mjs — #762 (S8): the same discovery-slot
// boundary the claim query keys its reclaim on, for plain-Node checks that
// cannot import TypeScript.
//
// SOURCE OF TRUTH: packages/shared/src/repositories/ipo-field-plan-repository.ts
// (mostRecentFieldPlanSlotBoundary), which itself deliberately duplicates
// scraper/src/scheduler/due-step-cycle.ts's DISCOVERY_SLOTS_IST_MINUTES
// (packages/shared cannot import scraper/src; scraper depends on
// @ipodhan/shared, never the reverse). This file is the SECOND deliberate
// duplicate of the same four slot times, for the same reason
// scripts/lib/ist-day.mjs duplicates packages/shared/src/utils/ist-day.ts —
// plain-Node scripts/*.mjs cannot import TypeScript either. Change the
// TypeScript source first, then mirror it here AND in due-step-cycle.ts.
// scripts/tests/field-plan-slot.test.mjs pins this file's output against a
// parse of the real due-step-cycle.ts source text, so a change to one
// without the other fails CI instead of silently drifting (round-1 review
// MAJOR-3: the previous "drift guard" compared two copies inside the same
// package and could never have caught that).
//
// review round 1 CRITICAL-1: this module exists so
// checkS_pullPlanStuckReclaim (audit-detection-floor.mjs) can ask "has a new
// slot begun since X" instead of a flat interval — the flat `interval '7
// hours'` the first cut used was wrong (the real max gap between two
// consecutive slots is 18.5h, 17:30 IST to 08:30 IST the next day), so the
// check alarmed every night between ~00:30 and ~08:30 IST regardless of
// whether anything was actually stuck.

const FIELD_PLAN_SLOT_IST_MINUTES = [8 * 60 + 30, 11 * 60, 14 * 60, 17 * 60 + 30];
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The most recent slot boundary at-or-before `now`, as a Date. Pure, clock-injectable. */
export function mostRecentFieldPlanSlotBoundary(now = new Date()) {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const dayIndex = Math.floor(istMs / 86_400_000);
  const istDate = new Date(istMs);
  const minutesOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();

  let dueSlotOfDay = null;
  for (const slot of FIELD_PLAN_SLOT_IST_MINUTES) {
    if (minutesOfDay >= slot) dueSlotOfDay = slot;
  }

  const epochMinute =
    dueSlotOfDay === null
      ? (dayIndex - 1) * 1440 + FIELD_PLAN_SLOT_IST_MINUTES[FIELD_PLAN_SLOT_IST_MINUTES.length - 1]
      : dayIndex * 1440 + dueSlotOfDay;

  return new Date(epochMinute * 60_000 - IST_OFFSET_MINUTES * 60_000);
}

export { FIELD_PLAN_SLOT_IST_MINUTES };

/** attempts cap mirrors FIELD_PLAN_RECLAIM_MAX_ATTEMPTS in
 * packages/shared/src/repositories/ipo-field-plan-repository.ts (a
 * partial-index predicate and a plain-Node check cannot share a TS export,
 * so the VALUE is kept equal by hand and pinned by
 * scripts/tests/field-plan-slot.test.mjs). */
export const PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS = 5;

/**
 * #884: mirror of FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS in
 * packages/shared/src/utils/field-plan-config-gap.ts — the recorded causes
 * that are facts about CONFIGURATION (a source ranked with no field mapping,
 * DOC with no documentType, no registered fetcher) or the EXTRACTOR (no
 * document provenance on a COMPLETED document). Legacy free-text shapes. Kept equal by hand and
 * pinned by scripts/tests/field-plan-reclaim-max-attempts-pin.test.mjs.
 */
export const FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS = Object.freeze([
  ':NO_FETCHER_REGISTERED',
  ' has no mapped field for ',
  'no documentType in manifest for this field',
  'DOC column read not implemented for ',
  '(extractor gap or field absent)',
]);

/** #884 review round 1: the prefix recordOutcome stamps on a gap row's cause (FIELD_PLAN_GAP_KEY_PREFIX). */
export const FIELD_PLAN_GAP_KEY_PREFIX = '[gap-key:';

/** #884: a CHECK_FAILED plan row retired at the cap by a configuration or extractor GAP (should be 0 after the repair; a gap is never charged). */
export function isConfigGapAtCapRow(row) {
  if (row.state !== 'CHECK_FAILED') return false;
  if (!(row.attempts >= PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS)) return false;
  const cause = row.cause ?? '';
  if (cause.startsWith(FIELD_PLAN_GAP_KEY_PREFIX)) return true;
  return FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS.some((m) => cause.includes(m));
}

/**
 * #884 review round 2 (MINOR): a gap row is re-asked only when its field's gap
 * key changes (manifest entry content, fetcher coverage, extractor version,
 * or — for NO_DOCUMENT_PROVENANCE — a new COMPLETED document). A row whose key
 * has not changed for this long has no fix in flight for it; the floor names
 * those rows by IPO and field. 14 days: two weekly cycles with no manifest
 * edit, adapter change, extractor bump or new document touching the field.
 */
export const FIELD_PLAN_GAP_STALLED_DAYS = 14;

export function isStalledGapRow(row, now = new Date()) {
  if (row.state !== 'CHECK_FAILED') return false;
  if (!(row.cause ?? '').startsWith(FIELD_PLAN_GAP_KEY_PREFIX)) return false;
  if (row.lastAttemptAt == null) return true;
  const at = row.lastAttemptAt instanceof Date ? row.lastAttemptAt : new Date(row.lastAttemptAt);
  return now.getTime() - at.getTime() > FIELD_PLAN_GAP_STALLED_DAYS * 86_400_000;
}

/**
 * The pure "is this plan row stuck" predicate checkS_pullPlanStuckReclaim
 * (audit-detection-floor.mjs) filters for, extracted so it is unit-testable
 * without a database (review round 1 F6: the check shipped with NO test —
 * nothing would have caught the 7h-vs-18.5h threshold error).
 *
 * A row is stuck when: it is a state the claim query reclaims
 * (NOT_AVAILABLE_YET always, CHECK_FAILED only below the attempts ceiling),
 * it is not currently claimed, AND its last attempt (or the absence of one —
 * F7: NULL is "due since forever", never excluded) is older than TWO slot
 * boundaries back — one slot of lag is normal cadence.
 */
export function isStuckReclaimRow(row, now = new Date()) {
  const reclaimableState =
    row.state === 'NOT_AVAILABLE_YET' ||
    (row.state === 'CHECK_FAILED' && row.attempts < PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS);
  if (!reclaimableState) return false;
  if (row.claimedAt != null) return false;

  const twoSlotsAgo = mostRecentFieldPlanSlotBoundary(mostRecentFieldPlanSlotBoundary(now));
  if (row.lastAttemptAt == null) return true;
  return new Date(row.lastAttemptAt).getTime() < twoSlotsAgo.getTime();
}
