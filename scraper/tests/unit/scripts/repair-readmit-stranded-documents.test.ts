// F-158/OD-90 fix: rows stamped NOT_EXTRACTABLE before #989 widened
// AUTO_PERSIST_DOC_TYPES to include CORRIGENDUM are stranded — nothing
// re-admits them and the document cycle never revisits a closed IPO to
// re-check a status it already considers terminal. Class (defect-fix-contract.md
// item 2): every `documents` row whose extraction_status = NOT_EXTRACTABLE while
// its type is NOW on the extractable list. ADDENDUM stays non-extractable and
// must NOT be re-admitted.
import { describe, it, expect } from 'vitest';
import {
  selectStrandedDocuments,
  buildReadmitPatch,
  type StrandableDocumentRow,
} from '../../../scripts/repair-readmit-stranded-documents.js';

function row(overrides: Partial<StrandableDocumentRow> = {}): StrandableDocumentRow {
  return {
    id: 'doc-1',
    ipoId: 'ipo-1',
    slug: 'skyways-air-services-ltd',
    type: 'CORRIGENDUM',
    extractionStatus: 'NOT_EXTRACTABLE',
    ...overrides,
  };
}

describe('selectStrandedDocuments', () => {
  it('selects a NOT_EXTRACTABLE row of a type that is NOW extractable (the Skyways case)', () => {
    const selected = selectStrandedDocuments([row()]);
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('doc-1');
  });

  it('does NOT select ADDENDUM — still non-extractable, must never be re-admitted', () => {
    const selected = selectStrandedDocuments([row({ id: 'doc-2', type: 'ADDENDUM' })]);
    expect(selected).toHaveLength(0);
  });

  it('does NOT select a row that is already COMPLETED', () => {
    const selected = selectStrandedDocuments([row({ id: 'doc-3', extractionStatus: 'COMPLETED' })]);
    expect(selected).toHaveLength(0);
  });

  it('does NOT select a row that is already PENDING', () => {
    const selected = selectStrandedDocuments([row({ id: 'doc-4', extractionStatus: 'PENDING' })]);
    expect(selected).toHaveLength(0);
  });

  it('never hard-codes CORRIGENDUM — a type added to the extractable list later is selected too', () => {
    // RHP is already on AUTO_PERSIST_DOC_TYPES; proves the selector reads the
    // SSOT rather than a literal 'CORRIGENDUM' string.
    const selected = selectStrandedDocuments([row({ id: 'doc-5', type: 'RHP' })]);
    expect(selected).toHaveLength(1);
  });
});

describe('buildReadmitPatch', () => {
  it('sets the status the document cycle picks up next (PENDING), clears the attempt fields', () => {
    const now = new Date('2026-09-25T10:00:00.000Z');
    const patch = buildReadmitPatch(now);
    expect(patch.extractionStatus).toBe('PENDING');
    expect(patch.extractionError ?? null).toBeNull();
    expect(patch.retryCount).toBe(0);
    expect(patch.updatedAt).toEqual(now);
  });
});
