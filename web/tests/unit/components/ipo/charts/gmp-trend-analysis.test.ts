import { describe, it, expect } from 'vitest';
import { analyzeGMPTrend, MIN_TREND_SAMPLE_SIZE } from '@/components/ipo/charts/GMPHistoryChart/utils';
import type { GMPRecordDB } from '@/components/ipo/charts/GMPHistoryChart/types';

/**
 * T-299 P3-12 — "30-day GMP trend" was rendering a statistical trend,
 * volatility classification, and moving average from a SINGLE data point
 * (e.g. madhur-knit-crafts-ltd showed "Trend +0.0% / Low Volatility / 7-Day
 * Moving Average" with one GMP row and an x-axis reading "23 Aug 23 Aug").
 * Below MIN_TREND_SAMPLE_SIZE points, analyzeGMPTrend MUST report
 * insufficientHistory=true and callers MUST render an honest state instead
 * of a fabricated trend/volatility.
 */
describe('analyzeGMPTrend — minimum sample gate (T-299 P3-12)', () => {
  const record = (gmp: number, day: string): GMPRecordDB => ({
    id: `id-${day}`,
    ipoId: 'ipo-1',
    timestamp: new Date(`2026-08-${day}T10:00:00Z`),
    gmp,
    expectedListingPrice: null,
    subjectRate: null,
    kostakRate: null,
    saudaDetails: null,
    source: 'CHITTORGARH',
  });

  it('flags insufficientHistory with zero records', () => {
    const result = analyzeGMPTrend([]);
    expect(result.insufficientHistory).toBe(true);
    expect(result.sampleSize).toBe(0);
  });

  it('flags insufficientHistory for a single data point (the reproduced prod bug)', () => {
    const result = analyzeGMPTrend([record(9, '23')]);
    expect(result.insufficientHistory).toBe(true);
    expect(result.sampleSize).toBe(1);
    // The raw latest/avg/min/max are still honest direct reads.
    expect(result.latestGMP).toBe(9);
    expect(result.avgGMP).toBe(9);
  });

  it('flags insufficientHistory for two data points', () => {
    const result = analyzeGMPTrend([record(9, '22'), record(10, '23')]);
    expect(result.insufficientHistory).toBe(true);
    expect(result.sampleSize).toBe(2);
  });

  it('computes a real trend/volatility once the sample reaches MIN_TREND_SAMPLE_SIZE', () => {
    expect(MIN_TREND_SAMPLE_SIZE).toBe(3);
    const result = analyzeGMPTrend([record(9, '21'), record(10, '22'), record(12, '23')]);
    expect(result.insufficientHistory).toBe(false);
    expect(result.sampleSize).toBe(3);
    expect(result.changePercent).toBeCloseTo(((12 - 9) / 9) * 100, 5);
  });
});
