/**
 * A1 fix round 2 (OD-62/OD-77, #1108) — the selection/mapping rules for
 * `repair-null-reason-codes.ts` (renamed from `backfill-exhausted-reason-code.ts`).
 *
 * RCA CORRECTED (measured on `ipodhan_staging` 2026-09-28): the 36 EXHAUSTED
 * uncoded rows all have rank1/2/3_source NULL — phantom plan rows for a field
 * the manifest ranks no source for on that IPO's type (#865, "the honest
 * repair is deletion"), never a real "every ranked source answered
 * NOT_PRINTED" fact. `isRanklessRow` is class (a) — deleted, never coded.
 * `decideBackfill` is class (b) — an EXHAUSTED row that survives the
 * rank-less filter (i.e. has at least one real ranked source) maps to
 * NOT_SOURCED; any other no-value state with no code maps to UNCLASSIFIED.
 *
 * No database: both predicates are pure (defect-fix-contract.md item 3).
 */
import { describe, expect, it } from 'vitest';
import {
  NO_VALUE_STATES,
  decideBackfill,
  formatDecision,
  formatRanklessLine,
  isRanklessRow,
  parseArgs,
  type PlanRankRow,
  type UncodedPlanRow,
} from '../../../scripts/repair-null-reason-codes';

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

function rankRow(over: Partial<PlanRankRow> = {}): PlanRankRow {
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
    rank1Source: null,
    rank2Source: null,
    rank3Source: null,
    ...over,
  };
}

describe('isRanklessRow (class (a) — the RCA-corrected class)', () => {
  it('is rank-less when all three ranks are NULL (the measured 36-row class)', () => {
    expect(isRanklessRow(rankRow())).toBe(true);
  });

  it('is rank-less when all three ranks are the NONE sentinel', () => {
    expect(isRanklessRow(rankRow({ rank1Source: 'NONE', rank2Source: 'NONE', rank3Source: 'NONE' }))).toBe(true);
  });

  it('is rank-less on a mix of NULL and NONE', () => {
    expect(isRanklessRow(rankRow({ rank1Source: null, rank2Source: 'NONE', rank3Source: null }))).toBe(true);
  });

  it('is NOT rank-less when at least one rank has a real source — this is the row decideBackfill must still classify', () => {
    expect(isRanklessRow(rankRow({ rank1Source: 'NSE' }))).toBe(false);
    expect(isRanklessRow(rankRow({ rank2Source: 'BSE' }))).toBe(false);
    expect(isRanklessRow(rankRow({ rank3Source: 'CHITTORGARH' }))).toBe(false);
  });
});

describe('formatRanklessLine', () => {
  it('names the IPO, the field, the state, and DELETE — never a bare count', () => {
    const line = formatRanklessLine(rankRow());
    expect(line).toContain('some-ipo');
    expect(line).toContain('listing_performance.current_price_nse');
    expect(line).toContain('EXHAUSTED');
    expect(line).toContain('DELETE');
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
