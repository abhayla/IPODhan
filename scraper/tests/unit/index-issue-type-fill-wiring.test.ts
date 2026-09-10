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

  it('the fill has its OWN cadence key, so a failed fill cannot un-stamp the scrape', () => {
    // My first fix gated the SHARED aggregator key on `cgOk && fillOk`. One
    // failed row out of 231 then left the branch un-stamped and re-ran the
    // Chittorgarh SCRAPE and the report fetch on every 30-minute wake - ~48x a
    // day against a third-party source, and dated: on 1 Jan 2027 the new
    // financial year's report drops below the row floor and it runs for weeks.
    // Round 2 caught it. Separate keys, each stamped on its own result.
    expect(src).toContain('ISSUE_TYPE_FILL_CADENCE_KEY');
    // Assert on the STATEMENT, not the string: the comment above the new
    // cadence key quotes the old expression to explain why it went.
    expect(src).not.toMatch(/if \(cgOk && fillOk\)/);
    expect(src).toMatch(/if \(fillDue && fillOk\)/);
    expect(src).toMatch(/if \(cgOk\) \{/);
  });

  it('the verdict also fails when rows matched but NOTHING was written', () => {
    // All-dateMismatch or all-blockedByAdmin would otherwise report clean while
    // zero rows were touched - the proof could not fail for the write claim.
    expect(src).toContain('result.filled === 0');
    expect(src).toContain('result.alreadySet === 0');
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
