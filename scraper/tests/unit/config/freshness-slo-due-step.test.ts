/**
 * Round-3 C4 (Tier-A review of round 1): the freshness SLOs were calibrated for
 * the FLAT 30-minute cron (GMP/Chittorgarh 90 min, NSE/BSE 6h). Under the
 * due-step scheduler the sources are deliberately spaced out — discovery at 4
 * IST slots a day, aggregators and the API fallback once a day, GMP only in
 * market hours — so those thresholds would page the owner P1 every hour, all
 * night and all weekend, on a system behaving exactly as designed.
 *
 * Flag OFF must keep the legacy thresholds (the rollback path keeps its old
 * alerting).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flags = { ENABLE_DUE_STEP_SCHEDULER: false };

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: flags,
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

const { getActiveFreshnessSLOs, getFreshnessSLO, FRESHNESS_SLOS } = await import('../../../src/config/freshness-slo.js');
const { evaluateFreshness } = await import('../../../src/services/freshness-monitor.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function repoWithGap(gapMs: number, now: Date) {
  return {
    getLastSuccess: vi.fn(async () => ({ createdAt: new Date(now.getTime() - gapMs) })),
  } as any;
}

describe('round-3 C4: SLO thresholds follow the schedule that is actually running', () => {
  beforeEach(() => {
    flags.ENABLE_DUE_STEP_SCHEDULER = false;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('flag OFF: the legacy flat-cadence table is active, unchanged', () => {
    expect(getActiveFreshnessSLOs()).toBe(FRESHNESS_SLOS);
    expect(getFreshnessSLO('NSE')!.maxStalenessMs).toBe(6 * HOUR);
    expect(getFreshnessSLO('INVESTORGAIN_GMP')!.maxStalenessMs).toBe(90 * MIN);
    expect(getFreshnessSLO('INVESTORGAIN_GMP')!.marketHoursOnly).toBeUndefined();
  });

  it('flag ON: NSE/BSE 16h, aggregators + API fallback 26h, GMP market-hours-only', () => {
    flags.ENABLE_DUE_STEP_SCHEDULER = true;
    expect(getFreshnessSLO('NSE')!.maxStalenessMs).toBe(16 * HOUR);
    expect(getFreshnessSLO('BSE')!.maxStalenessMs).toBe(16 * HOUR);
    expect(getFreshnessSLO('CHITTORGARH')!.maxStalenessMs).toBe(26 * HOUR);
    expect(getFreshnessSLO('MONEYCONTROL')!.maxStalenessMs).toBe(26 * HOUR);
    expect(getFreshnessSLO('API_FALLBACK')!.maxStalenessMs).toBe(26 * HOUR);
    expect(getFreshnessSLO('INVESTORGAIN_GMP')!.marketHoursOnly).toBe(true);
  });

  it('flag ON: an 8h overnight NSE gap does NOT breach (it would page hourly under the legacy 6h)', async () => {
    flags.ENABLE_DUE_STEP_SCHEDULER = true;
    // 2026-09-05 is a Saturday; 02:00 IST = 2026-09-04T20:30Z.
    const now = new Date('2026-09-04T20:30:00.000Z');
    const evaluations = await evaluateFreshness(repoWithGap(8 * HOUR, now), now);
    const nse = evaluations.find((e) => e.source === 'NSE')!;
    expect(nse.breached).toBe(false);

    flags.ENABLE_DUE_STEP_SCHEDULER = false;
    const legacy = await evaluateFreshness(repoWithGap(8 * HOUR, now), now);
    expect(legacy.find((e) => e.source === 'NSE')!.breached).toBe(true);
  });

  it('flag ON: a Saturday 02:00 IST GMP evaluation does NOT breach (source is off-duty)', async () => {
    flags.ENABLE_DUE_STEP_SCHEDULER = true;
    // Saturday 2026-09-05 02:00 IST == 2026-09-04T20:30Z.
    const saturdayNight = new Date('2026-09-04T20:30:00.000Z');
    const evaluations = await evaluateFreshness(repoWithGap(10 * HOUR, saturdayNight), saturdayNight);
    const gmp = evaluations.find((e) => e.source === 'INVESTORGAIN_GMP')!;
    expect(gmp.breached).toBe(false);
    expect(gmp.outsideEvaluationWindow).toBe(true);
  });

  it('flag ON: a weekday 12:00 IST GMP gap of 2h DOES breach (inside the window, over 90min)', async () => {
    flags.ENABLE_DUE_STEP_SCHEDULER = true;
    // Thursday 2026-09-03 12:00 IST == 2026-09-03T06:30Z.
    const weekdayNoon = new Date('2026-09-03T06:30:00.000Z');
    const evaluations = await evaluateFreshness(repoWithGap(2 * HOUR, weekdayNoon), weekdayNoon);
    const gmp = evaluations.find((e) => e.source === 'INVESTORGAIN_GMP')!;
    expect(gmp.breached).toBe(true);
    expect(gmp.outsideEvaluationWindow).toBeUndefined();
  });
});
