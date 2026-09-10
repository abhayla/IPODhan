import { describe, it, expect } from 'vitest';
import { decideSegmentProvenance, type SegmentProvenanceRow } from '../../../scripts/repair-segment-provenance.js';

/**
 * Slice 3b (#lane-C-item-2): `ipos.segment` was written by a binary test
 * where "not detected as SME" was asserted as MAINBOARD. The write paths
 * were fixed in 2fd8a43b; the rows already written (a non-NULL segment
 * with NO field_sources row recording who said it) were not. This is the
 * pure per-row decision — no DB — that the repair tool applies to every
 * row it scans.
 */
function row(overrides: Partial<SegmentProvenanceRow>): SegmentProvenanceRow {
  return {
    id: 'ipo-1',
    companyName: 'Example Co',
    offeringType: 'IPO',
    segment: 'MAINBOARD',
    hasSegmentProvenance: false,
    ...overrides,
  };
}

describe('decideSegmentProvenance', () => {
  it('a non-IPO row with no provenance decides NULL-with-reason (never a guess)', () => {
    const d = decideSegmentProvenance(row({ offeringType: 'OFS' }));
    expect(d.action).toBe('clear-non-ipo');
    expect(d.newSegment).toBeNull();
    expect(d.touch).toBe(true);
    expect(d.reason.toLowerCase()).toContain('offering_type=ofs');
  });

  it('an IPO row with no source is REPORTED only — never written, never cleared to NULL', () => {
    const d = decideSegmentProvenance(row({ offeringType: 'IPO', segment: 'MAINBOARD' }));
    expect(d.action).toBe('report-unprovenanced-ipo');
    expect(d.touch).toBe(false);
    expect(d.newSegment).toBe('MAINBOARD');
    expect(d.reason.toLowerCase()).toContain('no source');
    expect(d.reason.toLowerCase()).toContain('reported');
  });

  it('an IPO row WITH a verified source decides that sourced value', () => {
    const d = decideSegmentProvenance(row({ offeringType: 'IPO', segment: 'MAINBOARD', sourcedSegment: 'SME' }));
    expect(d.action).toBe('apply-sourced');
    expect(d.newSegment).toBe('SME');
    expect(d.touch).toBe(true);
    expect(d.reason.toLowerCase()).toContain('sourced');
  });

  it('a row that already has segment provenance is NOT touched', () => {
    const d = decideSegmentProvenance(row({ offeringType: 'OFS', hasSegmentProvenance: true }));
    expect(d.action).toBe('skip-has-provenance');
    expect(d.touch).toBe(false);
    expect(d.newSegment).toBe('MAINBOARD');
  });

  it('a row whose segment is already NULL is NOT touched', () => {
    const d = decideSegmentProvenance(row({ segment: null }));
    expect(d.action).toBe('skip-already-null');
    expect(d.touch).toBe(false);
    expect(d.newSegment).toBeNull();
  });

  it('every non-IPO offering type in the observed class is cleared, not just OFS', () => {
    for (const offeringType of ['OFS', 'TENDER', 'NCD', 'RIGHTS', 'BUYBACK']) {
      const d = decideSegmentProvenance(row({ offeringType }));
      expect(d.action).toBe('clear-non-ipo');
      expect(d.newSegment).toBeNull();
    }
  });
});
