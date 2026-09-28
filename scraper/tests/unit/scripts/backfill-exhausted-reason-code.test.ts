/**
 * A1 (OD-62/OD-77, #1108) — the selection/mapping rule for
 * `backfill-exhausted-reason-code.ts`.
 *
 * RCA (measured on `ipodhan_staging` 2026-09-28): the only uncoded no-value
 * plan rows are `EXHAUSTED` ones the pre-fix all-`NOT_PRINTED` fallthrough
 * wrote with `reason_code = NULL`. `decideBackfill` maps that class to
 * `NOT_SOURCED`; any other state the filter could in principle surface
 * (none expected, since NOT_AVAILABLE_YET/CHECK_FAILED already always
 * write a code) maps to `UNCLASSIFIED` rather than a guessed code.
 *
 * No database: `decideBackfill` is pure (defect-fix-contract.md item 3).
 */
import { describe, expect, it } from 'vitest';
import { NO_VALUE_STATES, decideBackfill, formatDecision, parseArgs, type UncodedPlanRow } from '../../../scripts/backfill-exhausted-reason-code';

function row(over: Partial<UncodedPlanRow> = {}): UncodedPlanRow {
  return {
    id: 'plan-1',
    ipoId: 'ipo-1',
    ipoSlug: 'some-ipo',
    ipoName: 'Some IPO Ltd',
    tableName: 'listing_performance',
    rowKey: '',
    fieldName: 'current_price_nse',
    state: 'EXHAUSTED',
    reasonCode: null,
    ...over,
  };
}

describe('decideBackfill', () => {
  it('maps an EXHAUSTED uncoded row to NOT_SOURCED, naming the pre-A1 fallthrough', () => {
    const d = decideBackfill(row());
    expect(d.reasonCode).toBe('NOT_SOURCED');
    expect(d.cause).toMatch(/NOT_PRINTED/);
    expect(d.cause).toMatch(/pre-A1 fallthrough/);
  });

  it('maps any other no-value state with no code to UNCLASSIFIED, never a guessed specific code', () => {
    const d = decideBackfill(row({ state: 'CHECK_FAILED' }));
    expect(d.reasonCode).toBe('UNCLASSIFIED');
    expect(d.cause).toMatch(/no code recorded/);
  });

  it('NOT_AVAILABLE_YET with no code (unexpected by the RCA, but the filter still defines the class) also gets UNCLASSIFIED', () => {
    const d = decideBackfill(row({ state: 'NOT_AVAILABLE_YET' }));
    expect(d.reasonCode).toBe('UNCLASSIFIED');
  });
});

describe('NO_VALUE_STATES', () => {
  it('is exactly the three terminal/settled no-value states', () => {
    expect([...NO_VALUE_STATES].sort()).toEqual(['CHECK_FAILED', 'EXHAUSTED', 'NOT_AVAILABLE_YET'].sort());
  });
});

describe('formatDecision', () => {
  it('names the IPO (by slug), the field, and the target code — never a bare count', () => {
    const line = formatDecision(decideBackfill(row()));
    expect(line).toContain('some-ipo');
    expect(line).toContain('listing_performance.current_price_nse');
    expect(line).toContain('NOT_SOURCED');
  });

  it('falls back to ipoName then ipoId when slug is missing', () => {
    const line = formatDecision(decideBackfill(row({ ipoSlug: null, ipoName: 'Fallback Name' })));
    expect(line).toContain('Fallback Name');
  });
});

describe('parseArgs', () => {
  it('parses --expect-db, --apply, --allow-prod', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging', '--apply', '--allow-prod']);
    expect(cli).toEqual({ apply: true, allowProd: true, expectDb: 'ipodhan_staging' });
  });

  it('defaults to dry run with no db expectation given', () => {
    const cli = parseArgs([]);
    expect(cli).toEqual({ apply: false, allowProd: false, expectDb: null });
  });

  it('does not swallow a following flag as the db name', () => {
    const cli = parseArgs(['--expect-db', '--apply']);
    expect(cli.expectDb).toBeNull();
  });
});
