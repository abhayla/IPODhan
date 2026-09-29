/**
 * §9.2 item 14 (OD-110): MainboardProspectusTable shows the admin Edit link
 * only for a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainboardProspectusTable } from '@/components/prospectus/MainboardProspectusTable';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { MainboardProspectusData } from '@/lib/services/mainboard-prospectus-service';

vi.mock('@/hooks/useAdminSession');

const prospectusData: MainboardProspectusData[] = [
  {
    ipo: {
      id: 'ipo-1',
      companyName: 'Acme Mainboard Co',
      slug: 'acme-mainboard-co',
      segment: 'MAINBOARD',
      offeringType: 'FRESH_ISSUE',
      listingExchanges: ['NSE', 'BSE'],
    },
    drhpDocument: null,
    rhpDocument: null,
  },
];

describe('MainboardProspectusTable — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(
      <MainboardProspectusTable
        prospectusData={prospectusData}
        total={1}
        page={1}
        limit={20}
        documentsAvailableCount={0}
      />
    );
    const links = screen.getAllByTestId('admin-row-edit-link');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/ipos/acme-mainboard-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(
      <MainboardProspectusTable
        prospectusData={prospectusData}
        total={1}
        page={1}
        limit={20}
        documentsAvailableCount={0}
      />
    );
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
