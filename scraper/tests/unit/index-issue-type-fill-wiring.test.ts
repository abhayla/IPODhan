import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Item 2 slice 7: wire-or-retire guard for the issue-type fill step.
 *
 * WHAT THIS PROVES: the production due-step cycle still CALLS the job, and
 * calls it as its own cycle step whose refusal is a failure.
 *
 * WHAT IT DOES NOT PROVE: that the job behaves. That is
 * chittorgarh-issue-type-job.test.ts, which drives the real function. This is
 * a SOURCE-LEVEL scan, the same shape as tests/unit/scripts/pool-utc-pin.test.ts
 * - deliberately cheap, because the alternative (mocking the whole index module
 * graph, as index-due-step-scheduler-wiring.test.ts does) costs more than the
 * one fact being guarded is worth.
 *
 * It exists because a fill service with no caller is the exact failure this
 * repo has already shipped once: the DRHP/RHP extractor was built, merged and
 * never wired, starving nine fields with zero callers and a flag left off.
 */
const src = readFileSync(
  fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
  'utf8'
);

describe('issue-type fill is wired into the due-step cycle', () => {
  it('imports the job', () => {
    expect(src).toContain("from './services/chittorgarh-issue-type-job.js'");
    expect(src).toContain('runIssueTypeFillJob');
  });

  it('runs it as its own labelled cycle step', () => {
    expect(src).toContain("runCycleStep('aggregator:CHITTORGARH_ISSUE_TYPE'");
  });

  it('the step verdict can FAIL for the claim it supports', () => {
    // The original version failed the step ONLY on abortedReason, so a cycle
    // where every write threw returned failed=231, filled=0, success:true. A
    // cycle that wrote nothing and one that wrote 180 rows had the SAME verdict,
    // which means the staging proof this step supports could not have failed.
    // Caught in Tier A review. All three conditions must be consulted.
    expect(src).toContain('result.abortedReason');
    expect(src).toContain('result.failed > 0');
    expect(src).toContain('result.matched === 0');
    expect(src).toMatch(/success:\s*false/);
  });

  it('the cadence key is not stamped when the fill failed', () => {
    // Stamping on the scrape alone suppressed the fill's retry for a full day -
    // the opposite of the discipline every other branch follows.
    expect(src).toContain('cgOk && fillOk');
  });

  it('passes the admin protection filter into the job', () => {
    // Every other ipo_details write door goes through filterProtectedFields.
    // This one did not, so an admin lock could not stop it.
    expect(src).toContain('filterProtectedFields');
  });

  it('sits in the aggregator branch, next to the Chittorgarh scrape', () => {
    const scrape = src.indexOf("runCycleStep('aggregator:CHITTORGARH'");
    const fill = src.indexOf("runCycleStep('aggregator:CHITTORGARH_ISSUE_TYPE'");
    expect(scrape).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(scrape);
    expect(fill - scrape).toBeLessThan(1500);
  });
});
