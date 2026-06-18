/**
 * Unit Tests for GET /api/ipos
 *
 * Tests query parameter validation, error handling, and response formatting.
 * Uses mocked IPORepository to isolate route handler logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/ipos/route';
import type { PaginatedResponse, IPO } from '@/lib/repositories/types';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: {},
}));

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/logger', () => {
  const methods = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  });
  // The route calls logger.* directly AND logger.child().* — provide both surfaces.
  const logger = { ...methods(), child: vi.fn(() => ({ ...methods(), child: vi.fn() })) };
  return { logger, default: logger, createLogger: vi.fn(() => logger) };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

// Create mock findAll function
const mockFindAll = vi.fn();

// Mock IPORepository
vi.mock('@/lib/repositories/ipo-repository', () => {
  return {
    IPORepository: vi.fn().mockImplementation(() => ({
      findAll: mockFindAll,
    })),
  };
});

// ==================== TEST DATA ====================

const mockIPO: IPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: '123e4567-e89b-12d3-a456-426614174000',
  companyName: 'Test Corp',
  slug: 'test-corp',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '500.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 125,
  status: 'OPEN',
  openDate: '2025-01-10',
  closeDate: '2025-01-12',
  allotmentDate: '2025-01-15',
  listingDate: '2025-01-17',
  companyDescription: 'Test company description',
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  registrarId: null,
  leadManagers: ['ICICI Securities'],
  rating: 4,
  ratingRationale: 'Good fundamentals',
  ratingOverride: false,
  createdAt: new Date('2025-01-05T10:30:00.000Z'),
  updatedAt: new Date('2025-01-05T10:30:00.000Z'),
  lastScrapedAt: null,
};

const mockPaginatedResponse: PaginatedResponse<IPO> = {
  data: [mockIPO],
  meta: {
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

// ==================== TESTS ====================

describe('GET /api/ipos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Requests', () => {
    it('should return paginated IPO list with default parameters', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        hasMore: false,
      });
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        })
      );
    });

    it('should include Cache-Control header in response', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);

      expect(response.headers.get('Cache-Control')).toBe(
        'public, s-maxage=300, stale-while-revalidate=600'
      );
    });

    it('should handle custom page and limit parameters', async () => {
      mockFindAll.mockResolvedValue({
        ...mockPaginatedResponse,
        meta: { ...mockPaginatedResponse.meta, page: 2, limit: 10 },
      });

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?page=2&limit=10'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.limit).toBe(10);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 10,
        })
      );
    });

    it('should filter by single status parameter', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ['OPEN'],
        })
      );
    });

    it('should filter by multiple status parameters', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN&status=UPCOMING'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ['OPEN', 'UPCOMING'],
        })
      );
    });

    it('should filter by segment parameter', async () => {
      // The API filters by `segment` (MAINBOARD/SME); `category` was renamed to `segment`.
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?segment=MAINBOARD'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          segment: ['MAINBOARD'],
        })
      );
    });

    it('should filter by sector parameter', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sector=Technology'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          sector: 'Technology',
        })
      );
    });

    it('should handle sorting parameters', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sortBy=issueSize&sortOrder=asc'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'issueSize',
          sortOrder: 'asc',
        })
      );
    });

    it('should handle empty results', async () => {
      mockFindAll.mockResolvedValue({
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      });

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination.total).toBe(0);
    });
  });

  describe('Validation Errors', () => {
    it('should return 400 for invalid status parameter', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=INVALID'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toBe('Invalid query parameters');
      expect(data.error.details).toBeDefined();
    });

    it('should return 400 for invalid segment parameter', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?segment=INVALID'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for negative page parameter', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?page=-1'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for page=0', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos?page=0');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for limit exceeding max (100)', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?limit=101'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid sortBy parameter', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sortBy=invalidField'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid sortOrder parameter', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sortOrder=invalid'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should include requestId in error response', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=INVALID'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.error.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
    });

    it('should include timestamp in error response', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=INVALID'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.error.timestamp).toBeDefined();
      expect(new Date(data.error.timestamp).toISOString()).toBe(
        data.error.timestamp
      );
    });
  });

  describe('Database Errors', () => {
    it('should return 500 for DatabaseError', async () => {
      const { DatabaseError } = await import('@/lib/errors/repository-errors');
      mockFindAll.mockRejectedValue(
        new DatabaseError('Database connection failed')
      );

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('DATABASE_ERROR');
      expect(data.error.message).toBe('Failed to fetch IPO listings');
    });

    it('should return 500 for unknown errors', async () => {
      mockFindAll.mockRejectedValue(
        new Error('Unknown error occurred')
      );

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe('INTERNAL_ERROR');
      expect(data.error.message).toBe('An unexpected error occurred');
    });
  });

  describe('Response Format', () => {
    it('should return correct response structure', async () => {
      mockFindAll.mockResolvedValue(mockPaginatedResponse);

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('page');
      expect(data.pagination).toHaveProperty('limit');
      expect(data.pagination).toHaveProperty('total');
      expect(data.pagination).toHaveProperty('hasMore');
    });

    it('should calculate hasMore correctly when more pages exist', async () => {
      mockFindAll.mockResolvedValue({
        data: [mockIPO],
        meta: {
          total: 50,
          page: 1,
          limit: 20,
          totalPages: 3,
          hasNext: true,
          hasPrev: false,
        },
      });

      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(data.pagination.hasMore).toBe(true);
    });

    it('should calculate hasMore correctly on last page', async () => {
      mockFindAll.mockResolvedValue({
        data: [mockIPO],
        meta: {
          total: 50,
          page: 3,
          limit: 20,
          totalPages: 3,
          hasNext: false,
          hasPrev: true,
        },
      });

      const request = createMockRequest(
        'http://localhost:3000/api/ipos?page=3'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.pagination.hasMore).toBe(false);
    });
  });
});
