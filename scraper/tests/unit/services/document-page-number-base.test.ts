import { describe, it, expect } from 'vitest';

import { pageRowsFromExtraction } from '../../../src/services/document-page-text.js';

/**
 * Item 18 — a stored page_number must BE the printed page number.
 *
 * `document-page-text.ts` says what it is for, in its own comment: "a citation
 * says 'page 118', and renumbering sparse pages 1..n would silently move every
 * stored citation to a different page."
 *
 * The extractor does not send printed page numbers. `extract_filing.py:2688`
 * is `for i, p in enumerate(pdf.pages): page_texts.append((i, ...))` — a
 * ZERO-BASED index. So the guard that rejects `rawNumber <= 0` throws away the
 * cover of every document, and every surviving row is stored one BELOW the
 * page it came from. A citation to "page 118" points at printed page 119.
 *
 * Neither symptom raises an error. A document silently one page short looks
 * exactly like a document that had one blank page.
 *
 * WHY THE FIX IS HERE AND NOT IN THE EXTRACTOR. Making the extractor emit
 * 1-based numbers would be the other single boundary, and it would break the
 * peer-table reader shipped in #605: `find_peer_section_page` returns an index
 * into `page_texts` which is handed straight to `pdf.pages[index]`
 * (extract_filing.py:2725), and pdfplumber's list is zero-based. It would open
 * the wrong page for tables and still find a table there. So zero-based stays
 * the internal convention, and the conversion happens once, at this edge.
 */
describe('the stored page number is the printed page number', () => {
  it('stores the cover page instead of silently dropping it', () => {
    // The extractor's page 0 IS printed page 1 - the cover.
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [
        [0, 'RED HERRING PROSPECTUS'],
        [1, 'Table of contents'],
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pageNumber: 1, text: 'RED HERRING PROSPECTUS' });
  });

  it('a citation to a page lands on that printed page', () => {
    // The balance sheet read in item 8b sits at extractor index 73, which is
    // printed page 74 of the Karamtara RHP.
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [[73, 'SUMMARY OF RESTATED CONSOLIDATED STATEMENT OF ASSETS AND LIABILITIES']],
    });

    expect(rows[0].pageNumber).toBe(74);
  });

  it('keeps sparse numbering rather than renumbering 1..n', () => {
    // The original comment's real concern, preserved: pages arrive sparse
    // because empty ones are dropped, and compacting them would move every
    // citation.
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [
        [0, 'cover'],
        [117, 'page one-one-eight'],
        [400, 'annexure'],
      ],
    });

    expect(rows.map((r) => r.pageNumber)).toEqual([1, 118, 401]);
  });

  it('still refuses a negative index rather than storing page 0', () => {
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [
        [-1, 'impossible'],
        [0, 'cover'],
      ],
    });

    expect(rows.map((r) => r.pageNumber)).toEqual([1]);
  });

  it('a duplicate index is still taken once, after conversion', () => {
    // The unique constraint is (document_id, page_number). Converting must not
    // introduce a collision the old guard would have caught.
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [
        [5, 'first wins'],
        [5, 'second is dropped'],
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pageNumber: 6, text: 'first wins' });
  });

  it('an empty page is still not stored, at any index', () => {
    const rows = pageRowsFromExtraction('doc-1', {
      page_texts: [
        [0, '   '],
        [1, 'real text'],
      ],
    });

    expect(rows.map((r) => r.pageNumber)).toEqual([2]);
  });
});
