import { describe, it, expect, vi, beforeEach } from 'vitest';

const release = vi.fn();
const query = vi.fn();
const connect = vi.fn();

vi.mock('@/lib/db', () => ({ pool: { connect: (...a: unknown[]) => connect(...a) } }));
vi.mock('@/lib/auth/admin-auth', () => ({ requireAdminAuth: vi.fn(async () => null) }));
vi.mock('@/lib/errors/api-error-response', () => ({
  apiErrorResponse: vi.fn(() => new Response('err', { status: 500 })),
}));

import { GET } from '@/app/api/db-test/route';

describe('GET /api/db-test pooled connection', () => {
  beforeEach(() => {
    release.mockReset();
    query.mockReset();
    connect.mockReset();
    connect.mockResolvedValue({ query, release });
  });

  it('releases the client when the query throws (#1142)', async () => {
    query.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the client on success', async () => {
    query.mockResolvedValue({ rows: [{ version: 'PostgreSQL 16' }] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
