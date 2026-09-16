import { describe, it, expect } from 'vitest';

import {
  FRESHNESS_SLOS,
  DUE_STEP_FRESHNESS_SLOS,
} from '../../../src/config/freshness-slo.js';
import { RUNNABLE_SCRAPER_SOURCES } from '../../../src/config/runnable-sources.js';

/**
 * Item 16 slice 2 — a retired source must not keep a freshness SLO.
 *
 * Item 16 retired the Moneycontrol scraper. It did not remove Moneycontrol's
 * freshness SLO, so the monitor kept asking the database, every cycle, when
 * Moneycontrol last succeeded. It never can again.
 *
 * MEASURED, not predicted: the last SUCCESS row on staging is
 * 2026-09-10T08:15:13Z and the SLO allows seven days, so the monitor would have
 * sent the owner a P1 page at 2026-09-17T08:15Z — about a source we switched
 * off on purpose. The log line that gave it away sat six lines from the end of
 * the staging log, on the release that contains the retirement:
 * `[DB] scraper_log.getLastSuccess { source: 'MONEYCONTROL' }`.
 *
 * THE CLASS IS "retiring a source leaves its monitor behind", not "Moneycontrol
 * is in a list". Deleting the one entry would fix today and teach nothing. So
 * the assertion is against the sources the scheduler will actually run,
 * exported from the allow-list that decides it — the same array `index.ts`
 * validates `--source=` against, now in one place instead of inline.
 *
 * Also measured, because one sample is worse than two: all six SLO sources
 * currently read 0.74 to 0.86 days since their last success, so staleness alone
 * separates nothing today. Five of them advance at the next weekday
 * market-hours cycle; Moneycontrol never can. A test written against staleness
 * would find nothing this morning and fire on everything next Tuesday, which is
 * why this one is written against the ENABLED set instead.
 */
describe('every freshness SLO names a source the scheduler can still run', () => {
  const sets: [string, typeof FRESHNESS_SLOS][] = [
    ['FRESHNESS_SLOS', FRESHNESS_SLOS],
    ['DUE_STEP_FRESHNESS_SLOS', DUE_STEP_FRESHNESS_SLOS],
  ];

  for (const [name, set] of sets) {
    it(`${name} has no SLO for a retired source`, () => {
      const orphans = set
        .map((slo) => slo.source)
        .filter((source) => !RUNNABLE_SCRAPER_SOURCES.includes(source));

      expect(
        orphans,
        `these sources have a freshness SLO but the scheduler can no longer run them, so ` +
          `their last-success can never advance and the monitor will page the owner once the ` +
          `staleness limit passes: ${orphans.join(', ')}`
      ).toEqual([]);
    });
  }

  it('the runnable set is not empty, so the check cannot pass by measuring nothing', () => {
    // Without this, deleting every entry from RUNNABLE_SCRAPER_SOURCES would
    // make the assertions above vacuously true - the filter would keep
    // everything, and an empty SLO set would pass. A guard that passes when its
    // own input disappears is the failure this repository keeps finding.
    expect(RUNNABLE_SCRAPER_SOURCES.length).toBeGreaterThan(3);
    expect(FRESHNESS_SLOS.length).toBeGreaterThan(3);
    expect(DUE_STEP_FRESHNESS_SLOS.length).toBeGreaterThan(3);
  });

  it('MONEYCONTROL specifically is gone, since that is the instance that prompted this', () => {
    expect(RUNNABLE_SCRAPER_SOURCES).not.toContain('MONEYCONTROL');
    expect(FRESHNESS_SLOS.map((s) => s.source)).not.toContain('MONEYCONTROL');
    expect(DUE_STEP_FRESHNESS_SLOS.map((s) => s.source)).not.toContain('MONEYCONTROL');
  });

  it('the sources that ARE still running keep their SLOs', () => {
    // The opposite failure: "fix" this by emptying the SLO table and the
    // monitor stops watching the sources that matter.
    const dueStep = DUE_STEP_FRESHNESS_SLOS.map((s) => s.source);
    for (const source of ['NSE', 'BSE', 'CHITTORGARH', 'INVESTORGAIN_GMP'] as const) {
      expect(dueStep, `${source} is still scraped and must still be watched`).toContain(source);
    }
  });
});
