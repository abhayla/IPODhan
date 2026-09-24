/**
 * Item 21, OD-72: a scheduled live refresh that misses its OD-19 slot raises an
 * ADMIN alert naming the IPO and the slot -- exactly once -- and never a public
 * label. The notifier here is the REAL notifyOwner with its HTTP call stubbed,
 * so the test counts requests that would reach the Notifier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkLiveSlotMisses,
  lastCompletedLiveSlot,
  LIVE_SLOT_STARTS_IST_MINUTES,
} from '../../../src/services/live-slot-miss-monitor.js';
import { flushOwnerNotify } from '../../../src/services/owner-notify.js';

// 2026-09-24 11:20 IST = 05:50Z: the last completed slot is 10:30-11:00 IST.
const NOW = new Date('2026-09-24T05:50:00Z');

describe('lastCompletedLiveSlot (IST, 17 half-hour slots 10:00-18:30)', () => {
  it('has 17 slots, first 10:00, last 18:00', () => {
    expect(LIVE_SLOT_STARTS_IST_MINUTES).toHaveLength(17);
    expect(LIVE_SLOT_STARTS_IST_MINUTES[0]).toBe(600);
    expect(LIVE_SLOT_STARTS_IST_MINUTES[16]).toBe(1080);
  });

  it('11:20 IST -> the 10:30 slot, stated in IST with its UTC bounds', () => {
    const s = lastCompletedLiveSlot(NOW)!;
    expect(s.key).toBe('2026-09-24T10:30');
    expect(s.startUtc.toISOString()).toBe('2026-09-24T05:00:00.000Z');
    expect(s.endUtc.toISOString()).toBe('2026-09-24T05:30:00.000Z');
  });

  it('before 10:30 IST no slot of today has ended', () => {
    expect(lastCompletedLiveSlot(new Date('2026-09-24T04:50:00Z'))).toBeNull(); // 10:20 IST
  });

  it('after 18:30 IST the 18:00 slot is judged, never a slot outside the window', () => {
    expect(lastCompletedLiveSlot(new Date('2026-09-24T13:20:00Z'))!.key).toBe('2026-09-24T18:00'); // 18:50 IST
    expect(lastCompletedLiveSlot(new Date('2026-09-24T17:00:00Z'))!.key).toBe('2026-09-24T18:00'); // 22:30 IST
  });
});

describe('checkLiveSlotMisses', () => {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  beforeEach(() => {
    vi.stubEnv('NOTIFIER_URL', 'http://notifier.test');
    vi.stubEnv('NOTIFIER_KEY', 'k');
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const coverage = async () => [
    { id: '1', slug: 'anand-seamless-ltd', companyName: 'Anand Seamless Ltd', covered: false },
    { id: '2', slug: 'armee-infotech-ltd', companyName: 'Armee Infotech Ltd', covered: true },
  ];

  function onceClaimer() {
    const seen = new Set<string>();
    return async (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  }

  it('a missed slot sends EXACTLY ONE admin alert naming the IPO and the IST slot, even across two wakes', async () => {
    const claimSlotOnce = onceClaimer();
    const r1 = await checkLiveSlotMisses({ now: NOW, loadCoverage: coverage, claimSlotOnce });
    const r2 = await checkLiveSlotMisses({ now: NOW, loadCoverage: coverage, claimSlotOnce });
    await flushOwnerNotify();

    expect(r1).toMatchObject({ alerted: true, missed: ['anand-seamless-ltd'], slot: '2026-09-24T10:30' });
    expect(r2.alerted).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(((fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(payload.title).toContain('10:30 IST');
    expect(payload.body).toContain('Anand Seamless Ltd (anand-seamless-ltd)');
    expect(payload.body).toContain('10:30-11:00 IST 2026-09-24');
    expect(payload.body).not.toContain('armee-infotech-ltd');
    expect(payload.dedupeKey).toBe('live-slot-miss:2026-09-24T10:30');
  });

  it('every bidding IPO refreshed -> no alert', async () => {
    const r = await checkLiveSlotMisses({
      now: NOW,
      loadCoverage: async () => [{ id: '2', slug: 'armee-infotech-ltd', companyName: 'Armee', covered: true }],
      claimSlotOnce: onceClaimer(),
    });
    await flushOwnerNotify();
    expect(r.alerted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('before the first slot ends, nothing is read and nothing is sent', async () => {
    const loadCoverage = vi.fn(coverage);
    const r = await checkLiveSlotMisses({ now: new Date('2026-09-24T04:50:00Z'), loadCoverage, claimSlotOnce: onceClaimer() });
    expect(r.slot).toBeNull();
    expect(loadCoverage).not.toHaveBeenCalled();
  });
});
