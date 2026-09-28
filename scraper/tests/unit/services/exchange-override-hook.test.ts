import { describe, it, expect, vi } from 'vitest';
import { buildExchangeOverrideHook, type ExchangeOverrideHookDeps } from '../../../src/services/exchange-override-hook.js';

const NOW = new Date('2026-08-21T05:00:00Z'); // 10:30 IST
const replaced = (status: string) => ({
  kind: 'REPLACED' as const,
  ipoId: 'ipo-1',
  slug: 'dhanwel-proof',
  companyName: 'Dhanwel Proof Limited',
  status,
  tableName: 'ipos',
  fieldName: 'closeDate',
  source: 'NSE' as const,
  adminValue: '2026-06-29',
  exchangeValue: '2026-08-21',
  exchangeAtSave: { NSE: '2026-06-29', BSE: null },
  auditId: 'audit-1',
});

function deps(over: Partial<ExchangeOverrideHookDeps> = {}) {
  const claimed = new Set<string>();
  const d = {
    apply: vi.fn(async () => replaced('OPEN')),
    send: vi.fn(async () => ({ sent: true })),
    isClaimed: vi.fn(async (k: string) => claimed.has(k)),
    claim: vi.fn(async (k: string) => {
      claimed.add(k);
    }),
    env: 'staging',
    now: () => NOW,
    ...over,
  };
  return d;
}
const answers = [{ source: 'NSE', value: '2026-08-21', at: NOW.toISOString(), outcome: 'SUPPLIED' as const }];

describe('OD-106 hook: alert and dedupe (OD-112, §9.2 items 16 and 25)', () => {
  it('a live IPO: one alert naming the IPO and both dates, claimed only after the Notifier accepted it', async () => {
    const d = deps();
    const hook = buildExchangeOverrideHook(d);
    expect(await hook('ipo-1', 'ipos', '', 'close_date', answers)).toEqual({ holdReleased: true });
    expect(d.apply).toHaveBeenCalledWith(expect.objectContaining({ ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'closeDate', rowKey: '' }));
    expect(d.send).toHaveBeenCalledTimes(1);
    const [sev, title, opts] = d.send.mock.calls[0] as unknown as [string, string, { body: string; dedupeKey: string }];
    expect(sev).toBe('P2');
    expect(title).toContain('Dhanwel Proof Limited');
    expect(opts.body).toContain('2026-06-29');
    expect(opts.body).toContain('2026-08-21');
    expect(opts.dedupeKey).toBe('admin-od106:staging:ipo-1:closeDate:2026-08-21');
    expect(d.claim).toHaveBeenCalledWith('admin-od106:staging:ipo-1:closeDate:2026-08-21');

    // Same IPO, field and IST day: no second alert.
    await hook('ipo-1', 'ipos', '', 'close_date', answers);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('a refused alert writes no claim (the next override that day may alert)', async () => {
    const d = deps({ send: vi.fn(async () => ({ sent: false, reason: 'HTTP 500' })) });
    expect(await buildExchangeOverrideHook(d)('ipo-1', 'ipos', '', 'close_date', answers)).toEqual({ holdReleased: true });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it('a non-live IPO: no instant alert (digest, item 16)', async () => {
    const d = deps({ apply: vi.fn(async () => replaced('CLOSED')) });
    expect(await buildExchangeOverrideHook(d)('ipo-1', 'ipos', '', 'close_date', answers)).toEqual({ holdReleased: true });
    expect(d.send).not.toHaveBeenCalled();
  });

  it('kept hold: no alert, hold not released', async () => {
    const d = deps({ apply: vi.fn(async () => ({ kind: 'SKIPPED' as const, reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE' })) });
    expect(await buildExchangeOverrideHook(d)('ipo-1', 'ipos', '', 'close_date', answers)).toEqual({ holdReleased: false });
    expect(d.send).not.toHaveBeenCalled();
  });

  it('a field outside the OD-106 set never reaches the override', async () => {
    const d = deps();
    const hook = buildExchangeOverrideHook(d);
    expect(await hook('ipo-1', 'ipos', '', 'issue_size', answers)).toEqual({ holdReleased: false });
    expect(await hook('ipo-1', 'ipos', '', 'status', answers)).toEqual({ holdReleased: false });
    expect(await hook('ipo-1', 'anchor_investors', 'row-a', 'bid_date', answers)).toEqual({ holdReleased: false });
    expect(d.apply).not.toHaveBeenCalled();
  });
});
