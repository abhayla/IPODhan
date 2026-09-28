/**
 * /admin/conflicts is the admin queue (OD-63, OD-136, §9.4): it reads the queue API, shows counts per
 * group and per reason, links each item to the IPO-page editor, and never writes (no POST at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const adminGetMock = vi.fn();
const adminPostMock = vi.fn();
vi.mock('@/lib/admin/admin-api-client', () => ({
  adminGet: (...args: unknown[]) => adminGetMock(...args),
  adminPost: (...args: unknown[]) => adminPostMock(...args),
}));

import AdminQueuePage from '@/app/admin/conflicts/page';

const ipo = { id: 'i1', slug: 'abc-ltd', companyName: 'ABC Ltd', status: 'UPCOMING', openDate: '2026-10-05', closeDate: null, listingDate: null };
const listed = { ...ipo, id: 'i2', slug: 'old-ltd', companyName: 'Old Ltd', status: 'LISTED', listingDate: '2025-01-01' };

const response = {
  success: true,
  counts: {
    total: 3,
    byGroup: { 1: { items: 2, ipos: 1 }, 2: { items: 0, ipos: 0 }, 3: { items: 1, ipos: 1 } },
    byKind: { disagreement: 1, missing: 2, ruled: 0 },
    byReason: { disagreement: 1, 'no reason recorded': 2 },
  },
  view: {},
  page: 1,
  pageSize: 50,
  totalEntries: 3,
  totalPages: 1,
  entries: [
    {
      type: 'item',
      group: 1,
      item: {
        id: 'conflict:c1', kind: 'conflict', ipo, tableName: 'ipos', fieldName: 'issueSize', rowKey: '', ruleFilter: null,
        reason: 'disagreement', sources: [{ source: 'CHITTORGARH', value: '3000000000' }, { source: 'BSE', value: '2600624600' }],
        editorHref: '/ipos/abc-ltd?edit=ipos.issueSize',
      },
    },
    {
      type: 'item',
      group: 1,
      item: {
        id: 'plan:p1', kind: 'missing', ipo, tableName: 'ipos', fieldName: 'priceRangeMax', rowKey: '', ruleFilter: null,
        reason: 'no reason recorded', planState: 'CHECK_FAILED', editorHref: '/ipos/abc-ltd?edit=ipos.priceRangeMax',
      },
    },
    { type: 'ipo', group: 3, summary: { ipo: listed, conflicts: 0, missing: 1, ruled: 0, editorHref: '/ipos/old-ltd' } },
  ],
};

describe('AdminQueuePage', () => {
  beforeEach(() => {
    adminGetMock.mockReset();
    adminPostMock.mockReset();
    adminGetMock.mockResolvedValue(response);
  });

  it('loads everything by default and shows counts per group and per reason', async () => {
    render(<AdminQueuePage />);
    expect(await screen.findByTestId('group-count-1')).toHaveTextContent('2');
    expect(adminGetMock).toHaveBeenCalledWith('/api/admin/queue?page=1&pageSize=50');
    expect(screen.getByText('no reason recorded (2)')).toBeInTheDocument();
  });

  it('links every item to the IPO-page editor at its field, and shows the source values', async () => {
    render(<AdminQueuePage />);
    const links = await screen.findAllByText('Fix in editor');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/ipos/abc-ltd?edit=ipos.issueSize',
      '/ipos/abc-ltd?edit=ipos.priceRangeMax',
    ]);
    expect(screen.getByText('3000000000')).toBeInTheDocument();
  });

  it('opens a collapsed listed IPO item by item', async () => {
    render(<AdminQueuePage />);
    fireEvent.click(await screen.findByText('Show items'));
    await waitFor(() => expect(adminGetMock).toHaveBeenLastCalledWith('/api/admin/queue?page=1&pageSize=50&ipo=old-ltd'));
  });

  it('never writes: no POST and no resolve control', async () => {
    render(<AdminQueuePage />);
    await screen.findAllByText('Fix in editor');
    expect(screen.queryByText(/resolve/i)).toBeNull();
    expect(adminPostMock).not.toHaveBeenCalled();
  });
});
