/**
 * Unit Tests for BrokerAffiliateService
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Tests:
 * - getActiveBrokers() returns broker data successfully
 * - getActiveBrokers() handles errors gracefully (returns empty array)
 * - getActiveBrokers() doesn't throw on repository failures
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getActiveBrokers } from '@/lib/services/broker-affiliate-service';
import * as dbModule from '@/lib/db';
import * as redisModule from '@/lib/cache/redis-client';
import { BrokerAffiliateRepository } from '@/lib/repositories/broker-affiliate-repository';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: {} as any,
}));

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/repositories/broker-affiliate-repository');

describe('BrokerAffiliateService', () => {
  let mockRedis: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
    };

    vi.mocked(redisModule.getRedisClient).mockReturnValue(mockRedis as any);

    // Spy on console.error to verify error logging
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  describe('getActiveBrokers', () => {
    it('should return active brokers successfully', async () => {
      // Arrange: Mock successful repository response
      const mockBrokers = [
        {
          id: 'broker-1',
          brokerName: 'Zerodha',
          brokerLogo: 'https://zerodha.com/logo.svg',
          affiliateUrl: 'https://zerodha.com/open-account',
          displayText: 'Open Account',
          active: true,
          displayOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'broker-2',
          brokerName: 'Groww',
          brokerLogo: 'https://groww.in/logo.png',
          affiliateUrl: 'https://groww.in/open-account',
          displayText: 'Start Investing',
          active: true,
          displayOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockResolvedValue(mockBrokers),
        invalidateCache: vi.fn(),
      }) as any);

      // Act
      const result = await getActiveBrokers();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].brokerName).toBe('Zerodha');
      expect(result[1].brokerName).toBe('Groww');
    });

    it('should return empty array on repository error', async () => {
      // Arrange: Mock repository error
      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        invalidateCache: vi.fn(),
      }) as any);

      // Act
      const result = await getActiveBrokers();

      // Assert
      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[BrokerAffiliateService] Failed to fetch broker affiliates:',
        expect.any(Error)
      );
    });

    it('should return empty array on Redis connection failure', async () => {
      // Arrange: Mock Redis client error
      vi.mocked(redisModule.getRedisClient).mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      // Act
      const result = await getActiveBrokers();

      // Assert
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should not throw exceptions on error', async () => {
      // Arrange: Mock repository throwing error
      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockRejectedValue(new Error('Unexpected error')),
        invalidateCache: vi.fn(),
      }) as any);

      // Act & Assert: Should not throw
      await expect(getActiveBrokers()).resolves.toEqual([]);
    });

    it('should handle empty broker list gracefully', async () => {
      // Arrange: Repository returns empty array
      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockResolvedValue([]),
        invalidateCache: vi.fn(),
      }) as any);

      // Act
      const result = await getActiveBrokers();

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should log success message with broker count', async () => {
      // Arrange
      const mockBrokers = [
        {
          id: 'broker-1',
          brokerName: 'Zerodha',
          brokerLogo: null,
          affiliateUrl: 'https://zerodha.com/open-account',
          displayText: 'Open Account',
          active: true,
          displayOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockResolvedValue(mockBrokers),
        invalidateCache: vi.fn(),
      }) as any);

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Act
      await getActiveBrokers();

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[BrokerAffiliateService] Retrieved 1 active brokers'
      );

      consoleLogSpy.mockRestore();
    });

    it('should handle null/undefined brokerLogo gracefully', async () => {
      // Arrange: Broker with null logo
      const mockBrokers = [
        {
          id: 'broker-1',
          brokerName: 'Test Broker',
          brokerLogo: null,
          affiliateUrl: 'https://test.com/open-account',
          displayText: 'Open Account',
          active: true,
          displayOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(BrokerAffiliateRepository).mockImplementation(() => ({
        findAllActive: vi.fn().mockResolvedValue(mockBrokers),
        invalidateCache: vi.fn(),
      }) as any);

      // Act
      const result = await getActiveBrokers();

      // Assert
      expect(result[0].brokerLogo).toBeNull();
      expect(result).toHaveLength(1);
    });
  });
});
