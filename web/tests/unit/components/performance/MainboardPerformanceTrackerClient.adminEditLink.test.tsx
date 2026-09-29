/**
 * §9.2 item 14 (OD-110): MainboardPerformanceTrackerClient shows the admin
 * Edit link only for a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { MainboardPerformanceTrackerClient } from '@/components/performance/MainboardPerformanceTrackerClient';
import { useAdminSession } from '@/hooks/useAdminSession';

vi.mock('@/hooks/useAdminSession');
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

function mockFetchOneRow() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        {
          id: 'real-1',
          companyName: 'Real Mainboard Co Ltd',
          slug: 'real-mainboard-co-ltd',
          segment: 'MAINBOARD',
          listingDate: '2026-01-10',
          issuePrice: '120.00',
          listingClose: '130.50',
          listingGainPercent: 8.75,
          currentPriceLive: 145.2,
          currentGainLive: 21.0,
        },
      ],
    }),
  });
}

describe('MainboardPerformanceTrackerClient — admin edit link', () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn() });
    mockFetchOneRow();
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', async () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<MainboardPerformanceTrackerClient initialYear="2026" />);
    await waitFor(() => expect(screen.getByTestId('admin-row-edit-link')).toBeInTheDocument());
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute(
      'href',
      '/ipos/real-mainboard-co-ltd?edit='
    );
  });

  it('renders no Edit link for a reader session', async () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<MainboardPerformanceTrackerClient initialYear="2026" />);
    await waitFor(() => expect(screen.getByText('Real Mainboard Co Ltd')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
