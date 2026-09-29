/**
 * Unit tests for web/app/admin/pipeline/page.tsx (#1322).
 *
 * Class: `2026-09-24 admin-route auth-hole` — an admin route whose server entry point does not
 * itself verify the session. app/admin/layout.tsx is a CLIENT component (a redirect that runs in
 * the browser after the server has already rendered/fetched), so it protects nothing on the
 * server; the only thing that can stop an anonymous request is the page itself checking the
 * session before it reads any data. These tests assert that check runs, and that the repository
 * read (findGrid) is never reached when it fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getAdminSessionFromCookies = vi.fn();
const findGrid = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('@/lib/admin-accounts/admin-session', () => ({
  getAdminSessionFromCookies,
}));

vi.mock('@ipodhan/shared/repositories/ipo-pipeline-steps-repository', async () => {
  const actual = await vi.importActual<typeof import('@ipodhan/shared/repositories/ipo-pipeline-steps-repository')>(
    '@ipodhan/shared/repositories/ipo-pipeline-steps-repository'
  );
  return {
    ...actual,
    IpoPipelineStepsRepository: vi.fn().mockImplementation(() => ({ findGrid })),
  };
});

vi.mock('@ipodhan/shared/pipeline/step-catalogue', async () => {
  const actual = await vi.importActual<typeof import('@ipodhan/shared/pipeline/step-catalogue')>(
    '@ipodhan/shared/pipeline/step-catalogue'
  );
  return {
    ...actual,
    getPipelineStepsByGroup: vi.fn(() => []),
  };
});

vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({})) }));

vi.mock('next/navigation', () => ({ redirect }));

async function loadPage() {
  const mod = await import('@/app/admin/pipeline/page');
  return mod.default;
}

describe('admin pipeline page requires a server-side admin session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects an anonymous request to /admin/login WITHOUT reading the pipeline grid (mutation: removing the check would let findGrid run first)', async () => {
    getAdminSessionFromCookies.mockResolvedValue(null);
    const Page = await loadPage();

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/admin/login');

    expect(findGrid).not.toHaveBeenCalled();
  });

  it('renders the grid for a logged-in admin', async () => {
    getAdminSessionFromCookies.mockResolvedValue({ adminId: 'a1', adminName: 'Abhay', isOwner: true });
    findGrid.mockResolvedValue({ ipos: [], steps: {} });
    const Page = await loadPage();

    const element = await Page({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Pipeline steps');
    expect(findGrid).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
