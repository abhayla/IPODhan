/**
 * Unit tests for OFSTable — T-286 (P2-1): the year filter used to default to
 * a hardcoded '2025', which hid every 2026 OFS entry on first paint. The
 * default now derives from the data itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OFSTable } from '@/components/ofs/OFSTable';
import type { OFSData } from '@/lib/services/ofs-service';

function makeOFS(overrides: Partial<OFSData>): OFSData {
  return {
    id: 'ofs-1',
    companyName: 'Acme OFS Co',
    slug: 'acme-ofs-co',
    nonRetailDate: '2025-06-01',
    retailDate: '2025-06-02',
    openDate: '2025-06-01',
    closeDate: '2025-06-02',
    issuePrice: 500,
    issueSize: '300',
    status: 'CLOSED',
    updatedAt: '2025-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('OFSTable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT hardcode the default year filter to 2025 — a 2026-only OFS list is visible on first paint', () => {
    const ofsIssues: OFSData[] = [
      makeOFS({ id: 'ofs-2026', companyName: '2026 Only OFS', nonRetailDate: '2026-05-10', retailDate: '2026-05-11' }),
    ];

    render(<OFSTable ofsIssues={ofsIssues} />);

    expect(screen.getByText('2026 Only OFS')).toBeInTheDocument();
  });

  it('defaults to the latest year that actually has OFS rows, not a fixed literal', () => {
    const ofsIssues: OFSData[] = [
      makeOFS({ id: 'ofs-2023', companyName: 'Old OFS 2023', nonRetailDate: '2023-01-01', retailDate: '2023-01-02' }),
      makeOFS({ id: 'ofs-2026', companyName: 'Latest OFS 2026', nonRetailDate: '2026-03-01', retailDate: '2026-03-02' }),
    ];

    render(<OFSTable ofsIssues={ofsIssues} />);

    expect(screen.getByText('Latest OFS 2026')).toBeInTheDocument();
    expect(screen.queryByText('Old OFS 2023')).not.toBeInTheDocument();
  });

  it('shows the "No OFS available" empty state WITH the year control when there is no data at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

    render(<OFSTable ofsIssues={[]} />);

    expect(screen.getByText('No OFS available')).toBeInTheDocument();
    expect(screen.getByLabelText('Year:')).toBeInTheDocument();
  });

  // T-310 (P2): the page must show a visible freshness signal derived from
  // the newest row's actual update time — never silently claim a calendar
  // year it has no data for.
  it('shows a "Last updated" date derived from the newest row, not the render time', () => {
    const ofsIssues: OFSData[] = [
      makeOFS({ id: 'ofs-old', companyName: 'Older Row', updatedAt: '2025-01-01T00:00:00.000Z' }),
      makeOFS({ id: 'ofs-new', companyName: 'Newest Row', updatedAt: '2026-06-09T00:00:00.000Z' }),
    ];

    render(<OFSTable ofsIssues={ofsIssues} />);

    expect(screen.getByText(/Last updated: 09 Jun 2026/)).toBeInTheDocument();
  });

  it('renders no "Last updated" line when no row carries an updatedAt', () => {
    const ofsIssues: OFSData[] = [makeOFS({ updatedAt: null })];

    render(<OFSTable ofsIssues={ofsIssues} />);

    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
  });
});
