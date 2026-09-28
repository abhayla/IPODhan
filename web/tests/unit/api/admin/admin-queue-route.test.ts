/**
 * GET /api/admin/queue is admin-only (the payload carries source values, §9.2 item 24) and
 * validates its query at the edge. Driven through the REAL withAdminAuth (no auth mock).
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const serviceCalls = vi.fn();
vi.mock('@/lib/services/admin-queue-service', () => ({
  AdminQueueService: vi.fn(() => ({ getQueue: (...a: unknown[]) => { serviceCalls(...a); return Promise.resolve({}); } })),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({})) }));

import { GET } from '@/app/api/admin/queue/route';
import { QueueQuerySchema } from '@/lib/admin/queue/queue-query';

describe('GET /api/admin/queue', () => {
  it('answers 401 without admin auth and never reaches the queue', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/queue'));
    expect(res.status).toBe(401);
    expect(serviceCalls).not.toHaveBeenCalled();
  });
});

describe('QueueQuerySchema', () => {
  it('defaults to everything, page 1 of 50', () => {
    expect(QueueQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
  });

  it('refuses out-of-range and malformed values', () => {
    expect(QueueQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(QueueQuerySchema.safeParse({ group: '4' }).success).toBe(false);
    expect(QueueQuerySchema.safeParse({ kind: 'all' }).success).toBe(false);
    expect(QueueQuerySchema.safeParse({ ipo: "x'; drop" }).success).toBe(false);
    expect(QueueQuerySchema.parse({ group: '2', page: '3', ipo: 'abc-ltd' })).toMatchObject({ group: 2, page: 3, ipo: 'abc-ltd' });
  });
});
