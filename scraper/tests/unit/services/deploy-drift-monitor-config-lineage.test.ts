/**
 * #793 M3: the config/code LINEAGE check in deploy-drift-monitor.ts.
 *
 * The precondition for the whole failure class is that a slot's CODE and its
 * shared CONFIG can come from different commits, because they ship on different
 * paths — a code deploy never overwrites `shared/config/<slot>/`, only
 * `deploy-config.sh` does. On 2026-09-19 staging served `b12c9d28` against a
 * config from `9c20b4d0`, the newer schema refused all 190 fields, and the
 * scraper died at start every 30 minutes for six hours.
 *
 * The load-bearing assertions here: drift PAGES (and names the recovery
 * command), matching shas are SILENT, "release" is not a drift, an unreadable
 * sha is never reported as in-sync, and a persistent drift pages exactly once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkConfigLineage, checkDeployDrift } from '../../../src/services/deploy-drift-monitor.js';

const SERVED_SHA = 'b12c9d28';
const CONFIG_SHA_SAME = 'b12c9d28' + 'f'.repeat(32);
const CONFIG_SHA_OLD = '9c20b4d0' + 'e'.repeat(32);

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    __store: store,
  };
}

describe('checkConfigLineage (#793)', () => {
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notify = vi.fn();
  });

  it('PAGES when the deployed config is from a different commit than the served code', async () => {
    const redis = makeRedis();

    const result = await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    });

    expect(result.drifting).toBe(true);
    expect(result.alerted).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    // The page must be actionable on its own: both shas and the exact recovery
    // command. The 2026-09-19 recovery was a human remembering deploy-config.sh.
    const [severity, title, opts] = notify.mock.calls[0];
    expect(severity).toBe('P2');
    expect(title).toContain('staging');
    expect(opts.body).toContain('b12c9d28');
    expect(opts.body).toContain('9c20b4d0');
    expect(opts.body).toContain('deploy-config.sh --slot staging');
  });

  it('pages P1 for prod, P2 for staging', async () => {
    const prodNotify = vi.fn();
    await checkConfigLineage('prod', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis: makeRedis(),
      notify: prodNotify,
    });
    expect(prodNotify.mock.calls[0][0]).toBe('P1');
  });

  it('is SILENT when the config sha matches the served sha by prefix (8-char served vs 40-char config)', async () => {
    const result = await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_SAME,
      redis: makeRedis(),
      notify,
    });

    expect(result.drifting).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('treats CONFIG_SHA="release" as in-sync — the deploy seeded it from this release\'s own tree', async () => {
    const result = await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => 'release',
      redis: makeRedis(),
      notify,
    });

    expect(result.drifting).toBe(false);
    expect(result.reason).toBe('config-seeded-from-release');
    expect(notify).not.toHaveBeenCalled();
  });

  it('an unreadable CONFIG_SHA reports "cannot tell", never a silent in-sync', async () => {
    const result = await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => null,
      redis: makeRedis(),
      notify,
    });

    expect(result.drifting).toBe(false);
    expect(result.reason).toBe('config-sha-unknown');
    expect(notify).not.toHaveBeenCalled();
  });

  it('pages ONCE per (slot, servedSha) — a drift that persists does not re-page every hour', async () => {
    const redis = makeRedis();
    const deps = {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    };

    const first = await checkConfigLineage('staging', deps);
    const second = await checkConfigLineage('staging', deps);

    expect(first.alerted).toBe(true);
    expect(second.alerted).toBe(false);
    expect(second.reason).toBe('already-alerted');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a NEW deploy after a drift re-arms the alert (state is keyed on the served sha)', async () => {
    const redis = makeRedis();
    let served = SERVED_SHA;

    await checkConfigLineage('staging', {
      getServedSha: async () => served,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    });
    served = 'aabbccdd';
    await checkConfigLineage('staging', {
      getServedSha: async () => served,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    });

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('clears its state once the config catches up, so the NEXT drift pages again', async () => {
    const redis = makeRedis();

    await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    });
    // deploy-config.sh runs: config now matches.
    await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_SAME,
      redis,
      notify,
    });
    // It drifts again against the same served sha.
    const third = await checkConfigLineage('staging', {
      getServedSha: async () => SERVED_SHA,
      getConfigSha: async () => CONFIG_SHA_OLD,
      redis,
      notify,
    });

    expect(third.alerted).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('checkDeployDrift wires the lineage check into the hourly cycle (#793)', () => {
  it('runs the config check for BOTH slots and pages on drift', async () => {
    const notify = vi.fn();
    const getConfigSha = vi.fn(async () => CONFIG_SHA_OLD);

    await checkDeployDrift({
      getMainSha: async () => CONFIG_SHA_SAME,
      getServedSha: async () => SERVED_SHA,
      getConfigSha,
      redis: makeRedis(),
      notify,
      now: () => new Date('2026-09-19T03:00:00Z'),
    });

    expect(getConfigSha).toHaveBeenCalledTimes(2);
    expect(getConfigSha).toHaveBeenCalledWith('prod');
    expect(getConfigSha).toHaveBeenCalledWith('staging');

    const configPages = notify.mock.calls.filter(([, , opts]) => opts?.type === 'config-lineage-drift');
    expect(configPages).toHaveLength(2);
  });

  it('still checks config lineage when origin is unreachable — both shas come from the box', async () => {
    const notify = vi.fn();
    const getConfigSha = vi.fn(async () => CONFIG_SHA_OLD);

    await checkDeployDrift({
      getMainSha: async () => null,
      getServedSha: async () => SERVED_SHA,
      getConfigSha,
      redis: makeRedis(),
      notify,
    });

    const configPages = notify.mock.calls.filter(([, , opts]) => opts?.type === 'config-lineage-drift');
    expect(configPages.length).toBeGreaterThan(0);
  });
});
