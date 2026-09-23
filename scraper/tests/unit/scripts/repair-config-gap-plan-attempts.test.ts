// #884: the repair's selection is the whole safety story — it must reset ONLY
// rows at the cap whose recorded cause is a configuration gap, and hold every
// row that failed for a real reason (so a genuinely broken field cannot be
// handed five more attempts by a repair).
import { describe, expect, it } from 'vitest';
import {
  decideReset,
  causeKind,
  breakdown,
  parseArgs,
  type CappedPlanRow,
} from '../../../scripts/repair-config-gap-plan-attempts';

function row(overrides: Partial<CappedPlanRow>): CappedPlanRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    ipoId: 'ipo-1',
    ipoSlug: 'fixture-ltd',
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'isin',
    state: 'CHECK_FAILED',
    attempts: 5,
    reasonCode: 'COVERAGE_GAP',
    cause: 'rank2:CHITTORGARH:CHECK_FAILED:CHITTORGARH has no mapped field for ipos.isin yet (coverage gap, not a manifest no)',
    ...overrides,
  };
}

describe('repair-config-gap-plan-attempts decideReset (#884)', () => {
  it.each([
    ['CHITTORGARH no mapping', 'rank2:CHITTORGARH:CHECK_FAILED:CHITTORGARH has no mapped field for ipos.isin yet (coverage gap, not a manifest no)'],
    ['BSE no mapping', 'rank1:BSE:CHECK_FAILED:BSE has no mapped field for ipos.lotSize yet (coverage gap, not a manifest no)'],
    ['DOC no documentType', 'rank1:DOC:CHECK_FAILED:no documentType in manifest for this field'],
    ['no fetcher', 'rank1:NSE:NO_FETCHER_REGISTERED'],
    ['DOC column read', 'rank1:DOC:CHECK_FAILED:DOC column read not implemented for ipo_financials'],
    // review round 1 MAJOR-2: no provenance on a COMPLETED document is an extractor gap
    ['document provenance (extractor gap)', 'rank1:DOC:CHECK_FAILED:no document provenance for isin on RHP (extractor gap or field absent) — not retired'],
  ])('RESETS a capped row whose cause is a config gap (%s)', (_label, cause) => {
    expect(decideReset(row({ cause })).reset).toBe(true);
  });

  it.each([
    ['consolidator returned nothing', 'no field result returned'],
    ['network', 'rank1:NSE:THROWN:socket hang up'],
    ['null cause', null],
  ])('HOLDS a capped row whose cause is real (%s)', (_label, cause) => {
    expect(decideReset(row({ cause })).reset).toBe(false);
  });

  it('HOLDS a config-gap row that is still below the cap (already reclaimable)', () => {
    expect(decideReset(row({ attempts: 4 })).reset).toBe(false);
  });

  it('HOLDS a config-gap row in any other state', () => {
    expect(decideReset(row({ state: 'NOT_AVAILABLE_YET', attempts: 12 })).reset).toBe(false);
  });

  it('resets rows ABOVE the cap too (the NOT_AVAILABLE_YET->CHECK_FAILED path lands at 6..13)', () => {
    expect(decideReset(row({ attempts: 13 })).reset).toBe(true);
  });
});

describe('repair-config-gap-plan-attempts breakdown', () => {
  it('groups by action, reason code and cause kind with the field key stripped', () => {
    const decisions = [
      row({ ipoId: 'a' }),
      row({ ipoId: 'b', fieldName: 'symbol', cause: 'rank2:CHITTORGARH:CHECK_FAILED:CHITTORGARH has no mapped field for ipos.symbol yet (coverage gap, not a manifest no)' }),
      row({ ipoId: 'a', reasonCode: 'FAILED_VALIDATION', cause: 'no field result returned' }),
    ].map((r) => decideReset(r));
    const groups = breakdown(decisions);
    expect(groups[0]).toEqual({ reset: true, reasonCode: 'COVERAGE_GAP', kind: 'CHITTORGARH:CHECK_FAILED:CHITTORGARH has no mapped field', rows: 2, ipos: 2 });
    expect(groups[1]).toEqual({ reset: false, reasonCode: 'FAILED_VALIDATION', kind: 'no field result returned', rows: 1, ipos: 1 });
    expect(causeKind(null)).toBe('null');
  });

  it('parses --expect-db, --apply and --undo', () => {
    expect(parseArgs(['--expect-db', 'ipodhan_test'])).toEqual({ apply: false, allowProd: false, expectDb: 'ipodhan_test', undo: null });
    expect(parseArgs(['--expect-db', 'x', '--undo', 'l.json', '--apply']).undo).toBe('l.json');
  });
});
