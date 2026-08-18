/**
 * T-195: selector-degradation-monitor.ts tests.
 *
 * Pre-fix, there was NO detector for the #1 silent-failure mode: a source
 * that keeps "succeeding" (non-empty HTTP response, no thrown error) while
 * its selectors quietly stop matching real content, writing zero rows or
 * mostly-blank fields. These tests fail against a codebase with no such
 * module (`computeBlankFieldStats`/`evaluateAndRecordDegradation` do not
 * exist pre-fix) and prove: (a) the pure blank-rate computation is correct,
 * (b) a cold-start source (< 7 days of history) NEVER alerts regardless of
 * how bad its sample looks, and (c) a warm source alerts on zero-rows-when-
 * median-nonzero and on blank-rate exceeding its 7-day median by the margin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeBlankFieldStats,
  evaluateAndRecordDegradation,
} from '../../../src/services/selector-degradation-monitor.js';

describe('computeBlankFieldStats', () => {
  it('returns zero rate for an empty record set', () => {
    expect(computeBlankFieldStats([])).toEqual({ rowCount: 0, blankFieldRate: 0 });
  });

  it('counts null/undefined/empty-string/NaN as blank', () => {
    const records = [
      { a: 'x', b: null, c: undefined, d: '', e: '  ', f: NaN, g: 5 },
    ];
    const stats = computeBlankFieldStats(records);
    // blank: b, c, d, e, f = 5 of 7 fields
    expect(stats.rowCount).toBe(1);
    expect(stats.blankFieldRate).toBeCloseTo(5 / 7, 5);
  });

  it('computes rate across multiple rows', () => {
    const records = [
      { a: 'x', b: 'y' }, // 0 blank / 2
      { a: null, b: null }, // 2 blank / 2
    ];
    const stats = computeBlankFieldStats(records);
    expect(stats.rowCount).toBe(2);
    expect(stats.blankFieldRate).toBeCloseTo(2 / 4, 5);
  });
});

describe('evaluateAndRecordDegradation', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
    process.env.NOTIFIER_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env.NOTIFIER_URL;
    delete process.env.NOTIFIER_KEY;
  });

  function makeRedis(overrides: Partial<Record<'get' | 'set' | 'lrange' | 'lpush' | 'ltrim', any>> = {}) {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      lrange: vi.fn().mockResolvedValue([]),
      lpush: vi.fn().mockResolvedValue(1),
      ltrim: vi.fn().mockResolvedValue('OK'),
      ...overrides,
    };
  }

  it('cold start: a brand-new source (no first-seen key) never alerts, even on a zero-row sample', async () => {
    const redis = makeRedis(); // get() -> null -> first-seen written now
    const now = new Date('2026-08-18T12:00:00Z');

    const result = await evaluateAndRecordDegradation(redis, 'NSE', { rowCount: 0, blankFieldRate: 1 }, now);

    expect(result.coldStart).toBe(true);
    expect(result.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // still records the sample for future baselining
    expect(redis.lpush).toHaveBeenCalledTimes(1);
  });

  it('cold start: a source with < 7 days of first-seen history never alerts', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const sixDaysAgo = now.getTime() - 6 * 24 * 60 * 60 * 1000;
    const redis = makeRedis({
      get: vi.fn().mockResolvedValue(String(sixDaysAgo)),
      lrange: vi.fn().mockResolvedValue([
        JSON.stringify({ rowCount: 50, blankFieldRate: 0.1, timestamp: sixDaysAgo }),
      ]),
    });

    const result = await evaluateAndRecordDegradation(redis, 'NSE', { rowCount: 0, blankFieldRate: 1 }, now);

    expect(result.coldStart).toBe(true);
    expect(result.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warm source: normal sample matching the 7-day median does not alert', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const eightDaysAgo = now.getTime() - 8 * 24 * 60 * 60 * 1000;
    const history = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ rowCount: 40, blankFieldRate: 0.1, timestamp: now.getTime() - i * 60 * 60 * 1000 })
    );
    const redis = makeRedis({
      get: vi.fn().mockResolvedValue(String(eightDaysAgo)),
      lrange: vi.fn().mockResolvedValue(history),
    });

    const result = await evaluateAndRecordDegradation(redis, 'NSE', { rowCount: 42, blankFieldRate: 0.12 }, now);

    expect(result.coldStart).toBe(false);
    expect(result.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warm source: zero rows when the 7-day median is non-zero fires a P1 alert', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const eightDaysAgo = now.getTime() - 8 * 24 * 60 * 60 * 1000;
    const history = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ rowCount: 40, blankFieldRate: 0.1, timestamp: now.getTime() - i * 60 * 60 * 1000 })
    );
    const redis = makeRedis({
      get: vi.fn().mockResolvedValue(String(eightDaysAgo)),
      lrange: vi.fn().mockResolvedValue(history),
    });

    const result = await evaluateAndRecordDegradation(redis, 'BSE', { rowCount: 0, blankFieldRate: 0 }, now);

    expect(result.alerted).toBe(true);
    expect(result.reasons.join(' ')).toContain('zero rows');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3300/notify');
    const body = JSON.parse(init.body);
    expect(body.severity).toBe('P1');
    expect(body.title).toContain('BSE');
  });

  it('warm source: blank rate exceeding the 7-day median by more than the margin fires a P1 alert', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const eightDaysAgo = now.getTime() - 8 * 24 * 60 * 60 * 1000;
    const history = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ rowCount: 40, blankFieldRate: 0.1, timestamp: now.getTime() - i * 60 * 60 * 1000 })
    );
    const redis = makeRedis({
      get: vi.fn().mockResolvedValue(String(eightDaysAgo)),
      lrange: vi.fn().mockResolvedValue(history),
    });

    // median 0.1 + 0.15 margin = 0.25 threshold; 0.9 clearly exceeds it (a selector break)
    const result = await evaluateAndRecordDegradation(redis, 'CHITTORGARH', { rowCount: 38, blankFieldRate: 0.9 }, now);

    expect(result.alerted).toBe(true);
    expect(result.reasons.join(' ')).toContain('blank-field rate');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is fail-open: a Redis read error is treated as cold-start and never throws', async () => {
    const redis = makeRedis({
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await expect(
      evaluateAndRecordDegradation(redis, 'NSE', { rowCount: 0, blankFieldRate: 1 }, new Date())
    ).resolves.toMatchObject({ coldStart: true, alerted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is fail-open: a Redis write error does not throw or block the evaluation result', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const eightDaysAgo = now.getTime() - 8 * 24 * 60 * 60 * 1000;
    const redis = makeRedis({
      get: vi.fn().mockResolvedValue(String(eightDaysAgo)),
      lrange: vi.fn().mockResolvedValue([
        JSON.stringify({ rowCount: 40, blankFieldRate: 0.1, timestamp: now.getTime() }),
      ]),
      lpush: vi.fn().mockRejectedValue(new Error('write failed')),
    });

    await expect(
      evaluateAndRecordDegradation(redis, 'NSE', { rowCount: 41, blankFieldRate: 0.1 }, now)
    ).resolves.toMatchObject({ coldStart: false, alerted: false });
  });
});
