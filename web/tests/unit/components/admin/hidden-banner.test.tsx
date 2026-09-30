/**
 * OD-150: the editor of a hidden IPO renders the "Unhide to edit" banner and opens no field editor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { IpoPageEditor } from '@/components/admin/ipo-editor/IpoPageEditor';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockEditor(hidden: { at: string; reason: string | null } | null) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        ipo: { id: 'ipo-1', slug: 's', companyName: 'Probe Ltd', status: 'LISTED', offeringType: 'IPO', typeKey: 'MAINBOARD_IPO' },
        hidden,
        fields: [],
      },
    }),
  } as Response);
}

describe('hidden IPO editor banner (OD-150)', () => {
  it('shows the banner, the reason and an Unhide to edit button for a hidden row', async () => {
    mockEditor({ at: '2026-09-30T10:00:00.000Z', reason: 'Not an IPO' });
    render(<IpoPageEditor ipoId="ipo-1" editTarget="ipos.registrar" />);
    await waitFor(() => expect(screen.getByTestId('hidden-banner')).toBeTruthy());
    expect(screen.getByTestId('hidden-banner').textContent).toContain('view-only');
    expect(screen.getByTestId('hidden-banner').textContent).toContain('Not an IPO');
    expect(screen.getByRole('button', { name: 'Unhide to edit' })).toBeTruthy();
    expect(screen.queryByTestId('list-editors')).toBeNull();
  });

  it('shows no banner for a visible row', async () => {
    mockEditor(null);
    render(<IpoPageEditor ipoId="ipo-1" editTarget="ipos.registrar" />);
    await waitFor(() => expect(screen.getByText('Edit Probe Ltd')).toBeTruthy());
    expect(screen.queryByTestId('hidden-banner')).toBeNull();
  });
});
