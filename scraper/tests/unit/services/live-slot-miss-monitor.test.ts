/**
 * Item 21, OD-72 + OD-93 (fix round 1): a missed live slot raises an ADMIN
 * alert naming the IPO and the slot -- once per IPO per IST day, plus one
 * end-of-day summary -- and never a public label. Round 1 of review found the
 * first version sent one alert per slot (17 a weekday on staging), judged only
 * the last slot (a skipped wake was never judged) and claimed before sending.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkLiveSlotMisses,
  completedLiveSlotsToday,
  lastCompletedLiveSlot,
  LIVE_SLOT_STARTS_IST_MINUTES,
  type LiveSlot,
  type SlotCoverage,
} from '../../../src/services/live-slot-miss-monitor.js';
import { sendOwnerAlert } from '../../../src/services/owner-notify.js';

const AT_1120 = new Date('2026-09-24T05:50:00Z'); // 11:20 IST: slots 10:00 and 10:30 have ended
const AT_1850 = new Date('2026-09-24T13:20:00Z'); // 18:50 IST: all 17 have ended

describe('live slots (IST, 17 half-hour slots 10:00-18:30)', () => {
  it('has 17 slots, first 10:00, last 18:00', () => {
    expect(LIVE_SLOT_STARTS_IST_MINUTES).toHaveLength(17);
    expect(LIVE_SLOT_STARTS_IST_MINUTES[16]).toBe(1080);
  });
  it('11:20 IST -> the 10:00 and 10:30 slots have ended, with IST keys and UTC bounds', () => {
    const s = completedLiveSlotsToday(AT_1120);
    expect(s.map((x) => x.key)).toEqual(['2026-09-24T10:00', '2026-09-24T10:30']);
    expect(s[1].startUtc.toISOString()).toBe('2026-09-24T05:00:00.000Z');
    expect(s[1].endUtc.toISOString()).toBe('2026-09-24T05:30:00.000Z');
  });
  it('before 10:30 IST nothing has ended; after 18:30 all 17 have', () => {
    expect(completedLiveSlotsToday(new Date('2026-09-24T04:50:00Z'))).toEqual([]);
    expect(completedLiveSlotsToday(AT_1850)).toHaveLength(17);
    expect(lastCompletedLiveSlot(AT_1850)!.key).toBe('2026-09-24T18:00');
  });
});

/** Coverage where `missing[slug]` lists the slot labels that slug missed. */
function coverage(missing: Record<string, string[]>) {
  return async (slots: LiveSlot[]): Promise<SlotCoverage[]> =>
    Object.keys(missing).flatMap((slug) =>
      slots.map((sl) => ({
        id: slug,
        slug,
        companyName: slug.toUpperCase(),
        slotKey: sl.key,
        covered: !missing[slug].includes(sl.label),
      }))
    );
}

function harness(missing: Record<string, string[]>, sendOk = true) {
  const claimed = new Set<string>();
  const send = vi.fn(async (..._args: unknown[]) =>
    sendOk ? { sent: true } : { sent: false, reason: 'Notifier returned HTTP 503' }
  );
  return {
    claimed,
    send,
    deps: {
      env: 'staging',
      loadDayCoverage: coverage(missing),
      isClaimed: async (k: string) => claimed.has(k),
      claim: async (k: string) => {
        claimed.add(k);
      },
      send,
    },
  };
}

type Call = [string, string, { dedupeKey: string; body: string }];

describe('checkLiveSlotMisses', () => {
  it('ONE alert per IPO per day at its FIRST missed slot, across every wake of the day', async () => {
    const h = harness({ 'anand-seamless-ltd': ['10:00', '10:30', '11:00', '11:30'], 'armee-infotech-ltd': [] });
    for (const t of ['2026-09-24T05:20:00Z', '2026-09-24T05:50:00Z', '2026-09-24T06:20:00Z', '2026-09-24T06:50:00Z']) {
      await checkLiveSlotMisses({ ...h.deps, now: new Date(t) });
    }
    expect(h.send).toHaveBeenCalledTimes(1);
    const [sev, title, opts] = h.send.mock.calls[0] as unknown as Call;
    expect(sev).toBe('P2');
    expect(title).toBe('[staging] Live refresh missed: ANAND-SEAMLESS-LTD at 10:00 IST on 2026-09-24');
    expect(opts.dedupeKey).toBe('live-slot-miss:staging:anand-seamless-ltd:2026-09-24');
    expect(opts.body).toContain('10:00-10:30 IST');
  });

  it('a skipped wake is still judged: the first wake at 11:20 judges 10:00 as well as 10:30', async () => {
    const h = harness({ 'x-ltd': ['10:00'] });
    const r = await checkLiveSlotMisses({ ...h.deps, now: AT_1120 });
    expect(r.slotsJudged).toBe(2);
    expect(r.missedIpos).toEqual(['x-ltd']);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('after 18:30 IST one end-of-day summary lists each IPO with ALL its missed slots, once', async () => {
    const h = harness({ 'a-ltd': ['10:00', '14:00'], 'b-ltd': ['18:00'], 'c-ltd': [] });
    await checkLiveSlotMisses({ ...h.deps, now: AT_1850 });
    await checkLiveSlotMisses({ ...h.deps, now: new Date('2026-09-24T13:50:00Z') });
    const calls = h.send.mock.calls as unknown as Call[];
    const summaries = calls.filter((c) => c[1].includes('summary'));
    expect(summaries.map((c) => c[1])).toEqual(['[staging] Live refresh summary 2026-09-24: 2 IPO(s) missed slots']);
    expect(h.send).toHaveBeenCalledTimes(3); // a-ltd, b-ltd, summary -- nothing on the second wake
    expect(summaries[0][2].body).toContain('A-LTD (a-ltd): 2 of 17 slots missed - 10:00, 14:00');
    expect(summaries[0][2].body).toContain('B-LTD (b-ltd): 1 of 17 slots missed - 18:00');
    expect(summaries[0][2].body).not.toContain('c-ltd');
  });

  it('a failed send is NOT claimed: the next wake retries it', async () => {
    const h = harness({ 'x-ltd': ['10:00'] }, false);
    const r = await checkLiveSlotMisses({ ...h.deps, now: AT_1120 });
    expect(r.alertsSent).toBe(0);
    expect(r.unsent).toEqual(['live-slot-miss:staging:x-ltd:2026-09-24']);
    expect(h.claimed.size).toBe(0);
    await checkLiveSlotMisses({ ...h.deps, now: AT_1120 });
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('every bidding IPO refreshed -> nothing sent', async () => {
    const h = harness({ 'armee-infotech-ltd': [] });
    await checkLiveSlotMisses({ ...h.deps, now: AT_1850 });
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('sendOwnerAlert (the real HTTP path, stubbed)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('says NOT sent when the Notifier is not configured, and makes no request', async () => {
    vi.stubEnv('NOTIFIER_URL', '');
    vi.stubEnv('NOTIFIER_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await sendOwnerAlert('P2', 't')).toEqual({
      sent: false,
      reason: 'Notifier not configured (NOTIFIER_URL/NOTIFIER_KEY unset)',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('a non-OK Notifier response is NOT sent, with the status as the reason', async () => {
    vi.stubEnv('NOTIFIER_URL', 'http://n.test');
    vi.stubEnv('NOTIFIER_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 }) as Response));
    expect(await sendOwnerAlert('P2', 't')).toEqual({ sent: false, reason: 'Notifier returned HTTP 503' });
  });

  it('an accepted alert is sent, with the dedupeKey in the payload', async () => {
    vi.stubEnv('NOTIFIER_URL', 'http://n.test');
    vi.stubEnv('NOTIFIER_KEY', 'k');
    const f = vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', f);
    expect(await sendOwnerAlert('P2', 't', { dedupeKey: 'd' })).toEqual({ sent: true });
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).dedupeKey).toBe('d');
  });
});
