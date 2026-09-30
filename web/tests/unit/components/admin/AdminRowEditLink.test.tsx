/**
 * Unit tests for AdminRowEditLink + useAdminSession — §9.2 item 14 (OD-110):
 * an admin sees an Edit link on IPO rows; a reader sees nothing, and the
 * check happens client-side so it never affects the public server payload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminRowEditLink } from '@/components/admin/AdminRowEditLink';
import { useAdminSession } from '@/hooks/useAdminSession';

describe('AdminRowEditLink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Edit link to /ipos/<slug>?edit= when isAdmin is true', () => {
    render(<AdminRowEditLink slug="acme-ipo" isAdmin={true} />);

    const link = screen.getByTestId('admin-row-edit-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/ipos/acme-ipo?edit=');
  });

  it('renders nothing when isAdmin is false', () => {
    render(<AdminRowEditLink slug="acme-ipo" isAdmin={false} />);

    expect(screen.queryByTestId('admin-row-edit-link')).not.toBeInTheDocument();
  });

  // OD-140, §9.2 item 14: a non-IPO row (OFS, NCD, RIGHTS, BUYBACK, TENDER, REIT) has no public
  // detail page, so its Edit link opens the admin-only route instead of /ipos/<slug>.
  it.each(['OFS', 'NCD', 'RIGHTS', 'BUYBACK', 'TENDER', 'REIT'])(
    'routes a %s row to the admin-only edit route',
    (offeringType) => {
      render(<AdminRowEditLink slug="acme-ofs" isAdmin={true} offeringType={offeringType} />);

      expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute(
        'href',
        '/admin/ipos/acme-ofs/edit'
      );
    }
  );

  it('keeps the IPO detail page as the link target when offeringType is IPO', () => {
    render(<AdminRowEditLink slug="acme-ipo" isAdmin={true} offeringType="IPO" />);

    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-ipo?edit=');
  });

  it('defaults to the IPO detail page when offeringType is omitted (existing IPO-only callers)', () => {
    render(<AdminRowEditLink slug="acme-ipo" isAdmin={true} />);

    expect(screen.getByTestId('admin-row-edit-link')).toHaveAttribute('href', '/ipos/acme-ipo?edit=');
  });
});

describe('useAdminSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function TestConsumer() {
    const { isAdmin, loading } = useAdminSession();
    return <div data-testid="state">{loading ? 'loading' : isAdmin ? 'admin' : 'reader'}</div>;
  }

  it('calls /api/admin/auth/me and resolves isAdmin true on a successful admin session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TestConsumer />);

    expect(screen.getByTestId('state').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('admin'));

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/me', { credentials: 'same-origin' });
  });

  it('resolves isAdmin false for a reader (non-ok response), never leaking a loading admin flash as true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    render(<TestConsumer />);

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('reader'));
  });

  it('resolves isAdmin false when the request itself fails (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(<TestConsumer />);

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('reader'));
  });
});
