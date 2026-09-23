// implements: #762 (S8) -- pure slot-boundary math the claim-query reclaim
// triggers key on. Item 7 S2: the slot list is READ from its one definition
// (packages/shared/src/scheduler/data-job-slots.ts, OD-19), never retyped
// here -- the old test compared a typed copy against another typed copy and
// could not catch drift.
import { describe, it, expect } from 'vitest';
import { mostRecentFieldPlanSlotBoundary } from './ipo-field-plan-repository';
import { DATA_JOB_SLOTS_IST_MINUTES } from '../scheduler/data-job-slots';

function istToUtc(dateIso: string, hh: number, mm: number): Date {
  // dateIso "YYYY-MM-DD" in IST -> the UTC instant for HH:MM that IST day.
  const utcMs = Date.parse(`${dateIso}T00:00:00.000Z`) + (hh * 60 + mm - 5 * 60 - 30) * 60_000;
  return new Date(utcMs);
}

describe('mostRecentFieldPlanSlotBoundary (#762, OD-19 slots)', () => {
  it('lands exactly on each data-job slot from the one definition', () => {
    expect([...DATA_JOB_SLOTS_IST_MINUTES]).toEqual([0, 480, 840]);
    for (const slotMinutes of DATA_JOB_SLOTS_IST_MINUTES) {
      const now = istToUtc('2026-09-15', Math.floor(slotMinutes / 60), slotMinutes % 60);
      expect(mostRecentFieldPlanSlotBoundary(now).getTime()).toBe(now.getTime());
    }
  });

  it('the retired D-13 minutes (08:30, 11:00, 17:30) are NOT boundaries any more', () => {
    expect(mostRecentFieldPlanSlotBoundary(istToUtc('2026-09-15', 8, 30)).getTime()).toBe(istToUtc('2026-09-15', 8, 0).getTime());
    expect(mostRecentFieldPlanSlotBoundary(istToUtc('2026-09-15', 11, 0)).getTime()).toBe(istToUtc('2026-09-15', 8, 0).getTime());
    expect(mostRecentFieldPlanSlotBoundary(istToUtc('2026-09-15', 17, 30)).getTime()).toBe(istToUtc('2026-09-15', 14, 0).getTime());
  });

  it('just after midnight returns that day\'s 00:00 slot', () => {
    expect(mostRecentFieldPlanSlotBoundary(istToUtc('2026-09-15', 0, 1)).getTime()).toBe(istToUtc('2026-09-15', 0, 0).getTime());
  });

  it('after the last slot of the day, returns that day\'s 14:00 slot', () => {
    expect(mostRecentFieldPlanSlotBoundary(istToUtc('2026-09-15', 23, 0)).getTime()).toBe(istToUtc('2026-09-15', 14, 0).getTime());
  });

  it('is a pure function of the instant, never today\'s wall-clock date', () => {
    const a = mostRecentFieldPlanSlotBoundary(istToUtc('2020-01-01', 9, 0));
    const b = mostRecentFieldPlanSlotBoundary(istToUtc('2020-01-01', 9, 0));
    expect(a.getTime()).toBe(b.getTime());
  });
});
