import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScraperFailureTracker, ScraperType } from '../../../src/services/scraper-failure-tracker';

// Mock the logger module
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('ScraperFailureTracker', () => {
  let tracker: ScraperFailureTracker;

  beforeEach(() => {
    // Create fresh tracker instance for each test
    tracker = new ScraperFailureTracker(3); // threshold = 3
  });

  describe('recordFailure', () => {
    it('should increment failure count for NSE scraper', () => {
      const error = new Error('NSE scraper failed');

      tracker.recordFailure('NSE', error);

      expect(tracker.getFailureCount('NSE')).toBe(1);
    });

    it('should increment failure count for BSE scraper', () => {
      const error = new Error('BSE scraper failed');

      tracker.recordFailure('BSE', error);

      expect(tracker.getFailureCount('BSE')).toBe(1);
    });

    it('should track multiple consecutive failures', () => {
      const error1 = new Error('Failure 1');
      const error2 = new Error('Failure 2');
      const error3 = new Error('Failure 3');

      tracker.recordFailure('NSE', error1);
      tracker.recordFailure('NSE', error2);
      tracker.recordFailure('NSE', error3);

      expect(tracker.getFailureCount('NSE')).toBe(3);
    });

    it('should track failures independently for each scraper type', () => {
      const nseError = new Error('NSE failed');
      const bseError = new Error('BSE failed');

      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('BSE', bseError);

      expect(tracker.getFailureCount('NSE')).toBe(2);
      expect(tracker.getFailureCount('BSE')).toBe(1);
    });

    it('should store last error message', () => {
      const error = new Error('Network timeout');

      tracker.recordFailure('NSE', error);

      const lastFailure = tracker.getLastFailure('NSE');
      expect(lastFailure.error).toBe('Network timeout');
    });

    it('should store last failure timestamp', () => {
      const beforeTime = Date.now();
      const error = new Error('Test error');

      tracker.recordFailure('NSE', error);

      const afterTime = Date.now();
      const lastFailure = tracker.getLastFailure('NSE');

      expect(lastFailure.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(lastFailure.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should update last error on subsequent failures', () => {
      const error1 = new Error('First error');
      const error2 = new Error('Second error');

      tracker.recordFailure('NSE', error1);
      tracker.recordFailure('NSE', error2);

      const lastFailure = tracker.getLastFailure('NSE');
      expect(lastFailure.error).toBe('Second error');
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count to 0 on success', () => {
      const error = new Error('Test failure');

      // Record 2 failures
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      expect(tracker.getFailureCount('NSE')).toBe(2);

      // Record success
      tracker.recordSuccess('NSE');

      expect(tracker.getFailureCount('NSE')).toBe(0);
    });

    it('should clear last error message on success', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE');

      const lastFailure = tracker.getLastFailure('NSE');
      expect(lastFailure.error).toBeNull();
      expect(lastFailure.timestamp).toBeNull();
    });

    it('should only reset the specific scraper type', () => {
      const error = new Error('Test failure');

      // Record failures for both scrapers
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('BSE', error);

      // Record success only for NSE
      tracker.recordSuccess('NSE');

      expect(tracker.getFailureCount('NSE')).toBe(0);
      expect(tracker.getFailureCount('BSE')).toBe(1); // BSE count unchanged
    });

    it('should handle success when no previous failures', () => {
      // Should not throw error
      expect(() => tracker.recordSuccess('NSE')).not.toThrow();

      expect(tracker.getFailureCount('NSE')).toBe(0);
    });
  });

  describe('shouldTriggerFallback', () => {
    it('should return false when failure count is below threshold', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      // 2 failures, threshold is 3
      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);
    });

    it('should return true when failure count equals threshold', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      // 3 failures, threshold is 3
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
    });

    it('should return true when failure count exceeds threshold', () => {
      const error = new Error('Test failure');

      // Record 4 failures (exceeds threshold of 3)
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
    });

    it('should check threshold independently for each scraper type', () => {
      const error = new Error('Test failure');

      // NSE: 3 failures (at threshold)
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      // BSE: 1 failure (below threshold)
      tracker.recordFailure('BSE', error);

      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
      expect(tracker.shouldTriggerFallback('BSE')).toBe(false);
    });

    it('should return false after success resets count', () => {
      const error = new Error('Test failure');

      // Record 3 failures (trigger threshold)
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);

      // Record success
      tracker.recordSuccess('NSE');

      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);
    });
  });

  describe('getFailureCount', () => {
    it('should return 0 for scraper with no failures', () => {
      expect(tracker.getFailureCount('NSE')).toBe(0);
      expect(tracker.getFailureCount('BSE')).toBe(0);
    });

    it('should return correct failure count', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);

      expect(tracker.getFailureCount('NSE')).toBe(2);
    });

    it('should return 0 after success', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE');

      expect(tracker.getFailureCount('NSE')).toBe(0);
    });
  });

  describe('getLastFailure', () => {
    it('should return null values when no failures recorded', () => {
      const lastFailure = tracker.getLastFailure('NSE');

      expect(lastFailure.timestamp).toBeNull();
      expect(lastFailure.error).toBeNull();
    });

    it('should return last failure timestamp and error', () => {
      const error = new Error('Network timeout');
      const beforeTime = Date.now();

      tracker.recordFailure('NSE', error);

      const afterTime = Date.now();
      const lastFailure = tracker.getLastFailure('NSE');

      expect(lastFailure.error).toBe('Network timeout');
      expect(lastFailure.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(lastFailure.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should return most recent failure when multiple failures', async () => {
      const error1 = new Error('First failure');
      const error2 = new Error('Second failure');

      tracker.recordFailure('NSE', error1);

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      tracker.recordFailure('NSE', error2);

      const lastFailure = tracker.getLastFailure('NSE');
      expect(lastFailure.error).toBe('Second failure');
      expect(lastFailure.timestamp).toBeDefined();
    });

    it('should return null after success', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE');

      const lastFailure = tracker.getLastFailure('NSE');
      expect(lastFailure.timestamp).toBeNull();
      expect(lastFailure.error).toBeNull();
    });
  });

  describe('getAllFailures', () => {
    it('should return failure records for all scraper types', () => {
      const nseError = new Error('NSE failed');
      const bseError = new Error('BSE failed');

      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('BSE', bseError);

      const allFailures = tracker.getAllFailures();

      expect(allFailures.NSE.count).toBe(2);
      expect(allFailures.NSE.lastError).toBe('NSE failed');
      expect(allFailures.BSE.count).toBe(1);
      expect(allFailures.BSE.lastError).toBe('BSE failed');
    });

    it('should return zero counts when no failures', () => {
      const allFailures = tracker.getAllFailures();

      expect(allFailures.NSE.count).toBe(0);
      expect(allFailures.BSE.count).toBe(0);
    });
  });

  describe('resetAll', () => {
    it('should reset all scraper failure counts', () => {
      const error = new Error('Test failure');

      // Record failures for both scrapers
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('BSE', error);

      // Reset all
      tracker.resetAll();

      expect(tracker.getFailureCount('NSE')).toBe(0);
      expect(tracker.getFailureCount('BSE')).toBe(0);
    });

    it('should clear all last failure data', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('BSE', error);

      tracker.resetAll();

      const nseLastFailure = tracker.getLastFailure('NSE');
      const bseLastFailure = tracker.getLastFailure('BSE');

      expect(nseLastFailure.error).toBeNull();
      expect(nseLastFailure.timestamp).toBeNull();
      expect(bseLastFailure.error).toBeNull();
      expect(bseLastFailure.timestamp).toBeNull();
    });
  });

  describe('reset (single scraper)', () => {
    it('should reset specific scraper failure count', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordFailure('BSE', error);

      // Reset only NSE
      tracker.reset('NSE');

      expect(tracker.getFailureCount('NSE')).toBe(0);
      expect(tracker.getFailureCount('BSE')).toBe(1); // BSE unchanged
    });
  });

  describe('Custom threshold', () => {
    it('should respect custom fallback threshold', () => {
      const customTracker = new ScraperFailureTracker(5); // threshold = 5
      const error = new Error('Test failure');

      // Record 4 failures
      customTracker.recordFailure('NSE', error);
      customTracker.recordFailure('NSE', error);
      customTracker.recordFailure('NSE', error);
      customTracker.recordFailure('NSE', error);

      // Should not trigger fallback yet (4 < 5)
      expect(customTracker.shouldTriggerFallback('NSE')).toBe(false);

      // 5th failure should trigger
      customTracker.recordFailure('NSE', error);
      expect(customTracker.shouldTriggerFallback('NSE')).toBe(true);
    });

    it('should work with threshold of 1', () => {
      const strictTracker = new ScraperFailureTracker(1); // threshold = 1
      const error = new Error('Test failure');

      // Single failure should trigger fallback
      strictTracker.recordFailure('NSE', error);

      expect(strictTracker.shouldTriggerFallback('NSE')).toBe(true);
    });
  });

  describe('Concurrent failure tracking', () => {
    it('should handle failures for different scrapers simultaneously', () => {
      const nseError = new Error('NSE error');
      const bseError = new Error('BSE error');

      // Interleave failures from different scrapers
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('BSE', bseError);
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('BSE', bseError);
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('BSE', bseError);

      expect(tracker.getFailureCount('NSE')).toBe(3);
      expect(tracker.getFailureCount('BSE')).toBe(3);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
      expect(tracker.shouldTriggerFallback('BSE')).toBe(true);
    });

    it('should maintain separate failure states', () => {
      const nseError = new Error('NSE error');
      const bseError = new Error('BSE error');

      // NSE hits threshold
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('NSE', nseError);
      tracker.recordFailure('NSE', nseError);

      // BSE has fewer failures
      tracker.recordFailure('BSE', bseError);

      // NSE succeeds and resets
      tracker.recordSuccess('NSE');

      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);
      expect(tracker.shouldTriggerFallback('BSE')).toBe(false);
      expect(tracker.getFailureCount('NSE')).toBe(0);
      expect(tracker.getFailureCount('BSE')).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle recordFailure called many times', () => {
      const error = new Error('Test failure');

      // Record 100 failures
      for (let i = 0; i < 100; i++) {
        tracker.recordFailure('NSE', error);
      }

      expect(tracker.getFailureCount('NSE')).toBe(100);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(true);
    });

    it('should handle recordSuccess called multiple times', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE');
      tracker.recordSuccess('NSE');
      tracker.recordSuccess('NSE');

      expect(tracker.getFailureCount('NSE')).toBe(0);
    });

    it('should handle alternating failures and successes', () => {
      const error = new Error('Test failure');

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE'); // Reset to 0

      tracker.recordFailure('NSE', error);
      tracker.recordFailure('NSE', error);
      tracker.recordSuccess('NSE'); // Reset to 0 again

      tracker.recordFailure('NSE', error); // 1 failure

      expect(tracker.getFailureCount('NSE')).toBe(1);
      expect(tracker.shouldTriggerFallback('NSE')).toBe(false);
    });
  });
});
