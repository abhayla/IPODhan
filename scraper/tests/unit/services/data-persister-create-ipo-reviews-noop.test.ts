/**
 * OD-125 (2026-09-26): "IPODhan publishes no opinion reviews of IPOs" — the
 * review scraper/repository path is being retired (#167; #1189, parked,
 * deletes `createIPOReviews` entirely). #434 fixed this function's type
 * errors (a stray argument broke `retryWithExponentialBackoff`'s retry
 * loop, so the upsert body never ran); fixing that bug naively would have
 * revived retired functionality from a type-only PR. This test pins the
 * no-op: `createIPOReviews` must never call the review repository and must
 * always resolve 0, regardless of what it is given.
 */
import { describe, it, expect, vi } from 'vitest';

const { createIPOReviews } = await import('../../../src/services/data-persister.js');

function makeReview(overrides: Record<string, any> = {}) {
  return {
    source: 'MONEYCONTROL',
    author: 'Analyst A',
    reviewTitle: 'Strong fundamentals',
    recommendation: 'Subscribe' as const,
    publishedDate: new Date('2026-09-01'),
    reviewContent: 'Looks good.',
    reviewUrl: 'https://example.com/review',
    ...overrides,
  };
}

describe('createIPOReviews — OD-125/#167 no-op', () => {
  it('never touches the review repository and resolves 0, even with reviews to persist', async () => {
    const reviewRepository = {
      findByIPOIdAndAuthor: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    const result = await createIPOReviews(reviewRepository, 'ipo-1', 'MAINBOARD', [makeReview()]);

    expect(result).toBe(0);
    expect(reviewRepository.findByIPOIdAndAuthor).not.toHaveBeenCalled();
    expect(reviewRepository.create).not.toHaveBeenCalled();
    expect(reviewRepository.update).not.toHaveBeenCalled();
  });

  it('resolves 0 on an empty review list too', async () => {
    const reviewRepository = { findByIPOIdAndAuthor: vi.fn(), create: vi.fn(), update: vi.fn() };

    const result = await createIPOReviews(reviewRepository, 'ipo-1', 'SME', []);

    expect(result).toBe(0);
    expect(reviewRepository.create).not.toHaveBeenCalled();
  });
});
