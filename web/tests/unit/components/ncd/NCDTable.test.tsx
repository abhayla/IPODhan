/**
 * Unit tests for NCDTable — T-286 (P1-1): the year filter used to default to
 * a hardcoded '2025', which hid every 2026 NCD (including currently-open
 * ones) on first paint. The default now derives from the data itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NCDTable } from '@/components/ncd/NCDTable';
import type { NCDData } from '@/lib/services/ncd-service';

function makeNCD(overrides: Partial<NCDData>): NCDData {
  return {
    id: 'ncd-1',
    companyName: 'Acme Finance NCD',
    slug: 'acme-finance-ncd',
    openDate: '2025-06-01',
    closeDate: '2025-06-05',
    issuePrice: 1000,
    issueSize: '500',
    status: 'CLOSED',
    ...overrides,
  };
}

describe('NCDTable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT hardcode the default year filter to 2025 — a 2026-only NCD list is visible on first paint', () => {
    const ncdIssues: NCDData[] = [
      makeNCD({ id: 'ncd-2026', companyName: '2026 Only NCD', openDate: '2026-07-10', closeDate: '2026-07-14' }),
    ];

    render(<NCDTable ncdIssues={ncdIssues} />);

    // Regression for the P1-1 bug: previously the year filter defaulted to
    // '2025' and this row would be silently filtered out and invisible.
    expect(screen.getByText('2026 Only NCD')).toBeInTheDocument();
  });

  it('defaults to the latest year that actually has NCD rows, not a fixed literal', () => {
    const ncdIssues: NCDData[] = [
      makeNCD({ id: 'ncd-2024', companyName: 'Old NCD 2024', openDate: '2024-01-01', closeDate: '2024-01-05' }),
      makeNCD({ id: 'ncd-2026', companyName: 'Latest NCD 2026', openDate: '2026-02-01', closeDate: '2026-02-05' }),
    ];

    render(<NCDTable ncdIssues={ncdIssues} />);

    expect(screen.getByText('Latest NCD 2026')).toBeInTheDocument();
    expect(screen.queryByText('Old NCD 2024')).not.toBeInTheDocument();
  });

  it('shows the "No NCDs available" empty state WITH the year control when there is no data at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

    // Zero NCDs -> getLatestYearWithData falls back to the current year
    // (2026), and the table is empty -- but the year control MUST still
    // render so the user can navigate (P1-1: the old early-return hid it).
    render(<NCDTable ncdIssues={[]} />);

    expect(screen.getByText('No NCDs available')).toBeInTheDocument();
    expect(screen.getByLabelText('Year:')).toBeInTheDocument();
  });
});
