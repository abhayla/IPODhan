/**
 * Unit tests for metrics-service.ts (T-330 P2-4)
 *
 * Regression coverage for the /api/metrics 500: collectBusinessMetrics()'s
 * scraper health query referenced started_at/completed_at columns that do
 * not exist on scraper_logs (the real columns are created_at/duration_ms),
 * and filtered on status = 'FAILED' when the real enum value is 'FAILURE'.
 * getDataQualityMetrics() also referenced price_range_lower/price_range_upper
 * (real: price_range_min/price_range_max) and a total_shares column that
 * does not exist anywhere on ipos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('../logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logBusinessMetric: vi.fn(),
}));

import { db } from '@/lib/db';
import { collectBusinessMetrics, getDataQualityMetrics } from '@/lib/services/metrics-service';

function sqlText(call: unknown): string {
  // drizzle-orm's sql`` tagged template produces an object with a `.queryChunks`
  // or similar; the mock below just needs the raw strings passed to `sql`.
  // db.execute is called with a SQL object; stringify via its `sql` getter if
  // present, otherwise fall back to the object's queryChunks/strings.
  const obj = call as { queryChunks?: unknown[]; sql?: string };
  if (typeof obj?.sql === 'string') return obj.sql;
  return JSON.stringify(obj?.queryChunks ?? obj);
}

describe('metrics-service (T-330 P2-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('collectBusinessMetrics', () => {
    it('queries scraper_logs using created_at/duration_ms and the FAILURE enum value, not started_at/completed_at/FAILED', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: unknown) => {
        const text = sqlText(query).toLowerCase();

        // Fail loudly if any query still references the non-existent columns
        // or the wrong enum value — this is exactly what caused the 500.
        expect(text).not.toMatch(/started_at/);
        expect(text).not.toMatch(/completed_at/);
        expect(text).not.toMatch(/'failed'/);

        return { rows: [{}] };
      });

      const metrics = await collectBusinessMetrics();

      expect(metrics).toBeDefined();
      expect(db.execute).toHaveBeenCalled();
    });

    it('does not throw and returns a well-formed BusinessMetrics object', async () => {
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ total: 10, upcoming: 2, open: 1, closed: 3, listed: 4, mainboard: 8, sme: 2 }],
        })
        .mockResolvedValueOnce({
          rows: [{ last_update: new Date().toISOString(), oldest_update: new Date().toISOString(), stale: 1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_runs: 5, successful_runs: 4, failed_24h: 1, avg_duration: 1200 }],
        });

      const metrics = await collectBusinessMetrics();

      expect(metrics.scraperHealth.totalRuns).toBe(5);
      expect(metrics.scraperHealth.successRate).toBe(80);
      expect(metrics.scraperHealth.avgDuration).toBe(1200);
    });
  });

  describe('getDataQualityMetrics', () => {
    it('queries ipos using price_range_min/price_range_max and never references total_shares', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: unknown) => {
        const text = sqlText(query).toLowerCase();

        expect(text).not.toMatch(/price_range_lower/);
        expect(text).not.toMatch(/price_range_upper/);
        expect(text).not.toMatch(/total_shares/);

        return { rows: [{ total: 0 }] };
      });

      const result = await getDataQualityMetrics();

      expect(result).toBeDefined();
      expect(db.execute).toHaveBeenCalled();
    });

    it('returns completeness percentages without a totalShares field (no ipos-level column backs it)', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total: 10,
            missing_lot_size: 1,
            missing_price: 2,
            missing_open_date: 0,
            missing_close_date: 3,
          },
        ],
      });

      const result = await getDataQualityMetrics();

      expect(result.completeness).not.toHaveProperty('totalShares');
      expect(result.completeness.lotSize).toBe(90);
      expect(result.completeness.priceRange).toBe(80);
    });
  });
});
