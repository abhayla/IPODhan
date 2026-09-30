/**
 * §9.2 item 23 (OD-116/OD-118): the id-keyed public history routes never answer for a hidden IPO.
 * They read gmp_records / subscriptions by ipo id and never touch `ipos`, so without an explicit
 * visibility check a hidden row's GMP and subscription history stayed public by id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const findById = vi.fn();
const gmpFindByIPO = vi.fn();
const subFindByIPO = vi.fn();

vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => l };
  return { logger: l };
});
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findById })),
}));
vi.mock('@/lib/repositories/gmp-repository', () => ({
  GMPRepository: vi.fn().mockImplementation(() => ({ findByIPO: gmpFindByIPO })),
}));
vi.mock('@/lib/repositories/subscription-repository', () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({ findByIPO: subFindByIPO })),
}));

const ID = '11111111-2222-4333-8444-555555555555';
const req = (p: string) => new NextRequest(`http://localhost${p}`);
const ctx = { params: Promise.resolve({ ipoId: ID }) };

describe('id-keyed history routes refuse a hidden IPO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gmpFindByIPO.mockResolvedValue([{ id: 'g1' }]);
    subFindByIPO.mockResolvedValue([{ id: 's1' }]);
  });

  it('GET /api/gmp/history/[ipoId] answers 404 and reads no GMP rows when findById refuses the row', async () => {
    findById.mockResolvedValue(null); // findById drops a hidden row (includeHidden is not passed)
    const { GET } = await import('@/app/api/gmp/history/[ipoId]/route');
    const res = await GET(req(`/api/gmp/history/${ID}`), ctx);
    expect(res.status).toBe(404);
    expect(findById).toHaveBeenCalledWith(ID);
    expect(gmpFindByIPO).not.toHaveBeenCalled();
  });

  it('GET /api/subscription/history/[ipoId] answers 404 and reads no rows when findById refuses the row', async () => {
    findById.mockResolvedValue(null);
    const { GET } = await import('@/app/api/subscription/history/[ipoId]/route');
    const res = await GET(req(`/api/subscription/history/${ID}`), ctx);
    expect(res.status).toBe(404);
    expect(subFindByIPO).not.toHaveBeenCalled();
  });

  it('a visible IPO still answers 200 with its history', async () => {
    findById.mockResolvedValue({ id: ID, slug: 'acme-ltd', hiddenAt: null });
    const { GET } = await import('@/app/api/gmp/history/[ipoId]/route');
    const res = await GET(req(`/api/gmp/history/${ID}`), ctx);
    expect(res.status).toBe(200);
    expect(gmpFindByIPO).toHaveBeenCalled();
  });

  it('a malformed id answers 400 without a database read', async () => {
    const { GET } = await import('@/app/api/gmp/history/[ipoId]/route');
    const res = await GET(req('/api/gmp/history/not-a-uuid'), { params: Promise.resolve({ ipoId: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('the 410 middleware covers the slug-keyed API routes, not only the page', () => {
  it('matches the page and every /api/ipos/<slug>/... route, capturing the slug', async () => {
    const { IPO_DETAIL_PATH } = await import('@/middleware');
    for (const p of ['/ipos/acme-ltd', '/ipos/acme-ltd/', '/api/ipos/acme-ltd', '/api/ipos/acme-ltd/gmp/latest', '/api/ipos/acme-ltd/documents']) {
      expect(IPO_DETAIL_PATH.exec(p)?.[1], p).toBe('acme-ltd');
    }
    expect(IPO_DETAIL_PATH.exec('/api/gmp/history/x')).toBeNull();
  });
});
