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

  it('treats a refusal as a FAILED step, not a quiet success', () => {
    // If the job aborts (a zero-row report), the step must report success:false.
    // Reporting success would let a permanently broken call read as a clean
    // cycle forever - the same silent-zero class as the page size itself.
    expect(src).toContain('result.abortedReason');
    expect(src).toMatch(/abortedReason[\s\S]{0,120}success:\s*false/);
  });

  it('sits in the aggregator branch, next to the Chittorgarh scrape', () => {
    const scrape = src.indexOf("runCycleStep('aggregator:CHITTORGARH'");
    const fill = src.indexOf("runCycleStep('aggregator:CHITTORGARH_ISSUE_TYPE'");
    expect(scrape).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(scrape);
    expect(fill - scrape).toBeLessThan(1500);
  });
});
