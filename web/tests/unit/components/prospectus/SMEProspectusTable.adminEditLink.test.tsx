/**
 * §9.2 item 14 (OD-110): SMEProspectusTable shows the admin Edit link only
 * for a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SMEProspectusTable } from '@/components/prospectus/SMEProspectusTable';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { SMEProspectusData } from '@/lib/services/sme-prospectus-service';

vi.mock('@/hooks/useAdminSession');

const prospectusData: SMEProspectusData[] = [
  {
    ipo: {
      id: 'ipo-1',
      companyName: 'Acme SME Co',
      slug: 'acme-sme-co',
      segment: 'SME',
      offeringType: 'FRESH_ISSUE',
      listingExchanges: ['NSE'],
    },
    drhpDocument: null,
    rhpDocument: null,
  },
];

describe('SMEProspectusTable — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<SMEProspectusTable prospectusData={prospectusData} total={1} page={1} limit={20} />);
    const links = screen.getAllByTestId('admin-row-edit-link');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/ipos/acme-sme-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<SMEProspectusTable prospectusData={prospectusData} total={1} page={1} limit={20} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
