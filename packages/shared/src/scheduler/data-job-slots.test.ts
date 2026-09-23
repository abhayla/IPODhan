// implements: docs/design/data-sourcing-pull-model.md §2.1 (OD-19) -- the data
// job's three IST slots are defined ONCE, here, and everything else derives
// from them.
import { describe, it, expect } from 'vitest';
import {
  DATA_JOB_SLOTS_IST_MINUTES,
  mostRecentDataJobSlotBoundary,
  isDataJobDue,
  longestDataJobSlotGapMinutes,
  dataJobFreshnessMaxAgeMinutes,
  DATA_JOB_FRESHNESS_GRACE_MINUTES,
  parseDataJobSlotsFromSource,
} from './data-job-slots';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function ist(dateIso: string, hh: number, mm: number): Date {
  return new Date(Date.parse(`${dateIso}T00:00:00.000Z`) + (hh * 60 + mm - 330) * 60_000);
}

describe('DATA_JOB_SLOTS_IST_MINUTES (OD-19)', () => {
  it('is exactly 00:00, 08:00 and 14:00 IST', () => {
    expect([...DATA_JOB_SLOTS_IST_MINUTES]).toEqual([0, 480, 840]);
  });

  it('parses back out of its own source text (the form plain-Node scripts read)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'data-job-slots.ts'), 'utf8');
    expect(parseDataJobSlotsFromSource(source)).toEqual([0, 480, 840]);
  });

  it('refuses a source whose slot list is not plain integers (a parser that guesses is not a guard)', () => {
    expect(() => parseDataJobSlotsFromSource('export const DATA_JOB_SLOTS_IST_MINUTES = [8 * 60] as const;')).toThrow();
    expect(() => parseDataJobSlotsFromSource('nothing here')).toThrow();
  });
});

describe('isDataJobDue — only at a slot, catch-up safe', () => {
  it('is due at each slot when the previous slot has run', () => {
    expect(isDataJobDue(ist('2026-09-15', 0, 0), ist('2026-09-14', 14, 5))).toBe(true);
    expect(isDataJobDue(ist('2026-09-15', 8, 0), ist('2026-09-15', 0, 5))).toBe(true);
    expect(isDataJobDue(ist('2026-09-15', 14, 0), ist('2026-09-15', 8, 5))).toBe(true);
  });

  it('is NOT due at the retired D-13 minutes once the slot before them has run', () => {
    expect(isDataJobDue(ist('2026-09-15', 8, 30), ist('2026-09-15', 8, 0))).toBe(false);
    expect(isDataJobDue(ist('2026-09-15', 10, 30), ist('2026-09-15', 8, 0))).toBe(false);
    expect(isDataJobDue(ist('2026-09-15', 11, 0), ist('2026-09-15', 8, 0))).toBe(false);
    expect(isDataJobDue(ist('2026-09-15', 17, 30), ist('2026-09-15', 14, 0))).toBe(false);
    expect(isDataJobDue(ist('2026-09-15', 23, 59), ist('2026-09-15', 14, 0))).toBe(false);
  });

  it('never run before = due', () => {
    expect(isDataJobDue(ist('2026-09-15', 10, 30), null)).toBe(true);
  });

  it('a missed slot still fires on the next wake that sees it (catch-up)', () => {
    expect(isDataJobDue(ist('2026-09-15', 9, 30), ist('2026-09-15', 0, 10))).toBe(true);
  });

  it('runs exactly three times across a day of 30-minute wakes', () => {
    let last: Date | null = ist('2026-09-14', 23, 59);
    let runs = 0;
    for (let m = 0; m < 1440; m += 30) {
      const now = ist('2026-09-15', Math.floor(m / 60), m % 60);
      if (isDataJobDue(now, last)) {
        runs++;
        last = now;
      }
    }
    expect(runs).toBe(3);
  });
});

describe('mostRecentDataJobSlotBoundary', () => {
  it('returns the slot instant at each slot minute, and the previous slot between them', () => {
    expect(mostRecentDataJobSlotBoundary(ist('2026-09-15', 8, 0)).getTime()).toBe(ist('2026-09-15', 8, 0).getTime());
    expect(mostRecentDataJobSlotBoundary(ist('2026-09-15', 13, 59)).getTime()).toBe(ist('2026-09-15', 8, 0).getTime());
    expect(mostRecentDataJobSlotBoundary(ist('2026-09-15', 23, 0)).getTime()).toBe(ist('2026-09-15', 14, 0).getTime());
    expect(mostRecentDataJobSlotBoundary(ist('2026-09-15', 0, 1)).getTime()).toBe(ist('2026-09-15', 0, 0).getTime());
  });
});

describe('freshness max age is derived from the slot list, not typed', () => {
  it('longest gap is 14:00 -> 00:00 = 600 minutes', () => {
    expect(longestDataJobSlotGapMinutes()).toBe(600);
  });

  it('max age = longest gap + 1 h grace = 11 h', () => {
    expect(DATA_JOB_FRESHNESS_GRACE_MINUTES).toBe(60);
    expect(dataJobFreshnessMaxAgeMinutes()).toBe(11 * 60);
  });

  it('moves when the slot list moves (the derivation is real)', () => {
    expect(longestDataJobSlotGapMinutes([510, 660, 840, 1050])).toBe(900);
    expect(dataJobFreshnessMaxAgeMinutes([510, 660, 840, 1050])).toBe(960);
  });
});
