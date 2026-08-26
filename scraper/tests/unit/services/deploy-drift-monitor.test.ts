/**
 * T-324 ITEM 2: deploy-drift-monitor.ts tests.
 *
 * `checkDeployDrift` compares each slot's served sha against origin/main
 * HEAD (both injected here -- these tests never shell out to `git` or hit
 * a real network). Per the DoD: behind -> alert (once past the 60-min
 * grace period), equal -> silent, and a repeat check against the SAME
 * drift (same mainSha) must NOT alert a second time ("one page per drift,
 * not one per hour").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDeployDrift, type DriftState } from '../../../src/services/deploy-drift-monitor.js';

const MAIN_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    __store: store,
  };
}

describe('checkDeployDrift', () => {
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notify = vi.fn();
  });

  it('is silent when both slots are in sync with main', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async () => MAIN_SHA);

    const results = await checkDeployDrift({
      getMainSha: async () => MAIN_SHA,
      getServedSha,
      redis,
      notify,
      now: () => new Date('2026-08-26T00:00:00Z'),
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.drifting && !r.alerted)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does NOT alert on a fresh drift still inside the 60-min grace period', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async (slot: string) => (slot === 'prod' ? OTHER_SHA : MAIN_SHA));

    const results = await checkDeployDrift({
      getMainSha: async () => MAIN_SHA,
      getServedSha,
      redis,
      notify,
      now: () => new Date('2026-08-26T00:00:00Z'),
    });

    const prodResult = results.find((r) => r.slot === 'prod')!;
    expect(prodResult.drifting).toBe(true);
    expect(prodResult.alerted).toBe(false);
    expect(prodResult.reason).toBe('grace-period');
    expect(notify).not.toHaveBeenCalled();
  });

  it('alerts P1 for prod once the SAME drift has persisted past 60 minutes', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async () => OTHER_SHA);
    const firstCheck = new Date('2026-08-26T00:00:00Z');
    const secondCheck = new Date('2026-08-26T01:01:00Z'); // 61 min later

    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => firstCheck });
    expect(notify).not.toHaveBeenCalled();

    const results = await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => secondCheck });

    const prodResult = results.find((r) => r.slot === 'prod')!;
    expect(prodResult.alerted).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      'P1',
      expect.stringContaining('prod'),
      expect.objectContaining({ dedupeKey: MAIN_SHA, type: 'deploy-drift' })
    );
  });

  it('alerts P2 (not P1) for staging drift', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async (slot: string) => (slot === 'staging' ? OTHER_SHA : MAIN_SHA));
    const firstCheck = new Date('2026-08-26T00:00:00Z');
    const secondCheck = new Date('2026-08-26T01:01:00Z');

    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => firstCheck });
    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => secondCheck });

    expect(notify).toHaveBeenCalledWith('P2', expect.stringContaining('staging'), expect.anything());
  });

  it('dedupe holds: a repeat check against the SAME drift does not alert a second time', async () => {
    const redis = makeRedis();
    // Only prod drifts -- isolates the notify-count assertion below to one slot.
    const getServedSha = vi.fn(async (slot: string) => (slot === 'prod' ? OTHER_SHA : MAIN_SHA));
    const t0 = new Date('2026-08-26T00:00:00Z');
    const t1 = new Date('2026-08-26T01:01:00Z');
    const t2 = new Date('2026-08-26T02:01:00Z');
    const t3 = new Date('2026-08-26T03:01:00Z');

    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t0 });
    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t1 });
    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t2 });
    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t3 });

    // Only the t1 cycle (first crossing past the grace period) should have alerted.
    const prodAlerts = notify.mock.calls.filter((c) => c[1].includes('prod'));
    expect(prodAlerts).toHaveLength(1);
  });

  it('re-alerts once main moves again while still drifting (a NEW drift, different mainSha)', async () => {
    const redis = makeRedis();
    // staging tracks whichever mainSha is current, so only prod ever drifts.
    let currentMainSha = MAIN_SHA;
    const getServedSha = vi.fn(async (slot: string) => (slot === 'prod' ? OTHER_SHA : currentMainSha));
    const t0 = new Date('2026-08-26T00:00:00Z');
    const t1 = new Date('2026-08-26T01:01:00Z');

    await checkDeployDrift({ getMainSha: async () => currentMainSha, getServedSha, redis, notify, now: () => t0 });
    await checkDeployDrift({ getMainSha: async () => currentMainSha, getServedSha, redis, notify, now: () => t1 });
    let prodAlerts = notify.mock.calls.filter((c) => c[1].includes('prod'));
    expect(prodAlerts).toHaveLength(1);

    // main moved forward again; still behind, but against a NEW sha -- grace period restarts.
    currentMainSha = 'c'.repeat(40);
    const t2 = new Date('2026-08-26T01:05:00Z');
    const t3 = new Date('2026-08-26T02:10:00Z');
    await checkDeployDrift({ getMainSha: async () => currentMainSha, getServedSha, redis, notify, now: () => t2 });
    prodAlerts = notify.mock.calls.filter((c) => c[1].includes('prod'));
    expect(prodAlerts).toHaveLength(1); // still grace period for the new sha

    await checkDeployDrift({ getMainSha: async () => currentMainSha, getServedSha, redis, notify, now: () => t3 });
    prodAlerts = notify.mock.calls.filter((c) => c[1].includes('prod'));
    expect(prodAlerts).toHaveLength(2);
  });

  it('clears drift state once a slot catches back up to main (no alert on a subsequent unrelated drift restart)', async () => {
    const redis = makeRedis();
    let served = OTHER_SHA;
    const getServedSha = vi.fn(async (slot: string) => (slot === 'prod' ? served : MAIN_SHA));
    const t0 = new Date('2026-08-26T00:00:00Z');
    const t1 = new Date('2026-08-26T01:01:00Z');

    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t0 });
    await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t1 });
    expect(notify.mock.calls.filter((c) => c[1].includes('prod'))).toHaveLength(1);

    // Caught up.
    served = MAIN_SHA;
    const t2 = new Date('2026-08-26T01:10:00Z');
    const caughtUpResults = await checkDeployDrift({ getMainSha: async () => MAIN_SHA, getServedSha, redis, notify, now: () => t2 });
    expect(caughtUpResults.every((r) => !r.drifting)).toBe(true);

    const stateRaw = await redis.get('deploy-drift:state:prod');
    expect(stateRaw).toBeNull();
  });

  it('does not alert and clears state when the served sha cannot be determined (probe failure)', async () => {
    const redis = makeRedis({
      'deploy-drift:state:prod': JSON.stringify({
        mainSha: MAIN_SHA,
        firstSeenAt: new Date('2026-08-26T00:00:00Z').toISOString(),
        alertedForSha: null,
      } satisfies DriftState),
    });
    const getServedSha = vi.fn(async () => null);

    const results = await checkDeployDrift({
      getMainSha: async () => MAIN_SHA,
      getServedSha,
      redis,
      notify,
      now: () => new Date('2026-08-26T02:00:00Z'),
    });

    expect(results.every((r) => r.reason === 'served-sha-unknown')).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(await redis.get('deploy-drift:state:prod')).toBeNull();
  });

  it('returns an empty result set (no alert) when mainSha cannot be resolved', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async () => OTHER_SHA);

    const results = await checkDeployDrift({
      getMainSha: async () => null,
      getServedSha,
      redis,
      notify,
    });

    expect(results).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(getServedSha).not.toHaveBeenCalled();
  });

  describe('real-value sha lengths (8-char served vs 40-char main)', () => {
    // deploy-linux.sh:394 serves NEXT_PUBLIC_BUILD_SHA=$SHORT_SHA (8 hex
    // chars); getMainShaFromOrigin returns the full 40-char origin/main
    // sha. A strict `===` between the two can never match -- these are the
    // ACTUAL values from a real in-sync deploy, not test-only 40-vs-40
    // fixtures, so they catch the regression the shape-only fixtures above
    // (both sides always 40 chars) missed entirely.
    const SERVED_SHORT = 'd002d234';
    const MAIN_MATCHING_FULL = 'd002d2340ab167810b0511c3e45d3220af48f651';
    const MAIN_DIFFERENT_FULL = 'ffffffffffffffffffffffffffffffffffffffff';

    it('is NOT drifting when the 8-char served sha is a prefix of the 40-char main sha', async () => {
      const redis = makeRedis();
      const getServedSha = vi.fn(async () => SERVED_SHORT);

      const results = await checkDeployDrift({
        getMainSha: async () => MAIN_MATCHING_FULL,
        getServedSha,
        redis,
        notify,
        now: () => new Date('2026-08-26T00:00:00Z'),
      });

      expect(results.every((r) => !r.drifting && !r.alerted)).toBe(true);
      expect(notify).not.toHaveBeenCalled();
    });

    it('IS drifting (and alerts past grace) when the 8-char served sha does not match a different 40-char main sha', async () => {
      const redis = makeRedis();
      const getServedSha = vi.fn(async () => SERVED_SHORT);
      const t0 = new Date('2026-08-26T00:00:00Z');
      const t1 = new Date('2026-08-26T01:01:00Z'); // 61 min later, past grace

      await checkDeployDrift({ getMainSha: async () => MAIN_DIFFERENT_FULL, getServedSha, redis, notify, now: () => t0 });
      expect(notify).not.toHaveBeenCalled();

      const results = await checkDeployDrift({ getMainSha: async () => MAIN_DIFFERENT_FULL, getServedSha, redis, notify, now: () => t1 });

      expect(results.every((r) => r.drifting)).toBe(true);
      const prodResult = results.find((r) => r.slot === 'prod')!;
      expect(prodResult.alerted).toBe(true);
      expect(notify).toHaveBeenCalledWith(
        'P1',
        expect.stringContaining('prod'),
        expect.objectContaining({ dedupeKey: MAIN_DIFFERENT_FULL, type: 'deploy-drift' })
      );
    });
  });

  it('does not crash when getMainSha throws (non-fatal)', async () => {
    const redis = makeRedis();
    const getServedSha = vi.fn(async () => OTHER_SHA);

    const results = await checkDeployDrift({
      getMainSha: async () => {
        throw new Error('network unreachable');
      },
      getServedSha,
      redis,
      notify,
    });

    expect(results).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});
