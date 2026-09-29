/**
 * §9.2 item 14 (OD-110): ListingIndexClient's company column shows the admin
 * Edit link only for a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';
import { ListingIndexClient } from '@/components/listing/ListingIndexClient';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { IPO } from '@/lib/db/types';

vi.mock('@/hooks/useAdminSession');
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

const ipo = {
  id: 'ipo-1',
  slug: 'acme-index-co',
  companyName: 'Acme Index Co',
  status: 'OPEN',
  openDate: '2026-06-01',
  closeDate: '2026-06-05',
  listingDate: null,
  segment: 'MAINBOARD',
  offeringType: 'FRESH_ISSUE',
  sector: null,
} as unknown as IPO;

describe('ListingIndexClient — admin edit link', () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn(), replace: vi.fn() });
    (usePathname as unknown as ReturnType<typeof vi.fn>).mockReturnValue('/ipos');
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(
      <ListingIndexClient
        segmentLabel="Mainboard"
        data={[ipo]}
        allTimeTotal={1}
        gainsMap={{}}
        liveMetricsMap={{}}
        initialYear={2026}
        asOf="2026-06-01T00:00:00.000Z"
      />
    );
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-index-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(
      <ListingIndexClient
        segmentLabel="Mainboard"
        data={[ipo]}
        allTimeTotal={1}
        gainsMap={{}}
        liveMetricsMap={{}}
        initialYear={2026}
        asOf="2026-06-01T00:00:00.000Z"
      />
    );
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
