// implements: docs/design/s3b2-verdict-writer-plan.md (S3b-2 — the comparator decides, verdict is written)
import { describe, it, expect, vi } from 'vitest';
import * as normalizationEngine from '../../../src/services/normalization-engine.js';
import { computeVerdict } from '../../../src/services/witness-verdict.js';

describe('computeVerdict', () => {
  it('two witnesses agreeing -> CONFIRMED', () => {
    const result = computeVerdict(
      [
        { rank: 1, source: 'DOC', value: '1000000', at: '2026-09-19T10:00:00.000Z' },
        { rank: 2, source: 'CHITTORGARH', value: '1000000', at: '2026-09-19T11:00:00.000Z' },
      ],
      2,
      'MONEY'
    );
    expect(result.verdict).toBe('CONFIRMED');
    expect(result.witnesses).toHaveLength(2);
    expect(result.witnesses[0]).toEqual({ source: 'DOC', value: '1000000', at: '2026-09-19T10:00:00.000Z' });
  });

  it('two witnesses disagreeing -> DISPUTED', () => {
    const result = computeVerdict(
      [
        { rank: 1, source: 'DOC', value: '1000000', at: '2026-09-19T10:00:00.000Z' },
        { rank: 2, source: 'CHITTORGARH', value: '2000000', at: '2026-09-19T11:00:00.000Z' },
      ],
      2,
      'MONEY'
    );
    expect(result.verdict).toBe('DISPUTED');
    expect(result.witnesses).toHaveLength(2);
  });

  it('one witness real + one abstaining -> UNCONFIRMED, NEVER DISPUTED (OD-60)', () => {
    // Only one answer was actually collected this pass (the second capable source
    // never answered / answered NOT_PRINTED, which pushes nothing into `answers`) —
    // this must NOT be treated as a disagreeing vote.
    const result = computeVerdict(
      [{ rank: 1, source: 'DOC', value: '1000000', at: '2026-09-19T10:00:00.000Z' }],
      2,
      'MONEY'
    );
    expect(result.verdict).toBe('UNCONFIRMED');
    expect(result.verdict).not.toBe('DISPUTED');
    expect(result.witnesses).toHaveLength(1);
  });

  it('a single-capable-source field on SME_NSE -> SINGLE_SOURCE using THAT SEGMENT\'s capable count', () => {
    // e.g. listing_performance.current_price_nse: rank.SME_NSE = ['NSE'] (capableSourceCount 1),
    // even though rank.MAINBOARD also = ['NSE'] with the SAME count — the point is the caller
    // passes the SEGMENT-resolved count (policy.ranks.length), never a hardcoded literal.
    const result = computeVerdict(
      [{ rank: 1, source: 'NSE', value: '105.50', at: '2026-09-19T10:00:00.000Z' }],
      1,
      'MONEY'
    );
    expect(result.verdict).toBe('SINGLE_SOURCE');
    expect(result.witnesses).toHaveLength(1);
  });

  it('a NO_WITNESS field on an SME segment (unreachable on MAINBOARD) -> NO_WITNESS with zero capable sources', () => {
    // e.g. listing_performance.current_price_bse on SME_NSE: rank.SME_NSE = [] (capableSourceCount 0).
    // No answers were ever collected because nothing was ever asked.
    const result = computeVerdict([], 0, 'MONEY');
    expect(result.verdict).toBe('NO_WITNESS');
    expect(result.witnesses).toHaveLength(0);
  });

  it('ABSTAIN fields never reach the comparator: areEquivalent is not called when the caller filters them out', () => {
    // This test proves the CALLER contract, not computeVerdict itself — computeVerdict has no
    // 'ABSTAIN' branch and its `family` parameter is typed ComparisonFamily (ABSTAIN excluded),
    // so passing one through is a compile-time error at the call site, not a runtime path here.
    // What we CAN prove at this layer: areEquivalent is only invoked when 2+ real answers exist,
    // and never for a single-answer (UNCONFIRMED) or zero-answer (NO_WITNESS) result — the same
    // guard that keeps an ABSTAIN-filtered field (which the walk never calls this for at all)
    // from ever reaching the comparator.
    const spy = vi.spyOn(normalizationEngine, 'areEquivalent');
    computeVerdict([{ rank: 1, source: 'DOC', value: 'free text prose', at: '2026-09-19T10:00:00.000Z' }], 1, 'SET');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('flag semantics: computeVerdict is pure — same inputs always produce the same verdict + witnesses (no hidden state)', () => {
    const answers = [
      { rank: 1, source: 'DOC', value: '500', at: '2026-09-19T10:00:00.000Z' },
      { rank: 2, source: 'CHITTORGARH', value: '500', at: '2026-09-19T11:00:00.000Z' },
    ];
    const r1 = computeVerdict(answers, 2, 'MONEY');
    const r2 = computeVerdict(answers, 2, 'MONEY');
    expect(r1).toEqual(r2);
  });
});
