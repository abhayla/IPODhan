/**
 * §9.2 item 14 (OD-110): CalendarEvent shows the admin Edit link only for a
 * confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarEvent } from '@/components/calendar/CalendarEvent';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { CalendarEvent as CalendarEventData } from '@/lib/services/sme-calendar-service';

vi.mock('@/hooks/useAdminSession');

const event: CalendarEventData = {
  date: new Date('2026-06-01'),
  eventType: 'OPEN',
  slug: 'acme-cal-ipo',
  description: 'Opens',
  ipo: { companyName: 'Acme Cal IPO' } as CalendarEventData['ipo'],
};

describe('CalendarEvent — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<CalendarEvent event={event} />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-cal-ipo?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<CalendarEvent event={event} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });

  it('renders no Edit link for a HOLIDAY event even for an admin (no slug row to edit)', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(
      <CalendarEvent
        event={{ date: new Date('2026-06-01'), eventType: 'HOLIDAY', description: 'Market Holiday' }}
      />
    );
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
