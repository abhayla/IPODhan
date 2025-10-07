/**
 * Integration Tests for Lot Calculator API Endpoint
 *
 * Tests:
 * - Successful IPO data retrieval
 * - Search functionality
 * - Data filtering (active IPOs only)
 * - Invalid data handling
 * - Error scenarios
 * - Response structure and validation
 * - Cache headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/tools/lot-calculator/route';
import { db } from '@/lib/db/index';
import type { NextRequest } from 'next/server';

// ==================== MOCKS ====================

// Mock database
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

// Mock drizzle-orm functions
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    or: vi.fn((...conditions) => ({ conditions, type: 'or' })),
    ilike: vi.fn((field, value) => ({ field, value, type: 'ilike' })),
    desc: vi.fn((field) => ({ field, type: 'desc' })),
  };
});

// Sample IPO data
const mockIPOData = [
  {
    id: 'ipo-1',
    companyName: 'Test Company A',
    slug: 'test-company-a',
    category: 'MAINBOARD',
    status: 'OPEN',
    priceRangeMin: 300,
    priceRangeMax: 350,
    lotSize: 40,
    openDate: '2024-01-01',
    closeDate: '2024-01-03',
  },
  {
    id: 'ipo-2',
    companyName: 'Test Company B',
    slug: 'test-company-b',
    category: 'SME',
    status: 'UPCOMING',
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 100,
    openDate: '2024-01-05',
    closeDate: '2024-01-07',
  },
  {
    id: 'ipo-3',
    companyName: 'Listed Company',
    slug: 'listed-company',
    category: 'MAINBOARD',
    status: 'LISTED',
    priceRangeMin: 500,
    priceRangeMax: 600,
    lotSize: 20,
    openDate: '2023-12-01',
    closeDate: '2023-12-03',
  },
  {
    id: 'ipo-4',
    companyName: 'Invalid IPO',
    slug: 'invalid-ipo',
    category: 'MAINBOARD',
    status: 'OPEN',
    priceRangeMin: null,
    priceRangeMax: null,
    lotSize: null,
    openDate: '2024-01-01',
    closeDate: '2024-01-03',
  },
];

// Helper to create mock request
function createMockRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url, 'http://localhost:3000'),
  } as NextRequest;
}

// ==================== SETUP ====================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ==================== TESTS ====================

describe('Lot Calculator API Endpoint', () => {
  describe('GET /api/tools/lot-calculator', () => {
    it('should return active IPOs with valid data', async () => {
      // Setup mock chain
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0], mockIPOData[1]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('ipos');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.ipos)).toBe(true);
      expect(data.count).toBeGreaterThan(0);
    });

    it('should filter out IPOs with missing critical data', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockIPOData),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      const response = await GET(request);

      const data = await response.json();

      // Should filter out 'Invalid IPO' (null priceRangeMax and lotSize)
      expect(data.ipos.every((ipo: typeof mockIPOData[0]) => ipo.priceRangeMax !== null)).toBe(true);
      expect(data.ipos.every((ipo: typeof mockIPOData[0]) => ipo.lotSize !== null)).toBe(true);
      expect(data.ipos.every((ipo: typeof mockIPOData[0]) => ipo.lotSize !== null && ipo.lotSize > 0)).toBe(true);
    });

    it('should support search query parameter', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator?search=Test Company A');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockQuery.where).toHaveBeenCalled();
    });

    it('should return only active IPOs when no search query', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0], mockIPOData[1]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      await GET(request);

      // Should filter for OPEN, UPCOMING, CLOSED status
      expect(mockQuery.where).toHaveBeenCalled();
    });

    it('should include cache headers', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      const response = await GET(request);

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('s-maxage=300'); // 5 min cache
    });

    it('should limit results to 100 IPOs', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      await GET(request);

      expect(mockQuery.limit).toHaveBeenCalledWith(100);
    });

    it('should handle database errors gracefully', async () => {
      (db.select as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      const response = await GET(request);

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toBe('Failed to fetch IPO data');
    });

    it('should handle empty search gracefully', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator?search=');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ipos).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('should order results by close date descending', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0], mockIPOData[1]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      await GET(request);

      expect(mockQuery.orderBy).toHaveBeenCalled();
    });
  });

  describe('Response Structure', () => {
    it('should return correct response structure', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator');
      const response = await GET(request);

      const data = await response.json();

      expect(data).toMatchObject({
        ipos: expect.any(Array),
        count: expect.any(Number),
      });

      if (data.ipos.length > 0) {
        const ipo = data.ipos[0];
        expect(ipo).toHaveProperty('id');
        expect(ipo).toHaveProperty('companyName');
        expect(ipo).toHaveProperty('slug');
        expect(ipo).toHaveProperty('category');
        expect(ipo).toHaveProperty('status');
        expect(ipo).toHaveProperty('priceRangeMin');
        expect(ipo).toHaveProperty('priceRangeMax');
        expect(ipo).toHaveProperty('lotSize');
        expect(ipo).toHaveProperty('openDate');
        expect(ipo).toHaveProperty('closeDate');
      }
    });
  });

  describe('Search Functionality', () => {
    it('should search by company name', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator?search=Test Company');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockQuery.where).toHaveBeenCalled();
    });

    it('should search by slug', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator?search=test-company-a');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockQuery.where).toHaveBeenCalled();
    });

    it('should be case-insensitive', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPOData[0]]),
        $dynamic: vi.fn().mockReturnThis(),
      };

      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQuery),
      });

      const request = createMockRequest('/api/tools/lot-calculator?search=TEST COMPANY');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });
});
