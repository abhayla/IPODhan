/**
 * Lane B, NOT_APPLICABLE reporting slice (2026-09-16). `isExtractableDocType`
 * is the single predicate `selectPendingFilings` and the audit's
 * not-applicable reporter both read, so a document type outside
 * `AUTO_PERSIST_DOC_TYPES` is reported as "not applicable" rather than
 * "stuck" everywhere, not just at the one call site that happened to check
 * `AUTO_PERSIST_DOC_TYPES` directly.
 */
import { describe, it, expect } from 'vitest';
import {
  isExtractableDocType,
  NOT_APPLICABLE_EXTRACTION_REASON,
} from '../../../src/services/filing-auto-persist.js';

describe('isExtractableDocType', () => {
  it('is true for the filing-extractor types and the anchor report', () => {
    expect(isExtractableDocType('RHP')).toBe(true);
    expect(isExtractableDocType('ANCHOR_ALLOCATION_REPORT')).toBe(true);
  });

  it('is false for a type with no extractor', () => {
    // Item 9 (OD-90) added CORRIGENDUM to AUTO_PERSIST_DOC_TYPES (its own reader,
    // corrigendum-reader.ts) — it is no longer an example of "no extractor". ADDENDUM
    // is not in AUTO_PERSIST_DOC_TYPES and has no extractor.
    expect(isExtractableDocType('RATIOS_BASIS_ISSUE_PRICE')).toBe(false);
    expect(isExtractableDocType('ADDENDUM')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isExtractableDocType('rhp')).toBe(true);
    expect(isExtractableDocType('ratios_basis_issue_price')).toBe(false);
  });

  it('exposes a stable skip-reason constant for NOT_APPLICABLE reporting', () => {
    expect(NOT_APPLICABLE_EXTRACTION_REASON).toBe('no_extractor_for_doc_type');
  });
});
