import { describe, it, expect } from 'vitest';
import {
  buildFieldPlanIpoGapKeys,
  fieldPlanGapKeyFor,
  fieldPlanClaimGapKeys,
} from '../../../src/services/field-plan-gap-keys';

// #884 review round 2: the gap key is PER FIELD (its own manifest entry's
// content, not the schema version) and, for NO_DOCUMENT_PROVENANCE, PER IPO
// (the COMPLETED documents in the field's document family).
const XV = 'extract_filing.py@2026-09-03';
const COV = '0123456789ab';
const manifest = () => ({
  'ipos.face_value': { rank: { MAINBOARD: ['DOC', 'NSE'] }, capability: { DOC: { capable: true } }, documentType: 'RHP' },
  'ipos.isin': { rank: { MAINBOARD: ['NSE', 'DOC'] }, capability: { DOC: { capable: true } } } as Record<string, unknown>,
});
const drhp = { id: 'd1', type: 'DRHP', extractionStatus: 'COMPLETED', isActive: true };
const keys = (m = manifest(), documents: any[] = [drhp]) =>
  buildFieldPlanIpoGapKeys({ manifestFields: m as never, coverageFingerprint: COV, extractorVersion: XV, documents });

describe('buildFieldPlanIpoGapKeys (#884 review round 2)', () => {
  it('NEW-1: adding a documentType to ONE field (no version bump) changes that field key only', () => {
    const before = keys();
    const m = manifest();
    m['ipos.isin'].documentType = 'RHP';
    const after = keys(m);
    expect(after.byField['ipos.isin'].plain).not.toBe(before.byField['ipos.isin'].plain);
    expect(after.byField['ipos.face_value']).toEqual(before.byField['ipos.face_value']);
  });

  it('NEW-2: a newly COMPLETED RHP changes withDocuments for an RHP-family field, never plain', () => {
    const before = keys();
    const after = keys(manifest(), [drhp, { id: 'r1', type: 'RHP', extractionStatus: 'COMPLETED', isActive: true }]);
    expect(after.byField['ipos.face_value'].withDocuments).not.toBe(before.byField['ipos.face_value'].withDocuments);
    expect(after.byField['ipos.face_value'].plain).toBe(before.byField['ipos.face_value'].plain);
  });

  it('NEW-2: a PENDING / inactive RHP or an out-of-family document changes nothing', () => {
    const before = keys();
    for (const d of [
      { id: 'r1', type: 'RHP', extractionStatus: 'PENDING', isActive: true },
      { id: 'r2', type: 'RHP', extractionStatus: 'COMPLETED', isActive: false },
      { id: 'p1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true },
    ]) {
      expect(keys(manifest(), [drhp, d]).byField['ipos.face_value']).toEqual(before.byField['ipos.face_value']);
    }
  });

  it('extractor version and fetcher coverage are still key parts', () => {
    const a = keys().byField['ipos.isin'].plain;
    const b = buildFieldPlanIpoGapKeys({ manifestFields: manifest() as never, coverageFingerprint: 'ba9876543210', extractorVersion: XV, documents: [] }).byField['ipos.isin'].plain;
    const c = buildFieldPlanIpoGapKeys({ manifestFields: manifest() as never, coverageFingerprint: COV, extractorVersion: 'extract_filing.py@2026-10-01', documents: [] }).byField['ipos.isin'].plain;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('record key: withDocuments only when a rank declared NO_DOCUMENT_PROVENANCE; unknown field -> null', () => {
    const k = keys();
    expect(fieldPlanGapKeyFor(k, 'ipos', 'face_value', ['NO_MAPPING'])).toBe(k.byField['ipos.face_value'].plain);
    expect(fieldPlanGapKeyFor(k, 'ipos', 'face_value', ['NO_MAPPING', 'NO_DOCUMENT_PROVENANCE'])).toBe(
      k.byField['ipos.face_value'].withDocuments
    );
    expect(fieldPlanGapKeyFor(k, 'ipos', 'not_in_manifest', ['NO_MAPPING'])).toBeNull();
  });

  it('claim map offers both current variants per field; keys never contain the stamp terminator', () => {
    const m = fieldPlanClaimGapKeys(keys());
    expect(m['ipos.face_value']).toHaveLength(2);
    for (const list of Object.values(m)) for (const key of list) expect(key).not.toContain(']');
  });

  // Round 3 (independent-review finding MAJOR-A/B): a config-gap key must
  // also reopen when the field's OWN field_sources provenance changes, or
  // when an admin field_source_overrides row for it becomes active/changes —
  // both are things that decide WHERE/HOW the field is asked, same standing
  // as the manifest entry, fetcher coverage and extractor version above.
  describe('round 3: provenance and override are key parts (MAJOR-A/B)', () => {
    it('MAJOR-A: a field with no provenance row vs one with a provenance row key differently', () => {
      const withNone = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
      });
      const withProvenance = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        provenanceByField: { 'ipos.face_value': { source: 'DRHP', documentId: 'd1' } },
      });
      expect(withProvenance.byField['ipos.face_value'].plain).not.toBe(withNone.byField['ipos.face_value'].plain);
      // A different field's key is untouched by another field's provenance.
      expect(withProvenance.byField['ipos.isin']).toEqual(withNone.byField['ipos.isin']);
    });

    it('MAJOR-A: a NEW provenance row (extractor finally wrote one) changes the key — the exact regression this closes', () => {
      // Before: NO_DOCUMENT_PROVENANCE gap parked with no provenance row yet.
      const before = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        provenanceByField: { 'ipos.face_value': null },
      });
      // After: the item-13 backfill (or a later real walk) writes the
      // provenance row — the SAME manifest, coverage and extractor version.
      const after = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        provenanceByField: { 'ipos.face_value': { source: 'DRHP', documentId: 'd1' } },
      });
      expect(after.byField['ipos.face_value'].plain).not.toBe(before.byField['ipos.face_value'].plain);
      expect(after.byField['ipos.face_value'].withDocuments).not.toBe(before.byField['ipos.face_value'].withDocuments);
    });

    it('MAJOR-B: an active admin override for the field changes the key; a different field is untouched', () => {
      const withNone = keys();
      const withOverride = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        overrideByField: { 'ipos.face_value': { id: 'override-1' } },
      });
      expect(withOverride.byField['ipos.face_value'].plain).not.toBe(withNone.byField['ipos.face_value'].plain);
      expect(withOverride.byField['ipos.isin']).toEqual(withNone.byField['ipos.isin']);
    });

    it('MAJOR-B: a DIFFERENT active override (superseded) reopens the row again — the id, not just presence, is the key part', () => {
      const overrideA = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        overrideByField: { 'ipos.face_value': { id: 'override-1' } },
      });
      const overrideB = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        overrideByField: { 'ipos.face_value': { id: 'override-2' } },
      });
      expect(overrideA.byField['ipos.face_value'].plain).not.toBe(overrideB.byField['ipos.face_value'].plain);
    });

    it('no provenance/override params (production default omission) is byte-identical to the pre-round-3 key shape for that input', () => {
      // Guards against a regression where adding the new params silently
      // changed the key for callers that pass neither — every field's key
      // when both maps are absent must equal the key when both are
      // explicitly null for every field.
      const omitted = keys();
      const explicitNull = buildFieldPlanIpoGapKeys({
        manifestFields: manifest() as never,
        coverageFingerprint: COV,
        extractorVersion: XV,
        documents: [drhp],
        provenanceByField: { 'ipos.face_value': null, 'ipos.isin': null },
        overrideByField: { 'ipos.face_value': null, 'ipos.isin': null },
      });
      expect(omitted).toEqual(explicitNull);
    });
  });
});
