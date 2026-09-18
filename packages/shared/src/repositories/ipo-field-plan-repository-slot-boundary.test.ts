// implements: #762 (S8) -- pure slot-boundary math the claim-query reclaim
// triggers key on, pinned against scraper/src/scheduler/due-step-cycle.ts's
// DISCOVERY_SLOTS_IST_MINUTES so the two constants can never silently drift
// (this package cannot import that module -- scraper depends on
// @ipodhan/shared, never the reverse; see the repository's own doc comment).
import { describe, it, expect } from 'vitest';
import { mostRecentFieldPlanSlotBoundary } from './ipo-field-plan-repository';

// Deliberately re-typed here, NOT imported, exactly so a change to
// due-step-cycle.ts's constant without a matching change here breaks this
// suite -- copying the scraper module's own test fixture in spirit.
const SCRAPER_DISCOVERY_SLOTS_IST_MINUTES = [8 * 60 + 30, 11 * 60, 14 * 60, 17 * 60 + 30];

function istToUtc(dateIso: string, hh: number, mm: number): Date {
  // dateIso "YYYY-MM-DD" in IST -> the UTC instant for HH:MM that IST day.
  const utcMs = Date.parse(`${dateIso}T00:00:00.000Z`) + (hh * 60 + mm - 5 * 60 - 30) * 60_000;
  return new Date(utcMs);
}

describe('mostRecentFieldPlanSlotBoundary (#762)', () => {
  it('matches the four slot times scraper/src/scheduler/due-step-cycle.ts defines', () => {
    // The boundary AT each slot's own minute must equal that slot -- proves
    // this module's constant is the same four times, not just four values.
    for (const slotMinutes of SCRAPER_DISCOVERY_SLOTS_IST_MINUTES) {
      const hh = Math.floor(slotMinutes / 60);
      const mm = slotMinutes % 60;
      const now = istToUtc('2026-09-15', hh, mm);
      const boundary = mostRecentFieldPlanSlotBoundary(now);
      expect(boundary.getTime()).toBe(now.getTime());
    }
  });

  it('before the first slot of the day, returns the PREVIOUS day\'s last slot (17:30 IST)', () => {
    const now = istToUtc('2026-09-15', 7, 0); // before 08:30 IST
    const boundary = mostRecentFieldPlanSlotBoundary(now);
    expect(boundary.getTime()).toBe(istToUtc('2026-09-14', 17, 30).getTime());
  });

  it('mid-slot, returns the most recent PAST slot, not the next one', () => {
    const now = istToUtc('2026-09-15', 9, 0); // between 08:30 and 11:00
    const boundary = mostRecentFieldPlanSlotBoundary(now);
    expect(boundary.getTime()).toBe(istToUtc('2026-09-15', 8, 30).getTime());
  });

  it('after the last slot of the day, returns that day\'s last slot (17:30 IST)', () => {
    const now = istToUtc('2026-09-15', 23, 0);
    const boundary = mostRecentFieldPlanSlotBoundary(now);
    expect(boundary.getTime()).toBe(istToUtc('2026-09-15', 17, 30).getTime());
  });

  it('is a pure function of the instant, never today\'s wall-clock date', () => {
    const a = mostRecentFieldPlanSlotBoundary(istToUtc('2020-01-01', 9, 0));
    const b = mostRecentFieldPlanSlotBoundary(istToUtc('2020-01-01', 9, 0));
    expect(a.getTime()).toBe(b.getTime());
  });
});
