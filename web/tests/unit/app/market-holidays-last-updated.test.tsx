/**
 * Unit test for MarketHolidaysPage's "Last updated" derivation (T-302 / P2-5,
 * F3 rework).
 *
 * F3 (T-302C checker finding): P2-5 shipped with no test though the DoD
 * explicitly required one ("'Last updated' derives from the DATA (max
 * updated_at), never new Date(); test."). This locks the behaviour: the
 * rendered "Last updated" date must be the MAX `updatedAt` across the fetched
 * holiday rows, not the page's render/request time.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MarketHolidaysPage from '@/app/market-holidays/page';

describe('MarketHolidaysPage — "Last updated"', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('derives "Last updated" from the max holiday updatedAt in the fetched data, not the current render time', async () => {
    // Real "now" (test run date) is far later than any row's updatedAt below —
    // if the label ever fell back to `new Date()` this assertion would catch
    // it immediately. (Fake timers are deliberately NOT used here: they stall
    // `waitFor`'s internal polling, which relies on real timers.)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        holidays: [
          {
            id: 'h1',
            date: '2026-01-26',
            description: 'Republic Day',
            exchange: 'BOTH',
            type: 'TRADING',
            year: 2026,
            updatedAt: '2025-10-13T14:37:01.000Z', // earlier row
          },
          {
            id: 'h2',
            date: '2026-08-15',
            description: 'Independence Day',
            exchange: 'BOTH',
            type: 'TRADING',
            year: 2026,
            updatedAt: '2025-10-13T14:37:01.000Z', // max across rows
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<MarketHolidaysPage />);

    // The memo derives from data fetched over `fetch`, which resolves
    // asynchronously — wait for the label to appear.
    await waitFor(() => {
      expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    });

    // Rendered as `DD MMM YYYY` in Asia/Kolkata — 2025-10-13T14:37:01Z is
    // 13 Oct 2025 IST. This is the max `updatedAt` across the fetched rows;
    // a `new Date()` regression would show today's date instead.
    const today = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    expect(screen.getByText(/Last updated: 13 Oct 2025/)).toBeInTheDocument();
    expect(screen.queryByText(`Last updated: ${today}`)).not.toBeInTheDocument();
  });

  it('renders no "Last updated" label when no holiday carries an updatedAt', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        holidays: [
          {
            id: 'h1',
            date: '2026-01-26',
            description: 'Republic Day',
            exchange: 'BOTH',
            type: 'TRADING',
            year: 2026,
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<MarketHolidaysPage />);

    await waitFor(() => {
      expect(screen.getByText('Republic Day')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
  });
});
