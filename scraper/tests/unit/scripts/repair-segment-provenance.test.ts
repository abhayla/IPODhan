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

/**
 * Slice 3b2: the sourced value no longer comes from a hand-filled per-slug map. It
 * comes from the exchanges' own listed-security masters, via the oracle. These tests
 * cover the SEAM the wiring created — the decision function's contract when the value
 * is machine-sourced — not the oracle's matching, which has its own suite.
 */
describe('decideSegmentProvenance — oracle-sourced values (slice 3b2)', () => {
  it('names the oracle source in the reason, not the retired map', () => {
    // Before the wiring the reason string always said VERIFIED_IPO_SEGMENT_SOURCES.
    // Recording that for a value the NSE master supplied would misattribute it.
    const d = decideSegmentProvenance(
      row({ segment: 'MAINBOARD', sourcedSegment: 'MAINBOARD', sourcedVia: 'NSE/EQUITY_L/isin' }),
    );
    expect(d.action).toBe('apply-sourced');
    expect(d.touch).toBe(true);
    expect(d.reason).toContain('NSE/EQUITY_L/isin');
    expect(d.reason).not.toContain('VERIFIED_IPO_SEGMENT_SOURCES');
  });

  it('falls back to naming the map when no via is supplied — the override path still works', () => {
    const d = decideSegmentProvenance(row({ sourcedSegment: 'SME' }));
    expect(d.action).toBe('apply-sourced');
    expect(d.reason).toContain('VERIFIED_IPO_SEGMENT_SOURCES');
  });

  it('an oracle that resolved NOTHING leaves the row reported, never written', () => {
    // The BSE-only rows are exactly this case while 2-S3b3 is unbuilt: the oracle
    // returns no-source, sourcedSegment stays undefined, and the row must survive
    // untouched rather than being cleared to NULL.
    const d = decideSegmentProvenance(row({ segment: 'SME', sourcedSegment: undefined }));
    expect(d.action).toBe('report-unprovenanced-ipo');
    expect(d.touch).toBe(false);
    expect(d.newSegment).toBe('SME');
  });

  it('a sourced value that CONTRADICTS the stored label is applied, not silently kept', () => {
    // The repair exists to correct wrong labels. If the master says SME and the row
    // says MAINBOARD, the sourced value wins and the previous value is preserved by
    // the caller for the field_sources previousValue.
    const d = decideSegmentProvenance(
      row({ segment: 'MAINBOARD', sourcedSegment: 'SME', sourcedVia: 'NSE/SME_EQUITY_L/name' }),
    );
    expect(d.touch).toBe(true);
    expect(d.newSegment).toBe('SME');
  });

  it('provenance still wins over a fresh oracle read — an already-sourced row is not re-written', () => {
    const d = decideSegmentProvenance(
      row({ hasSegmentProvenance: true, sourcedSegment: 'SME', sourcedVia: 'NSE/SME_EQUITY_L/isin' }),
    );
    expect(d.action).toBe('skip-has-provenance');
    expect(d.touch).toBe(false);
  });
});
