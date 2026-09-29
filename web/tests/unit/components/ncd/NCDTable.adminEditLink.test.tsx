/**
 * §9.2 item 14 (OD-110): NCDTable shows the admin Edit link only for a
 * confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NCDTable } from '@/components/ncd/NCDTable';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { NCDData } from '@/lib/services/ncd-service';

vi.mock('@/hooks/useAdminSession');

const ncdIssues: NCDData[] = [
  {
    id: 'ncd-1',
    companyName: 'Acme Finance NCD',
    slug: 'acme-finance-ncd',
    openDate: '2026-06-01',
    closeDate: '2026-06-05',
    issuePrice: 1000,
    issueSize: '500',
    status: 'CLOSED',
  },
];

describe('NCDTable — admin edit link', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<NCDTable ncdIssues={ncdIssues} />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-finance-ncd?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<NCDTable ncdIssues={ncdIssues} />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
