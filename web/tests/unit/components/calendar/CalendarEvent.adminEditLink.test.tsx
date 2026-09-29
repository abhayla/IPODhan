/**
 * §9.2 item 14 (OD-110): CalendarEvent shows the admin Edit link only when the calendar
 * grid that renders it (in a loop) passes isAdmin={true} down as a prop. CalendarEvent
 * itself must never call useAdminSession — doing so inside a per-event loop would fire
 * one /api/admin/auth/me request per rendered event (Tier B review, PR #1286).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarEvent } from '@/components/calendar/CalendarEvent';
import type { CalendarEvent as CalendarEventData } from '@/lib/services/sme-calendar-service';

const event: CalendarEventData = {
  date: new Date('2026-06-01'),
  eventType: 'OPEN',
  slug: 'acme-cal-ipo',
  description: 'Opens',
  ipo: { companyName: 'Acme Cal IPO' } as CalendarEventData['ipo'],
};

describe('CalendarEvent — admin edit link', () => {
  it('renders the Edit link when isAdmin=true is passed down', () => {
    render(<CalendarEvent event={event} isAdmin />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-cal-ipo?edit=');
  });

  it('renders no Edit link when isAdmin=false is passed down', () => {
    render(<CalendarEvent event={event} isAdmin={false} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });

  it('renders no Edit link for a HOLIDAY event even when isAdmin=true (no slug row to edit)', () => {
    render(
      <CalendarEvent
        event={{ date: new Date('2026-06-01'), eventType: 'HOLIDAY', description: 'Market Holiday' }}
        isAdmin
      />
    );
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
