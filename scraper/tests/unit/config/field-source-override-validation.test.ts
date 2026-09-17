// implements: item 3 slice S4 -- override validation (capable source, S-05, distinct ranks, reason length)
import { describe, it, expect } from 'vitest';
import { validateOverrideCandidate, MIN_REASON_LENGTH } from '../../../src/config/field-source-override-validation.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

const manifest = loadFieldManifest();
const REASON = 'swap test path 2 (owner go 2026-09-17)'; // 20+ chars

describe('validateOverrideCandidate -- S4', () => {
  it('a valid candidate (capable sources, distinct ranks, long-enough reason) passes', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: ['CHITTORGARH', 'DOC'], reason: REASON },
      manifest
    );
    expect(result).toBeNull();
  });

  it('an unknown field is refused', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'no_such_field', ranks: ['DOC'], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('unknown-field');
  });

  it('a reason under the minimum length is refused', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: ['DOC'], reason: 'too short' },
      manifest
    );
    expect(result?.code).toBe('reason-too-short');
    expect('too short'.length).toBeLessThan(MIN_REASON_LENGTH);
  });

  it('empty ranks are refused', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: [], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('empty-ranks');
  });

  it('a duplicated rank source is refused', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: ['DOC', 'DOC'], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('duplicate-rank');
  });

  it('MUTATION TARGET 1 (skip validation): an incapable source (BSE for issue_size) is refused', () => {
    // manifest capability BSE.capable === false for ipos.issue_size (measured on the real manifest).
    expect(manifest.fields['ipos.issue_size'].capability.BSE.capable).toBe(false);
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: ['BSE', 'DOC'], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('incapable-source');
    if (result?.code === 'incapable-source') expect(result.source).toBe('BSE');
  });

  it('a source absent from the capability map entirely is refused (fail-closed, never proven capable)', () => {
    expect(manifest.fields['ipos.issue_size'].capability.INVESTORGAIN_GMP).toBeUndefined();
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'issue_size', ranks: ['INVESTORGAIN_GMP'], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('unproven-capable');
  });

  it('MUTATION TARGET 2 (S-05): an E-1/class-T field may not rank a document source', () => {
    const entry = manifest.fields['ipos.open_date'];
    expect(entry.class).toBe('T');
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'open_date', ranks: ['NSE', 'DOC'], reason: REASON },
      manifest
    );
    expect(result?.code).toBe('s05-document-on-timetable-field');
  });

  it('a class-T field with only exchange sources (no document) passes', () => {
    const result = validateOverrideCandidate(
      { table: 'ipos', column: 'open_date', ranks: ['BSE', 'NSE'], reason: REASON },
      manifest
    );
    expect(result).toBeNull();
  });
});
