/**
 * §9.2 item 14 (OD-110): SMEPerformanceTrackerClient shows the admin Edit
 * link only for a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { SMEPerformanceTrackerClient } from '@/components/performance/SMEPerformanceTrackerClient';
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
          companyName: 'Real SME Co Ltd',
          slug: 'real-sme-co-ltd',
          segment: 'SME',
          listingDate: '2026-01-10',
          issuePrice: '60.00',
          listingClose: '65.00',
          listingGainPercent: 8.33,
          currentPriceLive: 70.0,
          currentGainLive: 16.67,
        },
      ],
    }),
  });
}

describe('SMEPerformanceTrackerClient — admin edit link', () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn() });
    mockFetchOneRow();
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', async () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<SMEPerformanceTrackerClient initialYear="2026" />);
    await waitFor(() => expect(screen.getByTestId('admin-row-edit-link')).toBeInTheDocument());
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/real-sme-co-ltd?edit=');
  });

  it('renders no Edit link for a reader session', async () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<SMEPerformanceTrackerClient initialYear="2026" />);
    await waitFor(() => expect(screen.getByText('Real SME Co Ltd')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
