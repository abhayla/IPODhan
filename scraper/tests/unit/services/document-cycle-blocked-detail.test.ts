import { describe, it, expect } from 'vitest';
import {
  classifyBlockedReason,
  formatBlockedDocumentLines,
  formatBlockedByClassSuffix,
  type BlockedDocumentDetail,
} from '../../../src/services/document-cycle.js';

/**
 * #623: `extractionBlocked: N` was a bare count while the cause of every
 * blocked document already sat in `documents.extraction_error`. These tests
 * cover the classifier (real strings from the issue's table) and the two
 * formatters that turn a list of blocked documents into named cycle-summary
 * lines, red before this change existed (there was no `classifyBlockedReason`,
 * `formatBlockedDocumentLines`, or `formatBlockedByClassSuffix` export).
 */

describe('classifyBlockedReason — the six exact strings quoted in #623', () => {
  it('class 4: blocked_after_N_attempts — the RHP and Shanti Inorganics', () => {
    expect(classifyBlockedReason('blocked_after_10_attempts@extract_filing.py@2026-09-03')).toBe(
      'parked_after_attempts'
    );
  });

  it('class 1: only N investor rows could be read from the anchor report', () => {
    expect(classifyBlockedReason('only 0 investor rows could be read from the anchor report')).toBe(
      'zero_rows'
    );
    expect(classifyBlockedReason('only 1 investor row could be read from the anchor report')).toBe(
      'zero_rows'
    );
  });

  it('class 2: no text and OCR heuristic did not fire', () => {
    expect(classifyBlockedReason('no text and OCR heuristic did not fire')).toBe('no_text');
  });

  it('class 3: validation refusals — mismatch, unresolvable, mangled', () => {
    expect(
      classifyBlockedReason('6 of 15 investor names unresolvable')
    ).toBe('validation_refusal');
    expect(
      classifyBlockedReason('5 of 7 rows disagreed with the derived bid')
    ).toBe('validation_refusal');
    expect(classifyBlockedReason('a mangled row name')).toBe('validation_refusal');
    expect(
      classifyBlockedReason('TRUSTMF MULTI CAP FUND prints 15.94% but holds a different amount — mismatch')
    ).toBe('validation_refusal');
  });

  it('positive control: an unknown string is other, never misfiled into a named class', () => {
    expect(classifyBlockedReason('some completely novel failure nobody has seen before')).toBe('other');
  });

  it('null/undefined reason is other', () => {
    expect(classifyBlockedReason(null)).toBe('other');
    expect(classifyBlockedReason(undefined)).toBe('other');
  });
});

function detail(over: Partial<BlockedDocumentDetail>): BlockedDocumentDetail {
  return {
    documentId: 'doc-1',
    companyName: 'Example Ltd',
    docType: 'ANCHOR_ALLOCATION_REPORT',
    status: 'MANUAL_REVIEW',
    reason: 'only 0 investor rows could be read from the anchor report',
    reasonClass: 'zero_rows',
    ...over,
  };
}

describe('formatBlockedDocumentLines — one line per class, names not just counts', () => {
  it('prints one line per class with company(docType) names, across 4 documents in 3 classes', () => {
    const details: BlockedDocumentDetail[] = [
      detail({ companyName: 'Prasol Chemicals', docType: 'ANCHOR_ALLOCATION_REPORT', reasonClass: 'zero_rows' }),
      detail({ companyName: 'Kanohar Electricals', docType: 'ANCHOR_ALLOCATION_REPORT', reasonClass: 'zero_rows' }),
      detail({
        companyName: 'Deepa Jewellers',
        docType: 'ANCHOR_ALLOCATION_REPORT',
        reasonClass: 'validation_refusal',
        reason: '6 of 15 investor names unresolvable',
      }),
      detail({
        companyName: 'ESDS Software Solution Limited',
        docType: 'RHP',
        status: 'FAILED',
        reasonClass: 'parked_after_attempts',
        reason: 'blocked_after_10_attempts@extract_filing.py@2026-09-03',
      }),
    ];

    const lines = formatBlockedDocumentLines(details);

    expect(lines).toContain('extraction_blocked[zero_rows]=2: Prasol Chemicals(ANCHOR_ALLOCATION_REPORT) Kanohar Electricals(ANCHOR_ALLOCATION_REPORT)');
    expect(lines).toContain('extraction_blocked[validation_refusal]=1: Deepa Jewellers(ANCHOR_ALLOCATION_REPORT)');
    expect(lines).toContain(
      'extraction_blocked[parked_after_attempts] ESDS Software Solution Limited(RHP): blocked_after_10_attempts@extract_filing.py@2026-09-03'
    );
    // The class-count line for parked_after_attempts is present too.
    expect(lines.some((l) => l.startsWith('extraction_blocked[parked_after_attempts]=1:'))).toBe(true);
  });

  it('caps a class line at 20 names and appends "+N more"', () => {
    const details: BlockedDocumentDetail[] = Array.from({ length: 23 }, (_, i) =>
      detail({ companyName: `Company ${i}`, reasonClass: 'zero_rows' })
    );
    const lines = formatBlockedDocumentLines(details);
    const zeroRowsLine = lines.find((l) => l.startsWith('extraction_blocked[zero_rows]'));
    expect(zeroRowsLine).toContain('=23:');
    expect(zeroRowsLine).toContain('+3 more');
  });

  it('positive control: no blocked documents prints no class lines', () => {
    expect(formatBlockedDocumentLines([])).toEqual([]);
  });
});

describe('formatBlockedByClassSuffix — the scraper_logs.error_message suffix', () => {
  it('formats counts by class in parentheses', () => {
    const details: BlockedDocumentDetail[] = [
      detail({ reasonClass: 'zero_rows' }),
      detail({ reasonClass: 'zero_rows' }),
      detail({ reasonClass: 'validation_refusal' }),
    ];
    expect(formatBlockedByClassSuffix(details)).toBe(' (zero_rows=2 validation_refusal=1)');
  });

  it('positive control: empty list yields empty string, not "()"', () => {
    expect(formatBlockedByClassSuffix([])).toBe('');
  });
});
