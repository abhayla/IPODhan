// scripts/lib/field-plan-slot.mjs — #762 (S8): the same slot boundary the
// claim query keys its reclaim on, for plain-Node checks that cannot import
// TypeScript.
//
// Item 7 S2: the slots are the data job's OD-19 slots (00:00, 08:00, 14:00 IST),
// defined ONCE in packages/shared/src/scheduler/data-job-slots.ts. This file
// keeps NO copy: it READS that file's text at load and parses the literal with
// the same plain-integer rule as `parseDataJobSlotsFromSource` there. A shape
// it cannot parse throws at import, so the nightly floor fails loudly instead
// of reasoning about the wrong slots. The release directory carries
// packages/shared/src (deploy-linux.sh compiles it in place), so the path
// resolves on the box as it does in CI.
//
// review round 1 CRITICAL-1 (history): this module exists so
// checkS_pullPlanStuckReclaim (audit-detection-floor.mjs) asks "has a new slot
// begun since X" instead of a flat interval; a flat threshold alarmed every
// night because the real gap between slots is longer than it assumed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const DATA_JOB_SLOTS_SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'scheduler',
  'data-job-slots.ts'
);

const SLOTS_PATTERN = /export const DATA_JOB_SLOTS_IST_MINUTES\s*=\s*\[([\d\s,]+)\]\s*as const;/;

/** Same rule as parseDataJobSlotsFromSource in data-job-slots.ts: plain integers 0..1439 or throw. */
export function parseDataJobSlotsFromSource(source) {
  const match = source.match(SLOTS_PATTERN);
  if (!match) throw new Error('DATA_JOB_SLOTS_IST_MINUTES not found as a plain-integer literal');
  const slots = match[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0).map(Number);
  if (slots.length === 0 || slots.some((n) => !Number.isInteger(n) || n < 0 || n >= 1440)) {
    throw new Error(`DATA_JOB_SLOTS_IST_MINUTES is not a list of minutes-of-day: [${match[1]}]`);
  }
  return slots;
}

const FIELD_PLAN_SLOT_IST_MINUTES = Object.freeze(
  parseDataJobSlotsFromSource(readFileSync(DATA_JOB_SLOTS_SOURCE_PATH, 'utf8'))
);
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
