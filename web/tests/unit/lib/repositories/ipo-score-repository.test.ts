/**
 * Unit Tests: IPO Score Repository (Story 4.7)
 *
 * Note: These are simplified unit tests. Full integration tests cover actual database operations.
 */

import { describe, it, expect, vi } from 'vitest';
import { IPOScoreRepository } from '@/lib/repositories/ipo-score-repository';

// Mock dependencies
vi.mock('@/lib/db/index', () => ({
  db: {},
}));

vi.mock('ioredis', () => {
  return {
    default: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    })),
  };
});

describe('IPOScoreRepository', () => {
  it('should be defined', () => {
    expect(IPOScoreRepository).toBeDefined();
  });

  it('should have required methods', () => {
    const mockDb = {} as any;
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    } as any;

    const repository = new IPOScoreRepository(mockDb, mockRedis);

    expect(typeof repository.findByIPOId).toBe('function');
    expect(typeof repository.findAll).toBe('function');
    expect(typeof repository.create).toBe('function');
    expect(typeof repository.update).toBe('function');
    expect(typeof repository.delete).toBe('function');
    expect(typeof repository.upsert).toBe('function');
  });
});
