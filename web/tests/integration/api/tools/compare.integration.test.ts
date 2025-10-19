/**
 * Integration Tests for IPO Comparison API Endpoint
 *
 * Tests:
 * - Successful comparison with 2 IPOs
 * - Successful comparison with 3 IPOs
 * - Validation errors for invalid slugs
 * - Error response for missing IPO data
 * - Response format matches ComparisonResponse schema
 * - Filtering by IPO status (only active IPOs)
 * - Data aggregation from multiple repositories
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/tools/compare/route';
import type { NextRequest } from 'next/server';

// ==================== MOCKS ====================

// Mock repositories
const mockIPORepository = {
  findBySlug: vi.fn(),
};

const mockSubscriptionRepository = {
  findLatest: vi.fn(),
};

const mockGMPRepository = {
  findByIPO: vi.fn(),
};

const mockFinancialDataRepository = {
  findByIPO: vi.fn(),
};

// Mock repository modules
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn(() => mockIPORepository),
}));

vi.mock('@/lib/repositories/subscription-repository', () => ({
  SubscriptionRepository: vi.fn(() => mockSubscriptionRepository),
}));

vi.mock('@/lib/repositories/gmp-repository', () => ({
  GMPRepository: vi.fn(() => mockGMPRepository),
}));

vi.mock('@/lib/repositories/financial-data-repository', () => ({
  FinancialDataRepository: vi.fn(() => mockFinancialDataRepository),
}));

// Mock DB and Redis
vi.mock('@/lib/db', () => ({
  db: {},
}));

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({})),
}));

// ==================== TEST DATA ====================

const mockIPO1 = {
  id: 'ipo-1',
  companyName: 'Alpha Tech IPO',
  slug: 'alpha-tech-ipo',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  status: 'OPEN',
  sector: 'Technology',
  minPrice: 300,
  maxPrice: 350,
  lotSize: 40,
  issueSize: 1000,
  rating: 4,
  ratingRationale: 'Good fundamentals',
  openDate: '2024-01-01',
  closeDate: '2024-01-05',
  listingDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockIPO2 = {
  id: 'ipo-2',
  companyName: 'Beta Finance IPO',
  slug: 'beta-finance-ipo',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  status: 'UPCOMING',
  sector: 'Finance',
  minPrice: 500,
  maxPrice: 600,
  lotSize: 25,
  issueSize: 2000,
  rating: 5,
  ratingRationale: 'Excellent opportunity',
  openDate: '2024-02-01',
  closeDate: '2024-02-05',
  listingDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockIPO3 = {
  id: 'ipo-3',
  companyName: 'Gamma Industries IPO',
  slug: 'gamma-industries-ipo',
  segment: 'SME' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  status: 'CLOSED',
  sector: 'Manufacturing',
  minPrice: 150,
  maxPrice: 180,
  lotSize: 75,
  issueSize: 500,
  rating: 3,
  ratingRationale: null,
  openDate: '2024-01-10',
  closeDate: '2024-01-15',
  listingDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockListedIPO = {
  id: 'ipo-4',
  companyName: 'Listed Company',
  slug: 'listed-company',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  status: 'LISTED',
  sector: 'Technology',
  minPrice: 400,
  maxPrice: 450,
  lotSize: 30,
  issueSize: 3000,
  rating: 4,
  ratingRationale: 'Good',
  openDate: '2023-12-01',
  closeDate: '2023-12-05',
  listingDate: '2023-12-10',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSubscription1 = {
  id: 'sub-1',
  ipoId: 'ipo-1',
  qibSubscription: 2.5,
  niiSubscription: 3.2,
  retailSubscription: 1.8,
  totalSubscription: 2.4,
  timestamp: new Date(),
};

const mockGMPRecord1 = {
  id: 'gmp-1',
  ipoId: 'ipo-1',
  gmp: 50,
  expectedListingPrice: 400,
  timestamp: new Date(),
};

const mockFinancialData1 = {
  id: 'fin-1',
  ipoId: 'ipo-1',
  peRatio: 25.5,
  roe: 18.5,
  eps: 12.5,
  revenue: {
    fy1: 1000,
    fy2: 1200,
    fy3: 1500,
  },
};

// Helper to create mock request
function createMockRequest(body: object): NextRequest {
  return {
    json: async () => body,
  } as NextRequest;
}

// ==================== SETUP ====================

beforeEach(() => {
  vi.clearAllMocks();
});

// ==================== TESTS ====================

describe('POST /api/tools/compare', () => {
  it('should successfully compare 2 IPOs', async () => {
    // Setup mocks
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2);

    mockSubscriptionRepository.findLatest
      .mockResolvedValueOnce(mockSubscription1)
      .mockResolvedValueOnce(null);

    mockGMPRepository.findByIPO
      .mockResolvedValueOnce([mockGMPRecord1])
      .mockResolvedValueOnce([]);

    mockFinancialDataRepository.findByIPO
      .mockResolvedValueOnce(mockFinancialData1)
      .mockResolvedValueOnce(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.comparisons).toHaveLength(2);
    expect(data.comparedAt).toBeDefined();
    expect(data.comparisons[0].slug).toBe('alpha-tech-ipo');
    expect(data.comparisons[1].slug).toBe('beta-finance-ipo');
  });

  it('should successfully compare 3 IPOs', async () => {
    // Setup mocks
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2)
      .mockResolvedValueOnce(mockIPO3);

    mockSubscriptionRepository.findLatest
      .mockResolvedValue(null);

    mockGMPRepository.findByIPO
      .mockResolvedValue([]);

    mockFinancialDataRepository.findByIPO
      .mockResolvedValue(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo', 'gamma-industries-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.comparisons).toHaveLength(3);
  });

  it('should return 400 for invalid request (less than 2 IPOs)', async () => {
    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
    expect(data.message).toContain('At least 2 IPOs');
  });

  it('should return 400 for invalid request (more than 3 IPOs)', async () => {
    const request = createMockRequest({
      ipoSlugs: ['slug1', 'slug2', 'slug3', 'slug4'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
    expect(data.message).toContain('Maximum 3 IPOs');
  });

  it('should return 400 for invalid slug format', async () => {
    const request = createMockRequest({
      ipoSlugs: ['Alpha_Tech_IPO', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
  });

  it('should return 404 when IPO not found', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(null); // Second IPO not found

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'non-existent-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not Found');
  });

  it('should return 400 when IPO has invalid status (LISTED)', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockListedIPO);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'listed-company'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
    expect(data.message).toContain('invalid status');
  });

  it('should include all required fields in comparison response', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2);

    mockSubscriptionRepository.findLatest
      .mockResolvedValueOnce(mockSubscription1)
      .mockResolvedValueOnce(null);

    mockGMPRepository.findByIPO
      .mockResolvedValueOnce([mockGMPRecord1])
      .mockResolvedValueOnce([]);

    mockFinancialDataRepository.findByIPO
      .mockResolvedValueOnce(mockFinancialData1)
      .mockResolvedValueOnce(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    const comparison = data.comparisons[0];
    expect(comparison).toHaveProperty('slug');
    expect(comparison).toHaveProperty('companyName');
    expect(comparison).toHaveProperty('priceRange');
    expect(comparison).toHaveProperty('lotSize');
    expect(comparison).toHaveProperty('status');
    expect(comparison).toHaveProperty('subscription');
    expect(comparison).toHaveProperty('gmp');
    expect(comparison).toHaveProperty('financials');
    expect(comparison).toHaveProperty('rating');
    expect(comparison).toHaveProperty('ratingRationale');
  });

  it('should handle null subscription data correctly', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2);

    mockSubscriptionRepository.findLatest
      .mockResolvedValue(null);

    mockGMPRepository.findByIPO
      .mockResolvedValue([]);

    mockFinancialDataRepository.findByIPO
      .mockResolvedValue(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    const comparison = data.comparisons[0];
    expect(comparison.subscription.qib).toBeNull();
    expect(comparison.subscription.nii).toBeNull();
    expect(comparison.subscription.retail).toBeNull();
    expect(comparison.subscription.total).toBeNull();
  });

  it('should handle null GMP data correctly', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2);

    mockSubscriptionRepository.findLatest
      .mockResolvedValue(null);

    mockGMPRepository.findByIPO
      .mockResolvedValue([]); // No GMP records

    mockFinancialDataRepository.findByIPO
      .mockResolvedValue(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.comparisons[0].gmp).toBeNull();
  });

  it('should calculate revenue growth correctly', async () => {
    mockIPORepository.findBySlug
      .mockResolvedValueOnce(mockIPO1)
      .mockResolvedValueOnce(mockIPO2);

    mockSubscriptionRepository.findLatest
      .mockResolvedValue(null);

    mockGMPRepository.findByIPO
      .mockResolvedValue([]);

    mockFinancialDataRepository.findByIPO
      .mockResolvedValueOnce(mockFinancialData1)
      .mockResolvedValueOnce(null);

    const request = createMockRequest({
      ipoSlugs: ['alpha-tech-ipo', 'beta-finance-ipo'],
    });

    const response = await POST(request);
    const data = await response.json();

    // Revenue growth should be calculated from fy1 to fy3
    expect(data.comparisons[0].financials.revenueGrowth).toBeDefined();
    expect(typeof data.comparisons[0].financials.revenueGrowth).toBe('number');
  });

  it('should validate empty request body', async () => {
    const request = createMockRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
  });

  it('should validate request with missing ipoSlugs field', async () => {
    const request = createMockRequest({
      slugs: ['alpha-tech-ipo', 'beta-finance-ipo'], // Wrong field name
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validation Error');
  });
});
