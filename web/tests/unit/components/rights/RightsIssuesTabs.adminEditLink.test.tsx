/**
 * §9.2 item 14 (OD-110): RightsIssuesTabs shows the admin Edit link only for
 * a confirmed admin session; a reader gets none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RightsIssuesTabs } from '@/components/rights/RightsIssuesTabs';
import { useAdminSession } from '@/hooks/useAdminSession';
import type { RightsIssueData } from '@/lib/services/rights-service';

vi.mock('@/hooks/useAdminSession');
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const liveRights: RightsIssueData[] = [
  {
    id: 'rights-1',
    companyName: 'Acme Rights Co',
    slug: 'acme-rights-co',
    openDate: '2026-06-01',
    closeDate: '2026-06-05',
    issuePrice: 200,
    issueSize: '150',
    status: 'OPEN',
  } as RightsIssueData,
];

describe('RightsIssuesTabs — admin edit link', () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn(), replace: vi.fn() });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the Edit link for an admin session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: true, loading: false });
    render(<RightsIssuesTabs upcomingRights={[]} liveRights={liveRights} initialTab="live" />);
    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-rights-co?edit=');
  });

  it('renders no Edit link for a reader session', () => {
    vi.mocked(useAdminSession).mockReturnValue({ isAdmin: false, loading: false });
    render(<RightsIssuesTabs upcomingRights={[]} liveRights={liveRights} initialTab="live" />);
    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });
});
