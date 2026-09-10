/**
 * Item 21 slice 1 — the accumulator that answers "which IPOs did this cycle
 * actually write to?"
 *
 * Why it has to exist at all: OD-40 says the cycle ends by calling one endpoint
 * with the touched slugs, and the design assumes something already collects
 * them. Nothing does — `grep -rn "touchedSlugs|recordTouched|drainTouched"
 * scraper/src` returned nothing before this slice.
 *
 * The load-bearing rule is the NEGATIVE one: a re-verify that rewrote nothing
 * must not mark the page as needing a refresh. Otherwise every cycle reports
 * every IPO as touched, the endpoint revalidates all of them, and the whole
 * point — a correction reaching the page fast because only real corrections are
 * sent — is gone. A list that always contains everything carries no information.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordTouched,
  drainTouched,
  recordTouchedIfChanged,
  TOUCHED_SLUG_CAP,
} from '../../../src/services/touched-ipos-tracker.js';

describe('touched-ipos-tracker', () => {
  beforeEach(() => {
    drainTouched();
  });

  it('returns exactly what was recorded', () => {
    recordTouched('alpha-ltd');
    recordTouched('beta-ltd');
    expect(drainTouched().sort()).toEqual(['alpha-ltd', 'beta-ltd']);
  });

  it('deduplicates - three sources writing the same IPO is ONE page to refresh', () => {
    recordTouched('alpha-ltd');
    recordTouched('alpha-ltd');
    recordTouched('alpha-ltd');
    expect(drainTouched()).toEqual(['alpha-ltd']);
  });

  it('draining empties it, so the next cycle starts from nothing', () => {
    recordTouched('alpha-ltd');
    expect(drainTouched()).toEqual(['alpha-ltd']);
    expect(drainTouched()).toEqual([]);
  });

  it('an empty cycle drains to an empty list, never to null or undefined', () => {
    // The caller does `slugs.length` on this. A null here is a crash at cycle end.
    const drained = drainTouched();
    expect(Array.isArray(drained)).toBe(true);
    expect(drained).toEqual([]);
  });

  it('ignores empty and whitespace-only slugs rather than sending a blank to the endpoint', () => {
    recordTouched('');
    recordTouched('   ');
    recordTouched('real-ltd');
    expect(drainTouched()).toEqual(['real-ltd']);
  });

  describe('recordTouchedIfChanged - the predicate, which is the whole point', () => {
    it('records when a new IPO row was created', () => {
      recordTouchedIfChanged('new-ltd', { skipped: false, isNew: true });
      expect(drainTouched()).toEqual(['new-ltd']);
    });

    it('records when at least one field was actually updated', () => {
      recordTouchedIfChanged('changed-ltd', {
        skipped: false,
        isNew: false,
        consolidation: { fieldsUpdated: 1 },
      });
      expect(drainTouched()).toEqual(['changed-ltd']);
    });

    it('does NOT record a re-verify that rewrote nothing', () => {
      // The negative case this file exists for. fieldsProcessed can be 40 and
      // fieldsUpdated 0: the cycle looked at everything and changed nothing.
      recordTouchedIfChanged('unchanged-ltd', {
        skipped: false,
        isNew: false,
        consolidation: { fieldsProcessed: 40, fieldsUpdated: 0 },
      });
      expect(drainTouched()).toEqual([]);
    });

    it('does NOT record a skipped write - a lock miss changed no page', () => {
      recordTouchedIfChanged('locked-ltd', { skipped: true, isNew: false, skipReason: 'LOCKED' });
      expect(drainTouched()).toEqual([]);
    });

    it('does NOT record an error result, even though isNew is false and skipped is true', () => {
      recordTouchedIfChanged('failed-ltd', {
        skipped: true,
        isNew: false,
        skipReason: 'ERROR: connection reset',
      });
      expect(drainTouched()).toEqual([]);
    });

    it('does NOT record when consolidation is absent entirely', () => {
      // The CONSOLIDATION_DISABLED path returns no `consolidation` at all.
      // Treating "no information" as "changed" would refresh every page on a
      // flag-off cycle.
      recordTouchedIfChanged('noinfo-ltd', { skipped: false, isNew: false });
      expect(drainTouched()).toEqual([]);
    });

    it('a mutation check: flipping fieldsUpdated 0 -> 1 flips the outcome', () => {
      recordTouchedIfChanged('m-ltd', { skipped: false, isNew: false, consolidation: { fieldsUpdated: 0 } });
      expect(drainTouched()).toEqual([]);
      recordTouchedIfChanged('m-ltd', { skipped: false, isNew: false, consolidation: { fieldsUpdated: 1 } });
      expect(drainTouched()).toEqual(['m-ltd']);
    });
  });

  it('stops growing at the cap instead of holding a set forever', () => {
    // A run that is not `--source=all` never drains, because only the all-sources
    // cycle calls the revalidate step. In a long-lived dev watch process that set
    // would grow for the life of the process. The cap is not a correctness rule,
    // it is a bound on a leak with a named cause.
    for (let i = 0; i < TOUCHED_SLUG_CAP + 50; i++) recordTouched(`ipo-${i}`);
    expect(drainTouched().length).toBe(TOUCHED_SLUG_CAP);
  });
});
