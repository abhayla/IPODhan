/**
 * The data job's slots — the ONE definition (item 7 S2).
 *
 * Spec: docs/design/data-sourcing-pull-model.md §2.1, OD-19 (owner, 2026-09-09):
 * "Three runs a day, midnight, eight in the morning, two in the afternoon."
 * The data job is discovery, document download and extraction, and the
 * per-field pull walk. It supersedes D-13's four slots (08:30, 11:00, 14:00,
 * 17:30) and the approved-then-superseded F-42 evening slot (§2.1.2).
 *
 * Every other place that needs these times reads them from here:
 *  - scraper/src/scheduler/due-step-cycle.ts imports it (discovery + document cycle gate);
 *  - packages/shared/src/repositories/ipo-field-plan-repository.ts imports it (reclaim boundary);
 *  - scraper/src/config/freshness-slo.ts derives its NSE/BSE max age from it;
 *  - scripts/lib/field-plan-slot.mjs PARSES this file's text at load (plain Node
 *    cannot import TypeScript), via the same `parseDataJobSlotsFromSource` rule
 *    tested here.
 *
 * Keep the array literal as plain integers on one line: the plain-Node reader
 * refuses anything else rather than guessing.
 *
 * NOT a timer (OD-33): these answer "has a new slot begun since X", never "has
 * N minutes elapsed since X".
 */

/** Minutes since IST midnight: 00:00, 08:00, 14:00 IST. */
export const DATA_JOB_SLOTS_IST_MINUTES = [0, 480, 840] as const;

/** One hour of margin on top of the longest designed gap before a freshness alarm. */
export const DATA_JOB_FRESHNESS_GRACE_MINUTES = 60;

const IST_OFFSET_MINUTES = 5 * 60 + 30;

type SlotList = readonly number[];

/** Absolute minute (since epoch, IST wall-clock aligned) of the most recent slot at-or-before `now`. */
export function mostRecentDataJobSlotEpochMinute(now: Date, slots: SlotList = DATA_JOB_SLOTS_IST_MINUTES): number {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const dayIndex = Math.floor(istMs / 86_400_000);
  const istDate = new Date(istMs);
  const minutesOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  let dueSlot: number | null = null;
  for (const slot of slots) {
    if (minutesOfDay >= slot) dueSlot = slot;
  }
  if (dueSlot === null) return (dayIndex - 1) * 1440 + slots[slots.length - 1];
  return dayIndex * 1440 + dueSlot;
}

/** The most recent slot at-or-before `now`, as an instant. */
export function mostRecentDataJobSlotBoundary(now: Date, slots: SlotList = DATA_JOB_SLOTS_IST_MINUTES): Date {
  const epochMinute = mostRecentDataJobSlotEpochMinute(now, slots);
  return new Date(epochMinute * 60_000 - IST_OFFSET_MINUTES * 60_000);
}

/**
 * Due when the most recent slot at-or-before `now` is strictly after
 * `lastRunAt` (or it never ran). Catch-up safe: a slot missed because the
 * process was down, or whose run did not finish, fires on the next wake.
 */
export function isDataJobDue(now: Date, lastRunAt: Date | null, slots: SlotList = DATA_JOB_SLOTS_IST_MINUTES): boolean {
  if (lastRunAt === null) return true;
  const dueSlotEpochMinute = mostRecentDataJobSlotEpochMinute(now, slots);
  const lastRunIstMinute = Math.floor((lastRunAt.getTime() + IST_OFFSET_MINUTES * 60_000) / 60_000);
  return dueSlotEpochMinute > lastRunIstMinute;
}

/** The longest designed gap between two consecutive slots, wrapping midnight. */
export function longestDataJobSlotGapMinutes(slots: SlotList = DATA_JOB_SLOTS_IST_MINUTES): number {
  let longest = 0;
  for (let i = 0; i < slots.length; i++) {
    const next = i + 1 < slots.length ? slots[i + 1] : slots[0] + 1440;
    longest = Math.max(longest, next - slots[i]);
  }
  return longest;
}

/** How stale a data-job-fed source may be before it pages: longest gap + grace. */
export function dataJobFreshnessMaxAgeMinutes(slots: SlotList = DATA_JOB_SLOTS_IST_MINUTES): number {
  return longestDataJobSlotGapMinutes(slots) + DATA_JOB_FRESHNESS_GRACE_MINUTES;
}

/**
 * Reads DATA_JOB_SLOTS_IST_MINUTES out of this file's source text. Plain
 * integers only; anything else throws. Mirrored (same regex) in
 * scripts/lib/field-plan-slot.mjs, which is how plain Node reads the slots.
 */
export const DATA_JOB_SLOTS_SOURCE_PATTERN = /export const DATA_JOB_SLOTS_IST_MINUTES\s*=\s*\[([\d\s,]+)\]\s*as const;/;

export function parseDataJobSlotsFromSource(source: string): number[] {
  const match = source.match(DATA_JOB_SLOTS_SOURCE_PATTERN);
  if (!match) throw new Error('DATA_JOB_SLOTS_IST_MINUTES not found as a plain-integer literal');
  const slots = match[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0).map(Number);
  if (slots.length === 0 || slots.some((n) => !Number.isInteger(n) || n < 0 || n >= 1440)) {
    throw new Error(`DATA_JOB_SLOTS_IST_MINUTES is not a list of minutes-of-day: [${match[1]}]`);
  }
  return slots;
}
