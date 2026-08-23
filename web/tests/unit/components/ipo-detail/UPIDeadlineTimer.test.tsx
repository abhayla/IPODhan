/**
 * Unit tests for UPIDeadlineTimer (T-302 / P2-9)
 *
 * Two bugs under test:
 * 1. Server/first-render honesty — the timer must show the CORRECT state on
 *    the very first render (no client-only useEffect needed to "fix" it up
 *    after mount). The old implementation initialized timeLeft to 0 and only
 *    computed the real value inside useEffect, so every server render (and
 *    the pre-hydration client render) showed "UPI bidding closed" even for a
 *    genuinely OPEN IPO with time remaining.
 * 2. IST-anchored cutoff — the 5 PM cutoff must be computed in India Standard
 *    Time regardless of the viewer's local timezone. The old implementation
 *    built the cutoff via date-fns `set()` on a `parseISO` Date, which applies
 *    the hour/minute in the browser's LOCAL timezone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UPIDeadlineTimer } from '@/components/ipo-detail/UPIDeadlineTimer';

const ORIGINAL_TZ = process.env.TZ;

function setTz(tz: string) {
  process.env.TZ = tz;
}

describe('UPIDeadlineTimer', () => {
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
  });

  describe('First-render honesty (no client-only useEffect required)', () => {
    beforeEach(() => {
      setTz('Asia/Kolkata');
    });

    it('shows real time remaining on the FIRST render for an OPEN IPO, not "UPI bidding closed"', () => {
      // "Now" = 2025-01-14T10:00:00 IST; cutoff = 2025-01-15T17:00:00 IST -> 31h left (>24h -> 'Open')
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-14T04:30:00.000Z')); // 10:00 IST, day before

      render(<UPIDeadlineTimer closeDate="2025-01-15" status="OPEN" />);

      // Assert on the very first synchronous render output — no timers advanced,
      // no effect flushed. If this were still initialized to 0, this would fail.
      expect(screen.queryByText('UPI bidding closed')).not.toBeInTheDocument();
      expect(screen.getByText(/1d/)).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
    });

    it('shows "UPI bidding closed" when genuinely past the IST cutoff', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z')); // 17:30 IST — past 17:00 cutoff

      render(<UPIDeadlineTimer closeDate="2025-01-15" status="OPEN" />);

      expect(screen.getByText('UPI bidding closed')).toBeInTheDocument();
      expect(screen.getByText('Closed')).toBeInTheDocument();
    });
  });

  describe('IST-anchored cutoff (timezone-independent)', () => {
    it('treats the cutoff as 5 PM IST even when the viewer is in a different timezone', () => {
      // Viewer machine is US Pacific. Correct (IST) cutoff for 2025-01-15 is
      // 2025-01-15T11:30:00Z (17:00 IST = UTC+5:30). "Now" is set just after
      // that correct cutoff but many hours before the WRONG "5pm Pacific"
      // cutoff a local-timezone bug would compute (~2025-01-16T01:00Z).
      setTz('America/Los_Angeles');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

      render(<UPIDeadlineTimer closeDate="2025-01-15" status="OPEN" />);

      // A timezone-correct implementation is already past the IST cutoff.
      expect(screen.getByText('UPI bidding closed')).toBeInTheDocument();
      expect(screen.getByText('Closed')).toBeInTheDocument();
    });

    it('shows the IST cutoff label regardless of viewer timezone', () => {
      setTz('America/Los_Angeles');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-15T04:30:00.000Z')); // 10:00 IST, well before cutoff

      render(<UPIDeadlineTimer closeDate="2025-01-15" status="OPEN" />);

      expect(screen.getByText(/IST/)).toBeInTheDocument();
    });
  });

  describe('Non-OPEN status', () => {
    it('renders nothing for an UPCOMING IPO', () => {
      setTz('Asia/Kolkata');
      const { container } = render(
        <UPIDeadlineTimer closeDate="2025-01-15" status="UPCOMING" />
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a CLOSED IPO', () => {
      setTz('Asia/Kolkata');
      const { container } = render(
        <UPIDeadlineTimer closeDate="2025-01-15" status="CLOSED" />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});
