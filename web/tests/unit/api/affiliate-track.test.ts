/**
 * Integration Tests for Affiliate Track API Endpoint
 *
 * Tests:
 * - POST request with valid data succeeds
 * - Invalid broker is rejected
 * - Invalid source is rejected
 * - Invalid IPO ID is rejected
 * - Click is recorded in database
 * - Request logging
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/affiliate/track/route';
import { db } from '@/lib/db/index';
import { affiliateClicks } from '@/lib/db/schema';

// Mock database
vi.mock('@/lib/db/index', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue({}),
    })),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('POST /api/affiliate/track', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully tracks valid click data', async () => {
    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        broker: 'zerodha',
        source: 'homepage',
        ipoId: null,
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe('Click tracked successfully');
  });

  it('tracks click with IPO ID', async () => {
    const ipoId = '123e4567-e89b-12d3-a456-426614174000';
    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        broker: 'angelone',
        source: 'ipo_detail',
        ipoId,
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('rejects invalid broker', async () => {
    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broker: 'invalid_broker',
        source: 'homepage',
        ipoId: null,
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid request data');
  });

  it('rejects invalid source', async () => {
    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broker: 'zerodha',
        source: 'invalid_source',
        ipoId: null,
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('rejects invalid IPO ID format', async () => {
    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broker: 'zerodha',
        source: 'ipo_detail',
        ipoId: 'not-a-uuid',
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('extracts user session from headers', async () => {
    const mockInsert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue({}),
    }));
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(mockInsert);

    const request = new Request('http://localhost:3000/api/affiliate/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.195',
        'user-agent': 'Mozilla/5.0 (Test Browser)',
      },
      body: JSON.stringify({
        broker: 'zerodha',
        source: 'homepage',
      }),
    });

    await POST(request as unknown as NextRequest);

    expect(mockInsert).toHaveBeenCalledWith(affiliateClicks);
  });
});
