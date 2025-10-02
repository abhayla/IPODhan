import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getIPOs, getIPOById, getIPOScore } from '@/lib/api/ipo.service';

// Mock the client module
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
  scoreApiClient: {
    get: vi.fn(),
  },
  handleApiError: vi.fn((error) => error),
}));

// Import mocked clients after mock setup
import { apiClient, scoreApiClient } from '@/lib/api/client';

describe('IPO Service Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getIPOs', () => {
    it('fetches IPOs successfully with valid params', async () => {
      const mockResponse = {
        data: {
          data: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              companyName: 'Test IPO',
              symbol: 'TEST',
              status: 'LIVE',
            },
          ],
          total: 1,
          page: 1,
          limit: 12,
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await getIPOs({ status: 'LIVE', page: 1, limit: 12 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(apiClient.get).toHaveBeenCalledWith('/ipos', {
        params: { status: 'LIVE', page: 1, limit: 12 },
      });
    });

    it('validates and rejects invalid status param', async () => {
      await expect(
        getIPOs({ status: 'INVALID' as any })
      ).rejects.toThrow('Invalid parameters');
    });

    it('validates and rejects negative page number', async () => {
      await expect(
        getIPOs({ page: -1 })
      ).rejects.toThrow('Invalid parameters');
    });

    it('validates and rejects limit > 100', async () => {
      await expect(
        getIPOs({ limit: 150 })
      ).rejects.toThrow('Invalid parameters');
    });
  });

  describe('getIPOById', () => {
    it('fetches single IPO by valid UUID', async () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      const mockIPO = {
        id: validUUID,
        companyName: 'Test Company',
        symbol: 'TEST',
      };

      vi.mocked(apiClient.get).mockResolvedValue({ data: { data: mockIPO } });

      const result = await getIPOById(validUUID);

      expect(result.id).toBe(validUUID);
      expect(result.companyName).toBe('Test Company');
      expect(apiClient.get).toHaveBeenCalledWith(`/ipos/${validUUID}`);
    });

    it('validates and rejects invalid UUID format', async () => {
      await expect(
        getIPOById('not-a-uuid')
      ).rejects.toThrow('Invalid IPO ID');
    });

    it('validates and rejects empty ID', async () => {
      await expect(
        getIPOById('')
      ).rejects.toThrow('Invalid IPO ID');
    });
  });

  describe('getIPOScore', () => {
    it('fetches IPO score by valid UUID', async () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      const mockScore = {
        id: '1',
        ipoId: validUUID,
        totalScore: 75,
        verdict: 'APPLY',
        confidence: 'HIGH',
        reasoning: 'Strong fundamentals',
        algorithmVersion: '1.0',
        calculatedAt: new Date(),
        components: {
          fundamental: 30,
          sentiment: 25,
          subscription: 15,
          sector: 5,
        },
      };

      vi.mocked(scoreApiClient.get).mockResolvedValue({ data: mockScore });

      const result = await getIPOScore(validUUID);

      expect(result.totalScore).toBe(75);
      expect(result.verdict).toBe('APPLY');
      expect(scoreApiClient.get).toHaveBeenCalledWith(`/scores/${validUUID}`);
    });

    it('validates and rejects invalid UUID for score fetch', async () => {
      await expect(
        getIPOScore('invalid-id')
      ).rejects.toThrow('Invalid IPO ID');
    });
  });
});
