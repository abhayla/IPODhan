/**
 * Item 18 slice 1b — the text must be STORED before anything deletes the PDF.
 *
 * Item 18 deletes stored PDFs on a schedule to reclaim disk. Measured on
 * staging: 255 documents holding ~1.05 GB, prospectuses averaging 8.3 MB and
 * draft prospectuses 11.3 MB. That is only safe if the text taken OUT of a PDF
 * outlives the file — and today nothing stores it. The extractor builds
 * `page_texts`, reports the page COUNT, and throws the text away.
 *
 * These tests pin the two rules the later purge depends on:
 *
 *   1. a page row exists for every page whose text we actually have, and
 *   2. "we extracted it" is NEVER the same claim as "the text is saved".
 *
 * Rule 2 is load-bearing. An extraction can succeed over a scanned document and
 * store nothing — exactly what NSE's ratios archives do (measured: their members
 * are newspaper photographs with zero extractable text). Keying the purge on
 * extracted-at would delete those PDFs and keep nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { pageRowsFromExtraction } from '../../../src/services/document-page-text.js';

const doc = '11111111-1111-1111-1111-111111111111';
const NUL = String.fromCharCode(0);

describe('pageRowsFromExtraction', () => {
  it('returns one row per page that has text', () => {
    const rows = pageRowsFromExtraction(doc, { page_texts: [[1, 'alpha'], [2, 'beta']] });
    expect(rows).toEqual([
      { documentId: doc, pageNumber: 1, text: 'alpha' },
      { documentId: doc, pageNumber: 2, text: 'beta' },
    ]);
  });

  it('keeps the extractor page numbers - a citation says "page 118", not "the 118th row"', () => {
    // Pages arrive sparse when only some carried text. Renumbering them 1..n
    // would silently move every stored citation.
    const rows = pageRowsFromExtraction(doc, { page_texts: [[17, 'a'], [94, 'b'], [383, 'c']] });
    expect(rows.map((r) => r.pageNumber)).toEqual([17, 94, 383]);
  });

  it('drops pages with NO text rather than storing empty rows', () => {
    // An empty row would satisfy "the text is saved" and satisfy nothing else.
    const rows = pageRowsFromExtraction(doc, {
      page_texts: [[1, 'alpha'], [2, ''], [3, '   '], [4, null]],
    });
    expect(rows.map((r) => r.pageNumber)).toEqual([1]);
  });

  it('returns EMPTY for a scanned document - the case that makes the purge rule matter', () => {
    expect(pageRowsFromExtraction(doc, { page_texts: [[1, ''], [2, '  ']] })).toEqual([]);
  });

  it('returns EMPTY when the extractor emitted no page_texts at all', () => {
    // An older extractor build, or a doc type carrying no text. Must be an empty
    // list, never a throw: the caller writes rows and marks COMPLETED.
    expect(pageRowsFromExtraction(doc, {})).toEqual([]);
    expect(pageRowsFromExtraction(doc, { page_texts: null as never })).toEqual([]);
  });

  it('strips NUL bytes - postgres text cannot hold them', () => {
    const rows = pageRowsFromExtraction(doc, { page_texts: [[1, 'a' + NUL + 'b']] });
    expect(rows[0].text).toBe('ab');
  });

  it('deduplicates a repeated page number, keeping the first', () => {
    // The unique constraint is (document_id, page_number); a duplicate would
    // abort the whole insert and lose every page for that document.
    const rows = pageRowsFromExtraction(doc, { page_texts: [[1, 'first'], [1, 'second']] });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('first');
  });

  it('ignores a page number that is not a positive integer', () => {
    const rows = pageRowsFromExtraction(doc, {
      page_texts: [[0, 'zero'], [-3, 'neg'], [1.5, 'frac'], ['x' as never, 'str'], [2, 'ok']],
    });
    expect(rows.map((r) => r.pageNumber)).toEqual([2]);
  });
});

describe('the rule the purge will depend on', () => {
  it('a successful extraction with no stored text is NOT "safe to purge"', () => {
    // Executable rather than a comment, so a later slice cannot key the purge on
    // extracted-at without this failing.
    const scanned = pageRowsFromExtraction(doc, { page_texts: [[1, ''], [2, '']] });
    const readable = pageRowsFromExtraction(doc, { page_texts: [[1, 'real text']] });
    expect(scanned.length === 0).toBe(true);
    expect(readable.length > 0).toBe(true);
  });
});
