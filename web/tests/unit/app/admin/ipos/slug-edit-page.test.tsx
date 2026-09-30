/**
 * Unit tests for the admin-only non-IPO editor route (OD-140, §9.2 items 4, 14):
 * web/app/admin/(protected)/ipos/[slug]/edit/page.tsx.
 *
 * Class: `2026-09-24 admin-route auth-hole` — an admin route whose server entry point does not
 * itself verify the session. These tests assert the SERVER-SIDE check runs before any data is
 * read (an anonymous caller never reaches the IPO lookup), independent of app/admin/layout.tsx's
 * client-only redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getAdminSessionFromCookies = vi.fn();
const findBySlug = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFound = vi.fn(() => {
  throw new Error('NOT_FOUND');
});

vi.mock('@/lib/admin-accounts/admin-session', () => ({
  getAdminSessionFromCookies,
}));

vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findBySlug })),
}));

vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({})) }));

vi.mock('next/navigation', () => ({ redirect, notFound }));

vi.mock('@/components/admin/ipo-editor/IpoPageEditor', () => ({
  IpoPageEditor: ({ ipoId }: { ipoId: string }) => (
    <div data-testid="ipo-page-editor" data-ipo-id={ipoId} />
  ),
  AdminEditButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

async function loadPage() {
  const mod = await import('@/app/admin/(protected)/ipos/[slug]/edit/page');
  return mod.default;
}

describe('admin-only non-IPO edit route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects an anonymous request to /admin/login WITHOUT reading the row (mutation: removing the check would let findBySlug run first)', async () => {
    getAdminSessionFromCookies.mockResolvedValue(null);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ slug: 'acme-ofs' }) })).rejects.toThrow(
      'REDIRECT:/admin/login'
    );

    expect(findBySlug).not.toHaveBeenCalled();
  });

  it('404s when the admin is logged in but the slug does not exist', async () => {
    getAdminSessionFromCookies.mockResolvedValue({ adminId: 'a1', adminName: 'Abhay', isOwner: true });
    findBySlug.mockResolvedValue(null);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ slug: 'ghost' }) })).rejects.toThrow('NOT_FOUND');
  });

  it('redirects an IPO-type slug to its own public detail page (OD-110: one editor per IPO-type row)', async () => {
    getAdminSessionFromCookies.mockResolvedValue({ adminId: 'a1', adminName: 'Abhay', isOwner: true });
    findBySlug.mockResolvedValue({
      id: 'ipo-1',
      slug: 'acme-ipo',
      companyName: 'Acme Ltd',
      offeringType: 'IPO',
      status: 'OPEN',
    });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ slug: 'acme-ipo' }) })).rejects.toThrow(
      'REDIRECT:/ipos/acme-ipo'
    );
  });

  it('renders the shared editor for a logged-in admin on a non-IPO (OFS) row', async () => {
    getAdminSessionFromCookies.mockResolvedValue({ adminId: 'a1', adminName: 'Abhay', isOwner: true });
    findBySlug.mockResolvedValue({
      id: 'ofs-1',
      slug: 'acme-ofs',
      companyName: 'Acme OFS Ltd',
      offeringType: 'OFS',
      status: 'OPEN',
    });
    const Page = await loadPage();

    const element = await Page({ params: Promise.resolve({ slug: 'acme-ofs' }) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('ipo-page-editor');
    expect(html).toContain('ofs-1');
    expect(html).toContain('Acme OFS Ltd');
    expect(redirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});
