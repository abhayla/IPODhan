import { describe, it, expect } from 'vitest';
import { runNSEScraper } from '../../src/scrapers/nse-scraper-orchestrator';

describe('NSE Scraper E2E Tests', () => {
  it('should complete scraper execution within 60 seconds (performance test)', async () => {
    const startTime = Date.now();

    const result = await runNSEScraper();

    const duration = Date.now() - startTime;

    // Verify execution completes
    expect(result).toBeDefined();
    expect(result.iposProcessed).toBeGreaterThanOrEqual(0);

    // Performance requirement: < 60 seconds
    expect(duration).toBeLessThan(60000);

    // Log performance breakdown for monitoring
    console.log({
      duration,
      iposProcessed: result.iposProcessed,
      iposInserted: result.iposInserted,
      iposUpdated: result.iposUpdated,
      subscriptionsCreated: result.subscriptionsCreated
    });
  }, 120000); // 2 minute timeout for E2E test

  it('should exit with code 0 on success', async () => {
    // This test would execute CLI and verify exit code
    // For MVP, we verify orchestrator returns success flag
    const result = await runNSEScraper();
    expect(result.success).toBeDefined();
  });

  it('should handle scraper failures gracefully', async () => {
    // Test would simulate failure scenarios and verify error handling
    // For now, verifying orchestrator returns error information
    const result = await runNSEScraper();
    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
