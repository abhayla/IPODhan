import { describe, it, expect } from 'vitest';
import { computeGMPRunOutcome } from '../../../src/scrapers/investorgain-gmp-orchestrator-v2.js';

/**
 * Unit tests for GMP run success accounting (G6/A5).
 *
 * Contract §2.6 states `gmpsProcessed = created+skipped+blocked` AND that an
 * all-skipped run must report `success=false`. Those only reconcile when success
 * keys off rows actually CREATED (not merely "processed"), so:
 *   processed = created + skipped + blocked   (reporting metric)
 *   success   = failed === 0 && created > 0   (a run that landed >=1 GMP, no failures)
 */

describe('computeGMPRunOutcome', () => {
  it('an all-created run with no failures is a success', () => {
    const o = computeGMPRunOutcome({ created: 10, skipped: 0, blocked: 0, failed: 0 });
    expect(o.processed).toBe(10);
    expect(o.success).toBe(true);
  });

  it('an all-skipped run is NOT a success (no GMP landed)', () => {
    const o = computeGMPRunOutcome({ created: 0, skipped: 8, blocked: 0, failed: 0 });
    expect(o.processed).toBe(8); // skipped still counts as processed/handled
    expect(o.success).toBe(false);
  });

  it('any failure makes the run unsuccessful even if some were created', () => {
    const o = computeGMPRunOutcome({ created: 5, skipped: 1, blocked: 1, failed: 2 });
    expect(o.processed).toBe(7);
    expect(o.success).toBe(false);
  });

  it('a fully empty run is not a success', () => {
    const o = computeGMPRunOutcome({ created: 0, skipped: 0, blocked: 0, failed: 0 });
    expect(o.processed).toBe(0);
    expect(o.success).toBe(false);
  });
});
