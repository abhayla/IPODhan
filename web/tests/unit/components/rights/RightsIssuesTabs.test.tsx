/**
 * Unit tests for RightsIssuesTabs — T-286 (P1-1): both the "upcoming" and
 * "live" tabs used to default their year filter to a hardcoded '2025' (with
 * an equally hardcoded `availableYears: ['2024','2025','2026']`), hiding
 * every currently-open 2026 rights issue on first paint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RightsIssuesTabs } from '@/components/rights/RightsIssuesTabs';
import type { RightsIssueData } from '@/lib/services/rights-service';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function makeRights(overrides: Partial<RightsIssueData>): RightsIssueData {
  return {
    id: 'rights-1',
    companyName: 'Acme Rights Co',
    slug: 'acme-rights-co',
    recordDate: '2025-06-01',
    openDate: '2025-06-05',
    renunciationDate: '2025-06-10',
    closeDate: '2025-06-10',
    issuePrice: 200,
    issueSize: '150',
    status: 'CLOSED',
    ...overrides,
  };
}

describe('RightsIssuesTabs', () => {
  beforeEach(() => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
    });
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams('tab=upcoming')
    );
  });

  it('does NOT hardcode the upcoming-tab default year to 2025 — a 2026-only upcoming rights issue is visible', () => {
    const upcomingRights: RightsIssueData[] = [
      makeRights({
        id: 'rights-2026',
        companyName: '2026 Only Rights Issue',
        recordDate: '2026-04-01',
        openDate: '2026-04-05',
      }),
    ];

    render(<RightsIssuesTabs upcomingRights={upcomingRights} liveRights={[]} initialTab="upcoming" />);

    expect(screen.getByText('2026 Only Rights Issue')).toBeInTheDocument();
  });

  it('does NOT hardcode the live-tab default year to 2025 — a 2026-only live rights issue is visible', () => {
    const liveRights: RightsIssueData[] = [
      makeRights({
        id: 'rights-2026-live',
        companyName: '2026 Only Live Rights Issue',
        recordDate: '2026-05-01',
        openDate: '2026-05-05',
      }),
    ];

    render(<RightsIssuesTabs upcomingRights={[]} liveRights={liveRights} initialTab="live" />);

    expect(screen.getByText('2026 Only Live Rights Issue')).toBeInTheDocument();
  });

  it('defaults each tab to the latest year that actually has rows for that tab', () => {
    const upcomingRights: RightsIssueData[] = [
      makeRights({ id: 'r-2024', companyName: 'Old Upcoming 2024', recordDate: '2024-01-01', openDate: '2024-01-05' }),
      makeRights({ id: 'r-2026', companyName: 'Latest Upcoming 2026', recordDate: '2026-01-01', openDate: '2026-01-05' }),
    ];

    render(<RightsIssuesTabs upcomingRights={upcomingRights} liveRights={[]} initialTab="upcoming" />);

    expect(screen.getByText('Latest Upcoming 2026')).toBeInTheDocument();
    expect(screen.queryByText('Old Upcoming 2024')).not.toBeInTheDocument();
  });
});
