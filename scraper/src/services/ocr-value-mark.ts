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

import { decidePlanRowSupersession, normalizeReceiptValue, type RuleDocumentRef } from '../../config/plan-supersession-rule.mjs';

export type OcrSourceText = 'TEXT' | 'OCR' | 'MIXED';

export interface OcrMark {
  sourceText: OcrSourceText;
  /** Lowest OCR page confidence behind an 'OCR' value; null otherwise. */
  confidence: number | null;
}

interface MarkableField {
  value: unknown;
  page?: number | null;
  /** PR #1460: every agreeing place a value was read from (the cover reader); each page counts. */
  pages?: number[] | null;
  ocr_confidence?: number | null;
}

export interface MarkableExtraction {
  ocr_pages?: number[] | null;
  fields: Record<string, MarkableField>;
}

/**
 * The extractor fields each receipted column is computed from, as read in
 * filing-persister.ts. F-241 (OD-91): the record covers every table the persister
 * writes, so every receipted column of every table is mapped; a receipt's mark is
 * never null for a current envelope (round 2 of #1515). Child rows whose source
 * depends on the row (an intermediary's role, an acquisition range's period) pass
 * their own fields to `fieldsMark` instead (`INTERMEDIARY_ROLE_FIELDS`,
 * `ACQUISITION_PERIOD_FIELDS`).
 */
const STATEMENT_SERIES: readonly string[] = ['revenue_by_fy', 'total_income_by_fy', 'ebitda_by_fy', 'pat_by_fy', 'net_worth_by_fy', 'eps_basic_by_fy', 'eps_diluted_by_fy', 'op_cash_flow_by_fy', 'dscr_by_fy', 'rent_by_fy'];

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
    // Item 39 (OD-161 (b)): the walk reads this mark off the receipt; an OCR or MIXED cover read
    // never replaces a website's stored value, so the mark must be known, not null.
    leadManagers: ['lead_managers'],
    registrar: ['registrar_name'],
    companyWebsite: ['company_website'],
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
  // ---- F-241: child tables and side writers (filing-persister.ts sections 3-10).
  // A row's identity columns (fiscalYear, basis) come from the series that produced the row.
  financial_statements: {
    fiscalYear: STATEMENT_SERIES,
    basis: ['financial_basis', ...STATEMENT_SERIES],
    unit: ['unit'],
    revenue: ['revenue_by_fy'],
    totalIncome: ['total_income_by_fy'],
    ebitda: ['ebitda_by_fy'],
    pat: ['pat_by_fy'],
    netWorth: ['net_worth_by_fy'],
    epsBasic: ['eps_basic_by_fy'],
    epsDiluted: ['eps_diluted_by_fy'],
    opCashFlow: ['op_cash_flow_by_fy'],
    dscr: ['dscr_by_fy'],
    rentExpense: ['rent_by_fy'],
  },
  ipo_valuation: {
    priceFloor: ['price_band_floor'],
    priceCap: ['price_band_cap'],
    sharesAtFloor: ['shares_at_floor'],
    sharesAtCap: ['shares_at_cap'],
    freshSharesAtFloor: ['shares_at_floor'],
    freshSharesAtCap: ['shares_at_cap'],
    ofsShares: ['ofs_shares'],
    totalSharesAtFloor: ['total_offer_shares_at_floor'],
    totalSharesAtCap: ['total_offer_shares_at_cap'],
    mcapAtFloor: ['market_cap_at_floor'],
    mcapAtCap: ['market_cap_at_cap'],
    peAtFloor: ['pe_at_floor'],
    peAtCap: ['pe_at_cap'],
    ronwWeighted3y: ['weighted_average_ronw'],
    faceValueMultipleFloor: ['floor_multiple_of_face'],
    faceValueMultipleCap: ['cap_multiple_of_face'],
  },
  promoters: {
    name: ['promoter_names', 'promoter_name'],
    waca: ['promoter_selling_shareholders', 'promoter_waca'],
  },
  ipo_risk_factors: { heading: ['risk_factors'], body: ['risk_factors'], kpis: ['risk_factors'] },
  peer_companies: Object.fromEntries(
    ['companyName', 'isListed', 'peRatio', 'eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'].map((c) => [c, ['peer_companies']])
  ),
  brlm_track_record: {
    brlmName: ['brlm_track_record'],
    asOfDate: ['rhp_filing_date'],
    issues3y: ['brlm_track_record'],
    closedBelowIssuePrice: ['brlm_track_record'],
  },
  documents: { filingDate: ['rhp_filing_date'] },
  financial_data: {
    ...Object.fromEntries(
      [2022, 2023, 2024].flatMap((fy) => [
        [`revenueFy${fy}`, ['revenue_by_fy']],
        [`profitFy${fy}`, ['pat_by_fy']],
        [`ebitdaFy${fy}`, ['ebitda_by_fy']],
        [`totalIncomeFy${fy}`, ['total_income_by_fy']],
      ])
    ),
    netWorth: ['net_worth_by_fy'],
    eps: ['eps_basic_by_fy'],
    ronw: ['ronw_by_fy'],
    currentRatio: ['current_ratio'],
    quickRatio: ['quick_ratio'],
    inventoryTurnover: ['inventory_turnover'],
    peRatio: ['pe_at_cap'],
    marketCap: ['market_cap_at_cap'],
    promoterHoldingPreIssue: ['promoter_holding_pre_pct'],
    promoterHoldingPostIssue: ['promoter_holding_post_pct_at_cap'],
  },
};

/** ipo_intermediaries: every column of a row is read from the fields of that row's role. */
export const INTERMEDIARY_ROLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  BRLM: ['lead_managers', 'lead_manager_sebi_reg'],
  REGISTRAR: ['registrar_name', 'registrar_sebi_reg', 'registrar_contact_person', 'registrar_phone', 'registrar_email'],
  SYNDICATE: ['syndicate_members'],
  SUB_SYNDICATE: ['syndicate_members'],
  SPONSOR_BANK: ['issue_banks'],
  ESCROW_BANK: ['issue_banks'],
  PUBLIC_ISSUE_BANK: ['issue_banks'],
};

/** promoter_acquisition_ranges: every column of a period's row is read from that period's two fields. */
export const ACQUISITION_PERIOD_FIELDS: Readonly<Record<string, readonly string[]>> = {
  '1Y': ['waca_last_1y', 'cap_multiple_last_1y'],
  '18M': ['waca_last_18m', 'cap_multiple_last_18m'],
  '3Y': ['waca_last_3y', 'cap_multiple_last_3y'],
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
    const listed = Array.isArray(f.pages) ? f.pages.filter((p): p is number => typeof p === 'number') : [];
    const pages: Array<number | null> = listed.length > 0 ? listed : [typeof f.page === 'number' ? f.page : null];
    for (const page of pages) {
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

/** One text-layer receipt for a field, with the document that wrote it. */
export interface TextReceipt {
  value: string;
  document: RuleDocumentRef;
}

/**
 * OD-97: the text-layer values that may outvote an OCR-only value — only those read from a
 * document of the SAME OR BETTER rank for the field than the OCR value's own document. A text
 * read of an older or lower-ranked document (a DRHP when the RHP is the OCR source; an earlier
 * filing of the same type) never beats the better document (OD-30, §1 `DOC` "best available
 * type"). Rank is the ONE plan-row supersession rule (`decidePlanRowSupersession`, the same
 * comparator the DOC fetcher and the PULL-FROZEN audit use): a text document counts unless the
 * OCR document supersedes it. An unordered pair (same type, a missing filing_date) is not a
 * supersession, so the text read counts and the stored value is kept (the rule's own "keeping a
 * value beats guessing").
 */
export function textValuesAtOrAboveRank(
  receipts: readonly TextReceipt[],
  ocrDocument: RuleDocumentRef,
  opts: { family: readonly string[]; fixedPrice: boolean }
): string[] {
  const out: string[] = [];
  for (const r of receipts) {
    if (decidePlanRowSupersession(r.document, ocrDocument, opts).supersede) continue;
    const v = normalizeReceiptValue(r.value);
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}
