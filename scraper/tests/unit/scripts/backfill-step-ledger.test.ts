import { describe, it, expect, vi } from 'vitest';

// The script also imports DB/Redis/repository modules that need a live
// shared-package build to resolve -- irrelevant to this pure-function test, so
// they are mocked out (same pattern as
// backfill-gmp-historical-date-parse.test.ts). vi.mock calls are hoisted above
// imports by vitest's transform regardless of source position.
vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IpoPipelineStepsRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: {},
  // parseSet reads the valid statuses off the pgEnum rather than a hand-copied
  // array, so the mock has to supply them.
  ipoStepStatusEnum: {
    enumValues: [
      'NOT_DUE',
      'DUE',
      'RUNNING',
      'DONE',
      'FAILED',
      'NOT_AVAILABLE_YET',
      'BLOCKED',
      'SKIPPED',
    ],
  },
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parseSet } from '../../../scripts/backfill-step-ledger.js';

/**
 * S-01 -- the backfill's --set parser is the only gate between a typo on the
 * command line and a half-applied ledger. It runs BEFORE any DB work, so an
 * unknown step id or status must abort the whole run rather than write the
 * pairs that happened to parse first.
 */
describe('backfill-step-ledger parseSet', () => {
  it('accepts a valid list of step=status pairs', () => {
    const pairs = parseSet('B1=DONE,B6=DONE,B7=FAILED');

    expect(pairs).toEqual([
      { stepId: 'B1', status: 'DONE' },
      { stepId: 'B6', status: 'DONE' },
      { stepId: 'B7', status: 'FAILED' },
    ]);
  });

  it('tolerates whitespace and a trailing comma', () => {
    expect(parseSet(' B1 = DONE , B2=DUE, ')).toEqual([
      { stepId: 'B1', status: 'DONE' },
      { stepId: 'B2', status: 'DUE' },
    ]);
  });

  it('rejects a step id that is not in the catalogue, before any write', () => {
    expect(() => parseSet('B1=DONE,Z9=DONE')).toThrow(/Z9/);
    expect(() => parseSet('B1=DONE,Z9=DONE')).toThrow(/catalogue/);
  });

  it('rejects an unknown status', () => {
    expect(() => parseSet('B1=FINISHED')).toThrow(/FINISHED/);
  });

  it('rejects a malformed pair with no status', () => {
    expect(() => parseSet('B1')).toThrow(/STEP=STATUS/);
  });

  it('throws on the whole input, so no earlier valid pair is returned', () => {
    // The parser returns an array or throws -- there is no partial result a
    // caller could act on, which is what keeps the ledger all-or-nothing.
    let result: unknown;
    try {
      result = parseSet('B1=DONE,B2=DONE,NOPE=DONE');
    } catch {
      result = 'threw';
    }
    expect(result).toBe('threw');
  });
});
