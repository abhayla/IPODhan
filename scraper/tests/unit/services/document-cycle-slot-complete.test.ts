/**
 * Item 7 S2 (spec §2.1, OD-19, OD-33, OD-55; independent-review HIGH
 * finding): `summarize()` is the ONLY place `DocumentCycleSummary` is built,
 * so `slotComplete` is proven here directly against the pure function rather
 * than through the mocked wiring test — this is the class-level proof, the
 * wiring test (`index-document-state-machine-wiring.test.ts`) is the
 * caller-honors-the-flag proof.
 *
 * The bug this closes: the caller previously stamped the data-job slot
 * finished whenever `budgetExhausted` (PASS 1/discovery only) was false,
 * even when extraction, field-plan generation, the field-plan walk, or the
 * LISTED cap deferral stopped a LATER pass early. `slotComplete` must be
 * false for every one of those cases, independently of `budgetExhausted`.
 */
import { describe, it, expect } from 'vitest';
import { summarize, formatCycleReason, type DocumentCycleSummary } from '../../../src/services/document-cycle.js';

describe('summarize() — slotComplete (item 7 S2)', () => {
  it('is true when nothing stopped early and nothing was deferred', () => {
    const s = summarize([], 100, false);
    expect(s.slotComplete).toBe(true);
    expect(s.incompletePasses).toEqual([]);
  });

  it('is false when PASS 1 (discovery) exhausted its budget', () => {
    const s = summarize([], 100, true);
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['discovery']);
  });

  it('is false when extraction stopped early, even though discovery did not', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      extractionExhausted: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['extraction']);
  });

  it('is false when field-plan generation had no budget left', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      fieldPlanGenSkippedNoBudget: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['field_plan_generation_no_budget']);
  });

  it('is false when field-plan generation exhausted its budget mid-loop', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      fieldPlanGenExhausted: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['field_plan_generation_exhausted']);
  });

  it('is false when the field-plan walk (PASS 3) got no budget this cycle', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      fieldPlanWalkSkippedNoBudget: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['field_plan_walk_no_budget']);
  });

  it('is false when the field-plan walk exhausted its budget mid-loop', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      fieldPlanWalkExhausted: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['field_plan_walk_exhausted']);
  });

  it('is false when LISTED candidates were deferred past the per-cycle cap', () => {
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 2, deferred: 3 });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['listed_deferred']);
  });

  it('names every incomplete pass together, not just the first', () => {
    const s = summarize([], 100, true, { blocked: 0, failed: 0 }, { cap: 2, deferred: 1 }, { skipped: 0, reason: null }, {}, {
      extractionExhausted: true,
      fieldPlanWalkExhausted: true,
    });
    expect(s.slotComplete).toBe(false);
    expect(s.incompletePasses).toEqual(['discovery', 'extraction', 'field_plan_walk_exhausted', 'listed_deferred']);
  });

  it('formatCycleReason is unaffected by slotComplete (ledger line shape unchanged)', () => {
    const complete: DocumentCycleSummary = summarize([], 100, false);
    const incomplete: DocumentCycleSummary = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 0, deferred: 0 }, { skipped: 0, reason: null }, {}, {
      extractionExhausted: true,
    });
    // Same ipos/skipped/found/etc — formatCycleReason never reads slotComplete.
    expect(formatCycleReason(complete)).toBe(formatCycleReason(incomplete));
  });
});
