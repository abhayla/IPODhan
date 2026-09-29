/**
 * §9.2 item 14 (OD-110): IPOListingsTable shows the admin Edit link only for
 * a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOListingsTable } from '@/components/listings/IPOListingsTable';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { IPOListingData } from '@/lib/services/ipo-listings-service';

vi.mock('@/hooks/useAdminSession');

function makeListing(overrides: Partial<IPOListingData>): IPOListingData {
  return {
    id: 'ipo-1',
    companyName: 'Acme Listing Co',
    slug: 'acme-listing-co',
    segment: 'MAINBOARD',
    offeringType: 'FRESH_ISSUE',
    openDate: '2026-06-01',
    closeDate: '2026-06-03',
    listingDate: '2026-06-10',
    issuePrice: 100,
    issueSize: 500,
    lotSize: 100,
    allotmentDate: '2026-06-05',
    subscriptionOverall: null,
    subscriptionQIB: null,
    subscriptionNII: null,
    subscriptionRetail: null,
    gmp: null,
    listingDayClosePrice: null,
    listingDayGainPercent: null,
    currentPriceBSE: null,
    currentPriceNSE: null,
    currentGainPercent: null,
    marketCap: null,
    ...overrides,
  };
}

describe('IPOListingsTable — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<IPOListingsTable data={[makeListing({})]} />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-listing-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<IPOListingsTable data={[makeListing({})]} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
