/**
 * OD-97 (item 22, spec §2.2.1 OD-36 "Image-only pages go to OCR, marked"): where ONE
 * document read each value it produced, and the rule that an OCR-only value never
 * wins a disagreement against a text-page value.
 *
 * The extractor reports `ocr_pages` (the page indices whose text came from OCR) on
 * every current envelope, and each field's `page`. A column's mark is:
 *   - 'TEXT'  every extractor field behind the column was read off a text-layer page
 *             (or the document had no OCR'd page at all);
 *   - 'OCR'   every one was read off an OCR'd page (the value's only source is OCR);
 *   - 'MIXED' some of each, or a field with no page inside an OCR'd document.
 * An envelope without `ocr_pages` (written before the mark existed), or a column
 * with no mapped extractor field, has no mark (null): UNKNOWN. The rule fires
 * only between a known 'OCR' and a known 'TEXT' value; it never fires on MIXED or
 * unknown (OD-97 (b)).
 */

export type OcrSourceText = 'TEXT' | 'OCR' | 'MIXED';

export interface OcrMark {
  sourceText: OcrSourceText;
  /** Lowest OCR page confidence behind an 'OCR' value; null otherwise. */
  confidence: number | null;
}

interface MarkableField {
  value: unknown;
  page?: number | null;
  ocr_confidence?: number | null;
}

export interface MarkableExtraction {
  ocr_pages?: number[] | null;
  fields: Record<string, MarkableField>;
}

/**
 * The extractor fields each receipted column is computed from, as read in
 * filing-persister.ts. Only the scalar columns of `ipos` and `ipo_details` are
 * receipted (item 6), so only they are mapped; anything else is unknown.
 */
export const COLUMN_EXTRACTOR_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  ipos: {
    issueSize: ['total_offer_amount_at_cap', 'fresh_issue_amount', 'ofs_amount_at_cap', 'ofs_amount'],
    priceRangeMin: ['price_band_floor'],
    priceRangeMax: ['price_band_cap'],
    lotSize: ['lot_size'],
    faceValue: ['face_value'],
    openDate: ['open_date'],
    closeDate: ['close_date'],
    allotmentDate: ['basis_of_allotment_date'],
    listingDate: ['listing_date'],
    companyDescription: ['business_description'],
    cin: ['cin'],
  },
  ipo_details: {
    basisOfAllotmentDate: ['basis_of_allotment_date'],
    initiationOfRefundsDate: ['refund_date'],
    creditOfSharesDate: ['credit_date'],
    upiCutoffTime: ['upi_cutoff_time'],
    designatedExchange: ['designated_stock_exchange'],
    complianceOfficer: ['compliance_officer'],
    complianceOfficerPhone: ['compliance_officer_phone'],
    complianceOfficerEmail: ['compliance_officer_email'],
    companyDescription: ['business_description'],
    faceValue: ['face_value'],
    lotMultiple: ['lot_multiple'],
    preIpoPlacement: ['pre_ipo_placement'],
    allocationPct: ['qib_pct', 'nii_pct', 'retail_pct'],
    freshIssue: ['fresh_issue_amount'],
    ofsIssue: ['ofs_amount_at_cap', 'ofs_amount', 'ofs_shares', 'price_band_cap'],
    issueType: ['issue_price_type', 'book_building_regulation', 'price_band_floor', 'price_band_cap'],
    sebiRegulationCited: ['book_building_regulation'],
    bidWindows: ['bid_windows'],
    promoterSharesHeld: ['promoter_shares_held'],
  },
};

/** The mark of a value built from `names`, or null when it is unknown. */
export function fieldsMark(extraction: MarkableExtraction, names: readonly string[]): OcrMark | null {
  if (!Array.isArray(extraction.ocr_pages)) return null;
  const ocrPages = new Set(extraction.ocr_pages);
  let ocr = 0;
  let text = 0;
  let unplaced = 0;
  let lowest: number | null = null;
  for (const name of names) {
    const f = extraction.fields?.[name];
    if (!f || f.value === null || f.value === undefined) continue;
    const page = typeof f.page === 'number' ? f.page : null;
    if (page === null) {
      if (ocrPages.size === 0) text += 1;
      else unplaced += 1;
    } else if (ocrPages.has(page)) {
      ocr += 1;
      const c = typeof f.ocr_confidence === 'number' ? f.ocr_confidence : null;
      if (c !== null) lowest = lowest === null ? c : Math.min(lowest, c);
    } else {
      text += 1;
    }
  }
  if (ocr + text + unplaced === 0) return null;
  if (unplaced === 0 && ocr === 0) return { sourceText: 'TEXT', confidence: null };
  if (unplaced === 0 && text === 0) return { sourceText: 'OCR', confidence: lowest };
  return { sourceText: 'MIXED', confidence: null };
}

/** The mark of one receipted column, or null when it is unknown. */
export function columnMark(extraction: MarkableExtraction, tableName: string, column: string): OcrMark | null {
  const names = COLUMN_EXTRACTOR_FIELDS[tableName]?.[column];
  return names ? fieldsMark(extraction, names) : null;
}

/**
 * The document-wide mark for a value the column map does not cover: a document
 * with no OCR'd page read everything from its text layer; otherwise unknown.
 */
export function documentMark(extraction: MarkableExtraction): OcrMark | null {
  return Array.isArray(extraction.ocr_pages) && extraction.ocr_pages.length === 0
    ? { sourceText: 'TEXT', confidence: null }
    : null;
}

/**
 * OD-97 (c): in a disagreement between two offer-document values for the same
 * field, a known OCR-only incoming value loses to a stored value that a
 * text-page read supports. `storedNormalized` and `incomingNormalized` are
 * receipt-normalised; `textValues` are the normalised values this IPO's
 * documents read from a text layer for the field. Never fires on an identical
 * value (OD-73 no-op), on a missing stored value, or on an unknown/MIXED mark.
 */
export function ocrValueLoses(args: {
  incomingMark: OcrMark | null;
  incomingNormalized: string | null;
  storedNormalized: string | null;
  textValues: readonly string[];
}): boolean {
  if (args.incomingMark?.sourceText !== 'OCR') return false;
  if (args.storedNormalized === null || args.incomingNormalized === null) return false;
  if (args.storedNormalized === args.incomingNormalized) return false;
  return args.textValues.includes(args.storedNormalized);
}
