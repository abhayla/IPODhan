/**
 * Turn the extractor's per-page text into `document_pages` rows.
 *
 * WHY (item 18). Item 18 deletes stored PDFs on a schedule to reclaim disk -
 * measured on staging, 255 documents holding about 1.05 GB, prospectuses
 * averaging 8.3 MB each. That is only safe if the text taken OUT of a PDF
 * outlives the file. Nothing stored it: the extractor built `page_texts`,
 * reported the page COUNT, and discarded the text.
 *
 * THE RULE THIS FILE EXISTS TO MAKE POSSIBLE: the purge keys on pages-STORED,
 * never on extracted-at. Those are different claims. An extraction can succeed
 * over a scanned document and store nothing - which is exactly what NSE's
 * ratios archives are (measured: newspaper photographs, zero extractable text).
 * Keying the purge on extracted-at would delete those PDFs and keep nothing.
 *
 * Pure and dependency-free on purpose, so the rules above are unit-testable
 * without a database.
 */

/** One `document_pages` row, before insert. */
export interface DocumentPageRow {
  documentId: string;
  pageNumber: number;
  text: string;
}

/** The slice of the extractor envelope this reads. */
export interface PageTextCarrier {
  page_texts?: Array<[number, string | null]> | null;
}

const NUL = String.fromCharCode(0);

export function pageRowsFromExtraction(
  documentId: string,
  extraction: PageTextCarrier
): DocumentPageRow[] {
  const pages = extraction?.page_texts;
  if (!Array.isArray(pages)) return [];

  const rows: DocumentPageRow[] = [];
  const seen = new Set<number>();

  for (const entry of pages) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [rawNumber, rawText] = entry;

    // The extractor sends a ZERO-BASED index, not a printed page number:
    // extract_filing.py:2688 is `for i, p in enumerate(pdf.pages)`. A stored
    // page_number is meant to be the page a reader would turn to, so the +1
    // happens HERE, once, and nowhere else.
    //
    // This edge is the right boundary and the extractor is not, because the
    // zero-based index is load-bearing on the python side: the peer-table
    // reader's `find_peer_section_page` hands its page_texts index straight to
    // `pdf.pages[index]` (extract_filing.py:2725), and pdfplumber's list is
    // zero-based. Making the extractor emit 1-based numbers would send that
    // reader to the wrong page - where it would still find a table, and say
    // nothing.
    //
    // Sparse numbering is still preserved rather than compacted to 1..n, which
    // was the original comment's real concern: empty pages are dropped below,
    // and renumbering the survivors would move every citation.
    if (typeof rawNumber !== 'number' || !Number.isInteger(rawNumber) || rawNumber < 0) continue;
    const pageNumber = rawNumber + 1;
    // The unique constraint is (document_id, page_number). One duplicate would
    // abort the whole insert and lose every page for this document, so the
    // first wins here rather than at the database.
    if (seen.has(pageNumber)) continue;

    // postgres `text` cannot hold a NUL byte; the extractor already strips them
    // from field values, and page text goes through the same rule.
    const text = typeof rawText === 'string' ? rawText.split(NUL).join('') : '';
    // A page with no text is NOT stored. An empty row would satisfy "the text
    // is saved" and satisfy nothing else - and that claim is what the purge
    // will act on.
    if (text.trim() === '') continue;

    seen.add(pageNumber);
    rows.push({ documentId, pageNumber, text });
  }

  return rows;
}
