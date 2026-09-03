/**
 * S-02 §5: pure decision logic for the "due-step" cycle
 * (`ENABLE_DUE_STEP_SCHEDULER`). Every function here is a deterministic,
 * clock-injectable predicate — no I/O — so the slot/market-hours arithmetic
 * can be unit-tested without a fake clock hack on the process timezone.
 *
 * IST is a fixed UTC+5:30 offset (no DST) — all "IST" comparisons below
 * compute IST wall-clock minutes from the (timezone-agnostic) epoch instant
 * rather than depending on the process's local timezone.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Minutes-since-midnight-IST for each daily discovery slot: 08:30, 11:00, 14:00, 17:30. */
export const DISCOVERY_SLOTS_IST_MINUTES = [8 * 60 + 30, 11 * 60, 14 * 60, 17 * 60 + 30] as const;

interface IstClock {
  /** Days since the Unix epoch, in IST. */
  dayIndex: number;
  /** Minutes since IST midnight (0-1439). */
  minutesOfDay: number;
  /** 0 = Sunday .. 6 = Saturday, in IST. */
  weekday: number;
}

function toIstClock(now: Date): IstClock {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const istDate = new Date(istMs);
  const dayIndex = Math.floor(istMs / 86_400_000);
  const minutesOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  const weekday = istDate.getUTCDay();
  return { dayIndex, minutesOfDay, weekday };
}

/** Absolute minute (since epoch, IST-aligned) of the most recent discovery slot at-or-before `now`. */
export function mostRecentDiscoverySlotEpochMinute(now: Date): number | null {
  const { dayIndex, minutesOfDay } = toIstClock(now);
  let dueSlot: number | null = null;
  for (const slot of DISCOVERY_SLOTS_IST_MINUTES) {
    if (minutesOfDay >= slot) dueSlot = slot;
  }
  if (dueSlot === null) {
    // Before today's first slot -> the most recent slot was yesterday's last one.
    const lastSlotYesterday = DISCOVERY_SLOTS_IST_MINUTES[DISCOVERY_SLOTS_IST_MINUTES.length - 1];
    return (dayIndex - 1) * 1440 + lastSlotYesterday;
  }
  return dayIndex * 1440 + dueSlot;
}

/** Human-readable "HH:MM IST" label for a discovery slot, for logging. */
export function formatIstSlot(slotMinutesOfDay: number): string {
  const h = Math.floor(slotMinutesOfDay / 60);
  const m = slotMinutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} IST`;
}

/**
 * Discovery is due when the most recent slot boundary at-or-before `now` is
 * strictly after `lastRunAt` (or `lastRunAt` is null — never run before).
 * This is catch-up-safe: a missed slot (process down, slow prior cycle)
 * still fires on the next cycle that observes it, instead of waiting for the
 * same slot tomorrow.
 */
export function isDiscoveryDue(now: Date, lastRunAt: Date | null): boolean {
  const dueSlotEpochMinute = mostRecentDiscoverySlotEpochMinute(now);
  if (dueSlotEpochMinute === null) return true;
  if (lastRunAt === null) return true;
  const lastRunIstMinute = Math.floor((lastRunAt.getTime() + IST_OFFSET_MINUTES * 60_000) / 60_000);
  return dueSlotEpochMinute > lastRunIstMinute;
}

/** For logging: the slot-of-day label the most recent due boundary corresponds to. */
export function mostRecentDiscoverySlotLabel(now: Date): string {
  const epochMinute = mostRecentDiscoverySlotEpochMinute(now);
  if (epochMinute === null) return 'unknown';
  const slotOfDay = ((epochMinute % 1440) + 1440) % 1440;
  return formatIstSlot(slotOfDay);
}

/** Weekday market hours: Mon-Fri (IST weekday 1-5), 10:00-17:00 IST inclusive-start/exclusive-end. */
export function isMarketHoursIST(now: Date): boolean {
  const { weekday, minutesOfDay } = toIstClock(now);
  const isWeekday = weekday >= 1 && weekday <= 5;
  const inWindow = minutesOfDay >= 10 * 60 && minutesOfDay < 17 * 60;
  return isWeekday && inWindow;
}
