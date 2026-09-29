/**
 * §9.2 item 14 (OD-110): OFSTable shows the admin Edit link only for a
 * confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OFSTable } from '@/components/ofs/OFSTable';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { OFSData } from '@/lib/services/ofs-service';

vi.mock('@/hooks/useAdminSession');

const ofsIssues: OFSData[] = [
  {
    id: 'ofs-1',
    companyName: 'Acme OFS Co',
    slug: 'acme-ofs-co',
    nonRetailDate: '2026-06-01',
    retailDate: '2026-06-02',
    openDate: '2026-06-01',
    closeDate: '2026-06-02',
    issuePrice: 500,
    issueSize: '300',
    status: 'CLOSED',
    updatedAt: '2026-06-01T10:00:00.000Z',
  },
];

describe('OFSTable — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<OFSTable ofsIssues={ofsIssues} />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-ofs-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<OFSTable ofsIssues={ofsIssues} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
