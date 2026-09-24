/**
 * W-38 (2026-09-02) — `createSubscriptionSnapshot` was stamping
 * `subscriptions.timestamp` with the persistence time instead of the source's
 * own observation time (`scrapedSubscription.timestamp`), so a payload NSE
 * stamped `2026-09-02T12:32:26.913Z` was stored as a much-later wall-clock
 * value. Charts/freshness checks read the wrong observation time, and a
 * stale re-write looked fresh.
 *
 * `resolveSubscriptionSnapshotTimestamp` is the pure decision function
 * `createSubscriptionSnapshot` now delegates to. Tested directly (no DB/repo
 * mocking needed) so the timestamp-resolution logic itself is covered
 * in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSubscriptionSnapshotTimestamp } from '../../../src/services/data-persister.js';
import { mapBSESubscription, type BSESubscriptionRow } from '../../../src/scrapers/bse-api-scraper.js';
import { parseIstMdyToUtcIso } from '../../../src/utils/date-string-parsing.js';

describe('resolveSubscriptionSnapshotTimestamp (W-38)', () => {
  const ctx = { ipoId: 'ipo-1', companyName: 'Deepa Jewellers' };

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('honours a present, parseable source timestamp instead of now()', () => {
    const sourceIso = '2026-09-02T12:32:26.913Z';
    const result = resolveSubscriptionSnapshotTimestamp(sourceIso, ctx);

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.toISOString()).toBe(sourceIso);
  });

  it('accepts a Date instance as the source timestamp', () => {
    const sourceDate = new Date('2026-09-01T00:00:00.000Z');
    const result = resolveSubscriptionSnapshotTimestamp(sourceDate, ctx);

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBe(sourceDate.getTime());
  });

  it('falls back to now() when the source timestamp is absent', () => {
    const before = Date.now();
    const result = resolveSubscriptionSnapshotTimestamp(undefined, ctx);
    const after = Date.now();

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it('falls back to now() when the source timestamp is unparseable', () => {
    const before = Date.now();
    const result = resolveSubscriptionSnapshotTimestamp('not-a-date', ctx);
    const after = Date.now();

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it('skips with a reason when the source timestamp is more than 5 minutes in the future', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(future, ctx);

    expect('skip' in result).toBe(true);
    if (!('skip' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/future/i);
  });

  it('skips with a reason when the source timestamp is older than 30 days', () => {
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(stale, ctx);

    expect('skip' in result).toBe(true);
    if (!('skip' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/30 days/i);
  });

  it('accepts a source timestamp within the 5-minute future tolerance', () => {
    const nearFuture = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(nearFuture, ctx);

    expect('skip' in result).toBe(false);
  });

  it('W-38 x BSE Maxdt (T-999): a same-minute BSE Maxdt figure round-trips through mapBSESubscription and is NOT skipped as "more than 5 minutes in the future" (prior bug: new Date(maxdt) parsed the zone-less IST string as UTC, storing it +5h30m ahead, which W-38 then rejected — losing the snapshot)', () => {
    const nowUtcMs = Date.now();
    const istMs = nowUtcMs + (5 * 60 + 30) * 60 * 1000;
    const ist = new Date(istMs);
    const month = ist.getUTCMonth() + 1;
    const day = ist.getUTCDate();
    const year = ist.getUTCFullYear();
    let hour24 = ist.getUTCHours();
    const minute = String(ist.getUTCMinutes()).padStart(2, '0');
    const second = String(ist.getUTCSeconds()).padStart(2, '0');
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    const maxdt = `${month}/${day}/${year} ${hour12}:${minute}:${second} ${ampm}`;

    const rows: BSESubscriptionRow[] = [
      { SRNo: '1', col2: 'Qualified Institutional Buyers (QIBs)', col5: '1.0', Maxdt: maxdt },
      { SRNo: '', col2: 'Total', col5: '1.0', Maxdt: maxdt },
    ];
    const sub = mapBSESubscription(rows, 'X Ltd');
    expect(sub).not.toBeNull();

    // Sanity: the parser itself agrees with the direct hand-built expectation.
    expect(parseIstMdyToUtcIso(maxdt)).toBe(sub!.timestamp);

    const result = resolveSubscriptionSnapshotTimestamp(sub!.timestamp, ctx);
    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error(`unreachable — got skip: ${result.reason}`);
    // Within a few seconds of real "now" (test itself takes negligible time),
    // never ~5h30m ahead (the regression this test exists to catch).
    expect(Math.abs(result.timestamp.getTime() - nowUtcMs)).toBeLessThan(5000);
  });
});
