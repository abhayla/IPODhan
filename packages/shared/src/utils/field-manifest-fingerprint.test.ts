import { describe, it, expect } from 'vitest';
import { fieldManifestEntryFingerprint, fieldManifestFingerprint } from './field-manifest-fingerprint';

// #884 review round 2 NEW-1: the manifest part of the field-plan gap key is a
// CONTENT fingerprint of the field's own entry. The schema `version` (1|2) was
// not bumped by 4 of the last 6 content edits, so it could never reopen a row.
const entry = () => ({
  class: 'D',
  documentType: undefined as string | undefined,
  rank: { MAINBOARD: ['NSE', 'DOC'], SME_BSE: ['BSE'] },
  capability: { NSE: { capable: true, reason: 'x' }, DOC: { capable: true, reason: 'y' } },
  unit: 'keep',
});

describe('fieldManifestEntryFingerprint (#884 NEW-1)', () => {
  it('is stable for the same content, key order ignored', () => {
    const a = entry();
    const b = { unit: 'keep', capability: { DOC: a.capability.DOC, NSE: a.capability.NSE }, rank: { SME_BSE: ['BSE'], MAINBOARD: ['NSE', 'DOC'] }, class: 'D' };
    expect(fieldManifestEntryFingerprint(a)).toBe(fieldManifestEntryFingerprint(b));
  });
  it('changes when a documentType is ADDED (no version bump needed)', () => {
    const before = entry();
    const after = { ...entry(), documentType: 'RHP' };
    expect(fieldManifestEntryFingerprint(after)).not.toBe(fieldManifestEntryFingerprint(before));
  });
  it('changes when the rank ORDER changes', () => {
    const after = { ...entry(), rank: { MAINBOARD: ['DOC', 'NSE'], SME_BSE: ['BSE'] } };
    expect(fieldManifestEntryFingerprint(after)).not.toBe(fieldManifestEntryFingerprint(entry()));
  });
  it('changes when a capable flag flips', () => {
    const after = entry();
    after.capability.DOC = { capable: false, reason: 'y' };
    expect(fieldManifestEntryFingerprint(after)).not.toBe(fieldManifestEntryFingerprint(entry()));
  });
  it('does NOT change for prose-only edits (reason text, unit, class)', () => {
    const after = { ...entry(), unit: 'crore', class: 'T', capability: { NSE: { capable: true, reason: 'reworded' }, DOC: { capable: true, reason: 'y2' } } };
    expect(fieldManifestEntryFingerprint(after)).toBe(fieldManifestEntryFingerprint(entry()));
  });
  it('whole-manifest fingerprint moves with any one entry and is key-order independent', () => {
    const f1 = { 'ipos.a': entry(), 'ipos.b': entry() };
    const f2 = { 'ipos.b': entry(), 'ipos.a': entry() };
    expect(fieldManifestFingerprint(f1)).toBe(fieldManifestFingerprint(f2));
    expect(fieldManifestFingerprint({ ...f1, 'ipos.b': { ...entry(), documentType: 'DRHP' } })).not.toBe(fieldManifestFingerprint(f1));
  });
});
