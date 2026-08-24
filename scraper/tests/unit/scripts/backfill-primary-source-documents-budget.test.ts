import { describe, it, expect, vi } from 'vitest';
import { withTimeout, isBudgetExhausted } from '../../../src/scripts/backfill-primary-source-documents.js';

// T-311F MEDIUM: triggerPrimarySourceDiscovery() awaits runPrimaryDocBackfill()
// inside the same one-shot `*/30` cron cycle as the job-completion heartbeat,
// with no bound on the per-IPO NSE fetch loop. These two guards (a per-fetch
// timeout and a total time budget) are unit-tested directly rather than via
// the full DB-backed runPrimaryDocBackfill(), which needs a live Postgres
// candidate query and a DocumentRepository — the guards themselves are pure
// and DB-independent, so this is the targeted, fast layer for them.

describe('withTimeout', () => {
  it('resolves with the promise value when it settles before the timeout', async () => {
    const fast = Promise.resolve('done');
    await expect(withTimeout(fast, 50, 'fast-op')).resolves.toBe('done');
  });

  it('rejects with a labeled timeout error when the promise is slower than the timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('too-late'), 200));
    await expect(withTimeout(slow, 20, 'slow-op')).rejects.toThrow('slow-op timed out after 20ms');
  });

  it('propagates the underlying promise rejection when it rejects before the timeout', async () => {
    const failing = Promise.reject(new Error('network error'));
    await expect(withTimeout(failing, 50, 'failing-op')).rejects.toThrow('network error');
  });

  it('clears its internal timer so a slow-but-resolved promise does not leave a dangling handle', async () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      await withTimeout(Promise.resolve('ok'), 1000, 'op');
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isBudgetExhausted', () => {
  it('is false when elapsed time is under the budget', () => {
    expect(isBudgetExhausted(1000, 5000, 1000 + 4999)).toBe(false);
  });

  it('is true once elapsed time reaches the budget (inclusive boundary)', () => {
    expect(isBudgetExhausted(1000, 5000, 1000 + 5000)).toBe(true);
  });

  it('is true once elapsed time exceeds the budget', () => {
    expect(isBudgetExhausted(1000, 5000, 1000 + 5001)).toBe(true);
  });

  it('defaults `nowMs` to the real clock when omitted', () => {
    const startedAt = Date.now() - 10; // 10ms ago
    expect(isBudgetExhausted(startedAt, 60_000)).toBe(false);
  });
});
