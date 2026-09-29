/**
 * §9.2 item 14 (OD-110), Tier B review fix (PR #1286): a calendar page must make at most
 * ONE /api/admin/auth/me request per page load, no matter how many events it renders.
 * useAdminSession is called once at the grid level and isAdmin is passed down to every
 * CalendarEvent leaf — never called inside the per-event loop.
 *
 * This test is the CORE proof: render the SME calendar grid with 30 events and assert
 * fetch('/api/admin/auth/me') was called exactly once.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SMEIPOCalendarGrid } from '@/components/calendar/SMEIPOCalendarGrid';
import type { CalendarDay, CalendarEvent } from '@/lib/services/sme-calendar-service';

function buildDayWithEvents(day: number, eventCount: number): CalendarDay {
  const events: CalendarEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    date: new Date(2026, 5, day),
    eventType: 'OPEN',
    slug: `sme-cal-ipo-${day}-${i}`,
    description: 'Opens',
    ipo: { companyName: `SME Cal IPO ${day}-${i}` } as CalendarEvent['ipo'],
  }));

  return {
    date: new Date(2026, 5, day),
    events,
    isCurrentMonth: true,
    isToday: false,
    isWeekend: false,
  };
}

describe('SMEIPOCalendarGrid — admin session call count', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { adminId: 'a1', adminName: 'Admin', isOwner: false } }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches /api/admin/auth/me exactly once for a grid rendering 30 events', () => {
    // 30 events spread across 6 days (5 events/day) — well over one page's worth of rows.
    const calendarDays: CalendarDay[] = Array.from({ length: 6 }, (_, i) => buildDayWithEvents(i + 1, 5));

    render(
      <SMEIPOCalendarGrid calendarDays={calendarDays} currentMonth={6} currentYear={2026} />
    );

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const adminMeCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === '/api/admin/auth/me'
    );
    expect(adminMeCalls).toHaveLength(1);
  });
});
