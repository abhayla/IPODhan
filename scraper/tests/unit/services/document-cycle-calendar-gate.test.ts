/**
 * Cadence D-13: the document cycle's calendar gate.
 *
 * Red-then-green: before this file's source module existed, the document
 * cycle ran full network discovery for CLOSED/LISTED/WITHDRAWN candidates on
 * every wake including Sundays/Saturdays/NSE holidays — these tests fail
 * against that behavior and pass once `computeCalendarGate` gates it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  weekendGateReason,
  computeCalendarGate,
  CALENDAR_GATE_ELIGIBLE_STAGES,
  type HolidayLookup,
} from '../../../src/services/document-cycle-calendar-gate.js';

// IST = UTC+5:30. Each literal below is a UTC instant landing well inside its
// intended IST calendar day (clear of the midnight boundary either way).

describe('weekendGateReason — pure IST weekday check (due-step-cycle.ts SSOT)', () => {
  it('flags Sunday', () => {
    // 2026-08-30 is a Sunday.
    expect(weekendGateReason(new Date('2026-08-30T08:00:00.000Z'))).toBe('sunday');
  });

  it('flags Saturday', () => {
    // 2026-08-29 is a Saturday.
    expect(weekendGateReason(new Date('2026-08-29T08:00:00.000Z'))).toBe('saturday');
  });

  it('does not flag a Monday', () => {
    // 2026-08-31 is a Monday.
    expect(weekendGateReason(new Date('2026-08-31T08:00:00.000Z'))).toBeNull();
  });
});

describe('computeCalendarGate', () => {
  const neverCalledHolidayLookup: HolidayLookup = {
    isHoliday: vi.fn().mockRejectedValue(new Error('should never be called on a weekend')),
  };

  it('gates on Sunday WITHOUT calling the holiday lookup (weekend check is free)', async () => {
    const result = await computeCalendarGate(
      new Date('2026-08-30T08:00:00.000Z'),
      neverCalledHolidayLookup
    );
    expect(result).toEqual({ gated: true, reason: 'sunday' });
    expect(neverCalledHolidayLookup.isHoliday).not.toHaveBeenCalled();
  });

  it('gates on Saturday', async () => {
    const result = await computeCalendarGate(
      new Date('2026-08-29T08:00:00.000Z'),
      neverCalledHolidayLookup
    );
    expect(result).toEqual({ gated: true, reason: 'saturday' });
  });

  it('gates on a weekday NSE holiday', async () => {
    const holidayLookup: HolidayLookup = { isHoliday: vi.fn().mockResolvedValue(true) };
    const result = await computeCalendarGate(new Date('2026-08-31T08:00:00.000Z'), holidayLookup);
    expect(result).toEqual({ gated: true, reason: 'holiday' });
    expect(holidayLookup.isHoliday).toHaveBeenCalledWith('2026-08-31');
  });

  it('does not gate a normal weekday with no holiday', async () => {
    const holidayLookup: HolidayLookup = { isHoliday: vi.fn().mockResolvedValue(false) };
    const result = await computeCalendarGate(new Date('2026-08-31T08:00:00.000Z'), holidayLookup);
    expect(result).toEqual({ gated: false, reason: null });
  });

  it('fails OPEN when the holiday lookup throws — a lookup outage must never gate a real trading day', async () => {
    const holidayLookup: HolidayLookup = { isHoliday: vi.fn().mockRejectedValue(new Error('db down')) };
    const result = await computeCalendarGate(new Date('2026-08-31T08:00:00.000Z'), holidayLookup);
    expect(result).toEqual({ gated: false, reason: null });
  });
});

describe('CALENDAR_GATE_ELIGIBLE_STAGES', () => {
  it('keeps UPCOMING/PRE_OPEN/OPEN eligible and excludes CLOSED/LISTED', () => {
    expect(CALENDAR_GATE_ELIGIBLE_STAGES.has('UPCOMING')).toBe(true);
    expect(CALENDAR_GATE_ELIGIBLE_STAGES.has('PRE_OPEN')).toBe(true);
    expect(CALENDAR_GATE_ELIGIBLE_STAGES.has('OPEN')).toBe(true);
    expect(CALENDAR_GATE_ELIGIBLE_STAGES.has('CLOSED')).toBe(false);
    expect(CALENDAR_GATE_ELIGIBLE_STAGES.has('LISTED')).toBe(false);
  });
});
