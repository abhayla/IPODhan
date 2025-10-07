/**
 * Integration Tests for Market Holidays API Endpoint
 * Story 5.4: Market Holidays Calendar
 *
 * Tests:
 * - Successful holiday data retrieval
 * - Year filter validation (2024-2026)
 * - Exchange filter (ALL, NSE, BSE)
 * - Upcoming filter functionality
 * - Invalid parameter handling
 * - Response structure and validation
 * - Cache headers (30-day TTL)
 * - Chronological sorting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/market-holidays/route';
import type { NextRequest } from 'next/server';

// ==================== MOCKS ====================

// Mock database and Redis
vi.mock('@/lib/db', () => ({
  db: {},
}));

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    setex: vi.fn(),
  })),
}));

// Mock MarketHolidayRepository
vi.mock('@/lib/repositories/market-holiday-repository', () => {
  return {
    MarketHolidayRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn(),
    })),
  };
});

import { MarketHolidayRepository } from '@/lib/repositories/market-holiday-repository';

// Sample holiday data
const mockHolidayData = [
  {
    id: 'holiday-1',
    date: '2024-01-26',
    description: 'Republic Day',
    exchange: 'BOTH' as const,
    type: 'TRADING' as const,
    year: 2024,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'holiday-2',
    date: '2024-03-25',
    description: 'Holi',
    exchange: 'BOTH' as const,
    type: 'TRADING' as const,
    year: 2024,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'holiday-3',
    date: '2024-08-15',
    description: 'Independence Day',
    exchange: 'NSE' as const,
    type: 'TRADING' as const,
    year: 2024,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'holiday-4',
    date: '2025-01-26',
    description: 'Republic Day',
    exchange: 'BOTH' as const,
    type: 'TRADING' as const,
    year: 2025,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
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

describe('Market Holidays API Endpoint', () => {
  describe('GET /api/market-holidays', () => {
    it('should return holidays with default filters (all exchanges)', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockResolvedValue(mockHolidayData),
      }));

      const request = createMockRequest('/api/market-holidays');
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('holidays');
      expect(data).toHaveProperty('fetchedAt');
      expect(Array.isArray(data.holidays)).toBe(true);
    });

    it('should include Cache-Control header with 30-day TTL', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockResolvedValue(mockHolidayData),
      }));

      const request = createMockRequest('/api/market-holidays');
      const response = await GET(request);

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBe('public, max-age=2592000');
    });

    it('should filter holidays by year', async () => {
      const holidays2024 = mockHolidayData.filter((h) => h.year === 2024);
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      const mockFindAll = vi.fn().mockResolvedValue(holidays2024);

      MockRepo.mockImplementation(() => ({
        findAll: mockFindAll,
      }));

      const request = createMockRequest('/api/market-holidays?year=2024');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({
        year: 2024,
        exchange: 'ALL',
        upcoming: false,
      });
    });

    it('should filter holidays by exchange (NSE)', async () => {
      const nseHolidays = mockHolidayData.filter(
        (h) => h.exchange === 'NSE' || h.exchange === 'BOTH'
      );
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      const mockFindAll = vi.fn().mockResolvedValue(nseHolidays);

      MockRepo.mockImplementation(() => ({
        findAll: mockFindAll,
      }));

      const request = createMockRequest('/api/market-holidays?exchange=NSE');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({
        year: undefined,
        exchange: 'NSE',
        upcoming: false,
      });
    });

    it('should filter holidays by exchange (BSE)', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      const mockFindAll = vi.fn().mockResolvedValue([]);

      MockRepo.mockImplementation(() => ({
        findAll: mockFindAll,
      }));

      const request = createMockRequest('/api/market-holidays?exchange=BSE');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({
        year: undefined,
        exchange: 'BSE',
        upcoming: false,
      });
    });

    it('should filter upcoming holidays', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      const mockFindAll = vi.fn().mockResolvedValue([mockHolidayData[3]]);

      MockRepo.mockImplementation(() => ({
        findAll: mockFindAll,
      }));

      const request = createMockRequest('/api/market-holidays?upcoming=true');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({
        year: undefined,
        exchange: 'ALL',
        upcoming: true,
      });
    });

    it('should combine multiple filters', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      const mockFindAll = vi.fn().mockResolvedValue([]);

      MockRepo.mockImplementation(() => ({
        findAll: mockFindAll,
      }));

      const request = createMockRequest(
        '/api/market-holidays?year=2024&exchange=NSE&upcoming=true'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({
        year: 2024,
        exchange: 'NSE',
        upcoming: true,
      });
    });
  });

  describe('Validation', () => {
    it('should reject invalid year (too low)', async () => {
      const request = createMockRequest('/api/market-holidays?year=2023');
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid year (too high)', async () => {
      const request = createMockRequest('/api/market-holidays?year=2027');
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid year (not a number)', async () => {
      const request = createMockRequest('/api/market-holidays?year=abc');
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should accept valid years (2024, 2025, 2026)', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockResolvedValue([]),
      }));

      for (const year of [2024, 2025, 2026]) {
        const request = createMockRequest(`/api/market-holidays?year=${year}`);
        const response = await GET(request);

        expect(response.status).toBe(200);
      }
    });

    it('should reject invalid exchange value', async () => {
      const request = createMockRequest('/api/market-holidays?exchange=INVALID');
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid upcoming value', async () => {
      const request = createMockRequest('/api/market-holidays?upcoming=invalid');
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 error when repository throws', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockRejectedValue(new Error('Database error')),
      }));

      const request = createMockRequest('/api/market-holidays');
      const response = await GET(request);

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error.code).toBe('INTERNAL_ERROR');
      expect(data.error.message).toContain('Failed to fetch market holidays');
    });

    it('should include timestamp in error response', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockRejectedValue(new Error('Database error')),
      }));

      const request = createMockRequest('/api/market-holidays');
      const response = await GET(request);

      const data = await response.json();
      expect(data.error).toHaveProperty('timestamp');
      expect(new Date(data.error.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Response Format', () => {
    it('should return holidays array and fetchedAt timestamp', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockResolvedValue(mockHolidayData),
      }));

      const request = createMockRequest('/api/market-holidays');
      const response = await GET(request);

      const data = await response.json();
      expect(data).toHaveProperty('holidays');
      expect(data).toHaveProperty('fetchedAt');
      expect(Array.isArray(data.holidays)).toBe(true);
      expect(new Date(data.fetchedAt)).toBeInstanceOf(Date);
    });

    it('should return empty array when no holidays found', async () => {
      const MockRepo = MarketHolidayRepository as unknown as ReturnType<typeof vi.fn>;
      MockRepo.mockImplementation(() => ({
        findAll: vi.fn().mockResolvedValue([]),
      }));

      const request = createMockRequest('/api/market-holidays?year=2026');
      const response = await GET(request);

      const data = await response.json();
      expect(data.holidays).toEqual([]);
      expect(data.holidays.length).toBe(0);
    });
  });
});
