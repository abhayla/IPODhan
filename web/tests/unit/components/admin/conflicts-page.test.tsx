import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/link — the component only needs it to render an anchor-like element.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const adminGetMock = vi.fn();
const adminPostMock = vi.fn();

vi.mock('@/lib/admin/admin-api-client', () => ({
  adminGet: (...args: unknown[]) => adminGetMock(...args),
  adminPost: (...args: unknown[]) => adminPostMock(...args),
}));

import ConflictsPage from '@/app/admin/conflicts/page';

describe('ConflictsPage', () => {
  beforeEach(() => {
    adminGetMock.mockReset();
    adminPostMock.mockReset();
  });

  it('W-43: renders the four counters with 0 fallbacks and does not throw when stats has no byIPO and no bySeverity', async () => {
    adminGetMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/conflicts?')) {
        return { conflicts: [] };
      }
      // Real backend shape: no `byIPO`, and here also no `bySeverity` — the
      // page must fall back to 0 instead of crashing on undefined access.
      return {
        stats: {
          total: 0,
          unresolved: 0,
          resolved: 0,
          bySource: {},
        },
        problematicFields: [],
      };
    });

    render(<ConflictsPage />);

    await screen.findByText('Critical');

    // Four counters render, each falling back to 0 — proves no throw on
    // `stats.byIPO` (never existed) or `stats.bySeverity.*` (missing here).
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Total Conflicts')).toBeInTheDocument();
    // "Warning"/"Info" also appear as filter <option> text — the stat card
    // labels are additional occurrences, not the only ones.
    expect(screen.getAllByText('Warning').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Info').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when conflicts is empty', async () => {
    adminGetMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/conflicts?')) {
        return { conflicts: [] };
      }
      return {
        stats: { total: 0, unresolved: 0, resolved: 0, bySource: {}, bySeverity: {} },
        problematicFields: [],
      };
    });

    render(<ConflictsPage />);

    expect(await screen.findByText(/No unresolved conflicts!/i)).toBeInTheDocument();
  });

  it('renders a CRITICAL conflict row with field, sources, values, and severity badge', async () => {
    adminGetMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/conflicts?')) {
        return {
          conflicts: [
            {
              id: 'c1',
              ipoId: 'ipo-1',
              ipoName: 'Acme Ltd',
              ipoSlug: 'acme-ltd',
              ipoStatus: 'OPEN',
              tableName: 'ipos',
              fieldName: 'issuePrice',
              source1: 'NSE',
              value1: '120',
              source2: 'BSE',
              value2: '125',
              conflictReason: 'Price mismatch',
              severity: 'CRITICAL',
              detectedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
        };
      }
      return {
        stats: { total: 1, unresolved: 1, resolved: 0, bySource: {}, bySeverity: { CRITICAL: 1 } },
        problematicFields: [],
      };
    });

    render(<ConflictsPage />);

    expect(await screen.findByText('issuePrice')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.getAllByText('NSE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BSE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CRITICAL').length).toBeGreaterThan(0);
  });

  it('renders problematicFields chips when present', async () => {
    adminGetMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/conflicts?')) {
        return { conflicts: [] };
      }
      return {
        stats: { total: 0, unresolved: 0, resolved: 0, bySource: {}, bySeverity: {} },
        problematicFields: [
          { fieldName: 'issuePrice', conflictCount: 5 },
          { fieldName: 'lotSize', conflictCount: 2 },
        ],
      };
    });

    render(<ConflictsPage />);

    expect(await screen.findByText('issuePrice (5)')).toBeInTheDocument();
    expect(screen.getByText('lotSize (2)')).toBeInTheDocument();
  });
});
