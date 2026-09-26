import { describe, it, expect } from 'vitest';
import { readWakeTrigger, WAKE_TRIGGERS } from '../../../src/scheduler/wake-trigger.js';

// #698: the value written to scraper_steps.trigger. assert-repair-held counts
// only 'schedule', so anything that is not exactly one of the three labels must
// collapse to 'unknown' (never counted) rather than pass through.
describe('readWakeTrigger', () => {
  it('passes the three valid labels through unchanged', () => {
    for (const t of WAKE_TRIGGERS) expect(readWakeTrigger({ SCRAPER_WAKE_TRIGGER: t })).toBe(t);
    expect([...WAKE_TRIGGERS]).toEqual(['schedule', 'deploy', 'unknown']);
  });

  it.each([undefined, '', 'Schedule', ' schedule', 'schedule ', 'cron', 'restart', "schedule'; drop"])(
    'maps %j to unknown',
    (value) => {
      const env = value === undefined ? {} : { SCRAPER_WAKE_TRIGGER: value };
      expect(readWakeTrigger(env)).toBe('unknown');
    }
  );
});
