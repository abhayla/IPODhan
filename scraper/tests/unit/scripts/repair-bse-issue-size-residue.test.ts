import { describe, it, expect } from 'vitest';
import {
  selectBseFloorViolations,
  segmentFloor,
  deriveSourcedTotal,
  decideBseIssueSizeRepair,
  parseBsePriceBand,
  type FloorViolationCandidateRow,
} from '../../../scripts/repair-bse-issue-size-residue.js';

describe('selectBseFloorViolations — the class predicate', () => {
  it('selects a BSE-provenance row below its segment floor', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'a', segment: 'MAINBOARD', issueSize: 14_797_000, issueSizeSource: 'BSE' },
    ];
    expect(selectBseFloorViolations(rows).map((r) => r.ipoId)).toEqual(['a']);
  });

  it('does NOT select a non-BSE row below floor (different class, different tool)', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'b', segment: 'MAINBOARD', issueSize: 14_797_000, issueSizeSource: 'CHITTORGARH' },
    ];
    expect(selectBseFloorViolations(rows)).toEqual([]);
  });

  it('does NOT select a BSE row that already clears its segment floor', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'c', segment: 'MAINBOARD', issueSize: 50_00_00_000, issueSizeSource: 'BSE' },
    ];
    expect(selectBseFloorViolations(rows)).toEqual([]);
  });

  it('selects a BSE row whose issue_size is NULL (same defect class — no usable value)', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'd', segment: 'SME', issueSize: null, issueSizeSource: 'BSE' },
    ];
    expect(selectBseFloorViolations(rows).map((r) => r.ipoId)).toEqual(['d']);
  });

  it('excludes a row with no segment (floor does not apply — RIGHTS/NCD/REIT/InvIT)', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'e', segment: null, issueSize: 1, issueSizeSource: 'BSE' },
    ];
    expect(selectBseFloorViolations(rows)).toEqual([]);
  });

  it('applies the correct floor per segment (SME floor is lower than MAINBOARD)', () => {
    const rows: FloorViolationCandidateRow[] = [
      { ipoId: 'f-sme-ok', segment: 'SME', issueSize: 1_50_00_000, issueSizeSource: 'BSE' }, // Rs1.5Cr clears SME floor
      { ipoId: 'g-sme-violation', segment: 'SME', issueSize: 70_07_320, issueSizeSource: 'BSE' }, // Rs70L below SME floor
    ];
    expect(selectBseFloorViolations(rows).map((r) => r.ipoId)).toEqual(['g-sme-violation']);
  });
});

describe('segmentFloor', () => {
  it('returns the MAINBOARD floor, the SME floor, or null for no segment', () => {
    expect(segmentFloor('MAINBOARD')).toBe(10_00_00_000);
    expect(segmentFloor('SME')).toBe(1_00_00_000);
    expect(segmentFloor(null)).toBeNull();
  });
});

describe('parseBsePriceBand', () => {
  it('parses a real range', () => {
    expect(parseBsePriceBand('120.00-127.00')).toEqual({ low: 120, high: 127 });
  });
  it('parses a fixed-price band expressed as 0.00-X.00 (Piyush/Nirbhay shape)', () => {
    expect(parseBsePriceBand('0.00-668.00')).toEqual({ low: 0, high: 668 });
  });
  it('returns null for missing/unparseable input', () => {
    expect(parseBsePriceBand(undefined)).toBeNull();
    expect(parseBsePriceBand('')).toBeNull();
    expect(parseBsePriceBand('n/a')).toBeNull();
  });
});

describe('deriveSourcedTotal — shares x price, BOTH read from the same BSE response', () => {
  it('reproduces the real Piyush figures exactly (regression on real numbers)', () => {
    // BSE GetMkt_ISSUE_BBS_IPO/w IPO_NO=7714: Issue_Size_No_of_shares=10490, Price_Band=0.00-668.00
    expect(deriveSourcedTotal({ shares: 10490, priceCapOrFixed: 668, ipoNo: '7714' })).toBe(7_007_320);
  });
  it('reproduces the real Nirbhay figures exactly (regression on real numbers)', () => {
    // BSE GetMkt_ISSUE_BBS_IPO/w IPO_NO=7621: Issue_Size_No_of_shares=1479700, Price_Band=0.00-10.00
    expect(deriveSourcedTotal({ shares: 1_479_700, priceCapOrFixed: 10, ipoNo: '7621' })).toBe(14_797_000);
  });
  it('throws on a non-finite or non-positive input rather than silently returning NaN/0', () => {
    expect(() => deriveSourcedTotal({ shares: Number.NaN, priceCapOrFixed: 10, ipoNo: 'x' })).toThrow();
    expect(() => deriveSourcedTotal({ shares: 100, priceCapOrFixed: 0, ipoNo: 'x' })).toThrow();
  });
});

describe('decideBseIssueSizeRepair — the decision logic', () => {
  it('reports UNSOURCED when no BSE detail record was found — never invents a value', () => {
    const decision = decideBseIssueSizeRepair({ current: 14_797_000, segment: 'MAINBOARD', sourced: null });
    expect(decision.status).toBe('UNSOURCED');
  });

  it('reports ALREADY_CORRECT when the stored value already equals the sourced shares x price total (the real Piyush/Nirbhay outcome)', () => {
    const decision = decideBseIssueSizeRepair({
      current: 7_007_320,
      segment: 'MAINBOARD',
      sourced: { shares: 10490, priceCapOrFixed: 668, ipoNo: '7714' },
    });
    expect(decision.status).toBe('ALREADY_CORRECT');
    if (decision.status === 'ALREADY_CORRECT') expect(decision.sourcedTotal).toBe(7_007_320);
  });

  it('reports WRITE when the sourced total differs from the stored value', () => {
    const decision = decideBseIssueSizeRepair({
      current: 1_047_9, // some stale/wrong stored figure
      segment: 'MAINBOARD',
      sourced: { shares: 10490, priceCapOrFixed: 668, ipoNo: '7714' },
    });
    expect(decision.status).toBe('WRITE');
    if (decision.status === 'WRITE') expect(decision.sourcedTotal).toBe(7_007_320);
  });

  it('reports WRITE when current is NULL and a source total exists', () => {
    const decision = decideBseIssueSizeRepair({
      current: null,
      segment: 'SME',
      sourced: { shares: 1_479_700, priceCapOrFixed: 10, ipoNo: '7621' },
    });
    expect(decision.status).toBe('WRITE');
  });
});
