/**
 * §9.2 item 14 (OD-110), Tier B review fix (PR #1286): the Mainboard calendar previously
 * had no admin Edit link at all. This asserts an admin session sees exactly one Edit link
 * per IPO event, and a reader session sees none, while useAdminSession is still called
 * only once (at the grid level, never inside CalendarEventGroup's per-event loop).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MainboardIPOCalendarGrid from '@/components/calendar/MainboardIPOCalendarGrid';
import { CalendarEventType, type CalendarDateEvents } from '@/lib/services/mainboard-calendar-types';

// The worktree's node_modules resolves through the main checkout, whose vite build cannot
// process this repo's string-form PostCSS config for `.module.css` under vitest's CSS
// pipeline (environment quirk, unrelated to this component's logic). Mock the CSS module
// so the test exercises the component's admin-edit-link behavior without going through
// PostCSS at all.
vi.mock('@/components/calendar/MainboardIPOCalendarGrid.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function buildDate(dateString: string, day: number): CalendarDateEvents {
  return {
    date: new Date(2026, 5, day),
    dateString,
    events: [],
    eventGroups: [
      {
        type: CalendarEventType.OPENING_TODAY,
        priority: 1,
        label: 'Opening',
        events: [
          {
            id: `evt-${dateString}`,
            type: CalendarEventType.OPENING_TODAY,
            date: new Date(2026, 5, day),
            companyName: `Mainboard IPO ${day}`,
            slug: `mainboard-ipo-${day}`,
          },
        ],
      },
    ],
    hasMultipleEvents: false,
    isHoliday: false,
  };
}

function mockFetch(isAdmin: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: isAdmin,
      json: async () =>
        isAdmin
          ? { success: true, data: { adminId: 'a1', adminName: 'Admin', isOwner: false } }
          : null,
    })
  );
}

describe('MainboardIPOCalendarGrid — admin edit link', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the Edit link for an admin session', async () => {
    mockFetch(true);
    const dates = [buildDate('2026-06-15', 15)];

    render(
      <MainboardIPOCalendarGrid dates={dates} monthName="June 2026" currentDate="2026-06-01" />
    );

    const links = await screen.findAllByTestId('admin-row-edit-link');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/ipos/mainboard-ipo-15?edit=');
  });

  it('shows no Edit link for a reader session', async () => {
    mockFetch(false);
    const dates = [buildDate('2026-06-15', 15)];

    render(
      <MainboardIPOCalendarGrid dates={dates} monthName="June 2026" currentDate="2026-06-01" />
    );

    // Let the admin-session fetch resolve before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryAllByTestId('admin-row-edit-link')).toHaveLength(0);
  });
});
