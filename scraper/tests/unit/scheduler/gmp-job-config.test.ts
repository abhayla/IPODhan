import { describe, it, expect } from 'vitest';
import { schedulerConfig, LOCK_TTL } from '../../../src/scheduler/config.js';

/**
 * A1 — the InvestorGain GMP writer MUST be registered as a scheduled job (the
 * root-cause fix for frozen coverage), every 6h, GATED OFF by default, with its
 * own lock TTL. Activation in prod is Abhay's call (§GATE).
 */
describe('GMP scheduled job config (A1)', () => {
  const job = schedulerConfig.jobs.gmpInvestorgain;

  it('exists and runs every 6 hours', () => {
    expect(job).toBeDefined();
    expect(job.schedule).toBe('0 */6 * * *');
  });

  it('is GATED OFF by default (ENABLE_GMP_SCHEDULED_JOB unset → disabled)', () => {
    expect(job.enabled).toBe(false);
  });

  it('has a dedicated positive lock TTL', () => {
    expect(typeof LOCK_TTL.gmpInvestorgain).toBe('number');
    expect(LOCK_TTL.gmpInvestorgain).toBeGreaterThan(0);
  });
});
