/**
 * OD-129 (#938): the offer document's listing sentence decides which exchanges
 * an IPO lists on and on which board.
 *
 * Every Indian offer document prints, on its cover pages, one sentence of the
 * form "The Equity Shares ... are proposed to be listed on <exchanges/board>".
 * A change of listing exchange forces a new filing, so the latest filing's
 * sentence is current by construction (§1.2.1 amendment, F-197).
 *
 * Measured on staging (F-197): main board "BSE Limited ... and National Stock
 * Exchange of India Limited", SME "SME Platform of BSE Limited (BSE SME)" or
 * "Emerge Platform of National Stock Exchange of India Limited (NSE EMERGE)",
 * and NSE's own IPO "a recognised stock exchange being BSE Limited". A price
 * band advertisement usually says only "on the Stock Exchanges" - that names no
 * exchange and returns null here (the ad counts only when it names them).
 *
 * Pure and dependency-free so the rule is unit-testable on real page text.
 */

export type DocumentListingExchange = 'NSE' | 'BSE';
export type DocumentListingBoard = 'MAINBOARD' | 'SME';

export interface ListingSentence {
  /** Sorted, de-duplicated exchanges the sentence names. Never empty. */
  exchanges: DocumentListingExchange[];
  /** SME when the sentence names an SME platform (BSE SME / NSE Emerge). */
  board: DocumentListingBoard;
  /** The clause read, whitespace-collapsed, for receipts and logs. */
  sentence: string;
  /** The page number the sentence was read from (as given by the caller). */
  page: number | null;
}

/** Cover pages only: the sentence sits on pages 1-6 of every document measured (F-197). */
export const LISTING_SENTENCE_MAX_PAGE_INDEX = 6;

const PHRASE = /proposed\s+to\s+be\s+listed\s+l?on\b/i;
/** Hard cap on the clause, so a sentence that never ends cannot read the next section. */
const MAX_CLAUSE_CHARS = 400;

/**
 * The clause ends at the first sentence stop (". " followed by a capital or an
 * opening quote/bracket), or at "in terms of" (SME cover pages continue the
 * sentence with the ICDR chapter), whichever comes first. "i.e.," does not
 * end it: its dots are not followed by whitespace. Nor does the dot of a
 * company-name abbreviation ("BSE Ltd. (“BSE”) and National Stock Exchange of
 * India Ltd."): splitting there would read [BSE] and SHRINK a correct set.
 */
const ABBREVIATION_BEFORE_DOT = /\b(?:Ltd|Pvt|Co|Corp|Inc|No|Nos)$/i;
const SENTENCE_STOP = /\.\s+(?=[A-Z“"(‘'])|\.\s*$|\bin\s+terms\s+of\b/g;

function clauseAfter(text: string, start: number): string {
  const tail = text.slice(start, start + MAX_CLAUSE_CHARS);
  let end = tail.length;
  SENTENCE_STOP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_STOP.exec(tail)) !== null) {
    if (m[0].startsWith('.') && ABBREVIATION_BEFORE_DOT.test(tail.slice(0, m.index))) continue;
    end = m.index;
    break;
  }
  return tail.slice(0, end).replace(/\s+/g, ' ').trim();
}

/**
 * Read the exchanges and the board from one clause. Returns null when the
 * clause names no exchange ("on the Stock Exchanges").
 */
export function readListingClause(clause: string): Omit<ListingSentence, 'sentence' | 'page'> | null {
  const bse = /\bBSE\b|Bombay\s+Stock\s+Exchange/i.test(clause);
  const nse = /\bNSE\b|National\s+Stock\s+Exchange/i.test(clause);
  if (!bse && !nse) return null;
  const sme = /\bSME\b|\bEmerge\b/i.test(clause);
  const exchanges: DocumentListingExchange[] = [];
  if (bse) exchanges.push('BSE');
  if (nse) exchanges.push('NSE');
  return { exchanges, board: sme ? 'SME' : 'MAINBOARD' };
}

/**
 * Find and read the listing sentence in a document's pages. `pages` is the
 * extractor's `page_texts` shape: [pageIndex, text]. Only the cover pages
 * (index <= LISTING_SENTENCE_MAX_PAGE_INDEX) are read; the first sentence that
 * names an exchange wins. Returns null when no page names one.
 */
export function parseListingSentence(
  pages: ReadonlyArray<readonly [number, string | null | undefined]> | null | undefined
): ListingSentence | null {
  if (!Array.isArray(pages)) return null;
  const ordered = [...pages]
    .filter(([n, t]) => Number.isInteger(n) && n >= 0 && n <= LISTING_SENTENCE_MAX_PAGE_INDEX && typeof t === 'string')
    .sort((a, b) => a[0] - b[0]);
  for (const [page, text] of ordered) {
    const body = text as string;
    const re = new RegExp(PHRASE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const clause = clauseAfter(body, m.index + m[0].length);
      const read = readListingClause(clause);
      if (read) return { ...read, sentence: clause, page };
    }
  }
  return null;
}

/** The scraper payload's singular `listingExchange` for a parsed sentence. */
export function toScrapedListingExchange(exchanges: readonly DocumentListingExchange[]): 'NSE' | 'BSE' | 'BOTH' {
  return exchanges.length > 1 ? 'BOTH' : exchanges[0];
}

/**
 * OD-129 / OD-30: Prospectus > RHP > DRHP; the later filing wins. A price band
 * advertisement is published with the RHP and ranks with it (inferred, not
 * spec-stated: OD-129 says only that the ad counts when it names the exchanges).
 * Equal rank = the later extraction wins (an addendum RHP after the RHP).
 */
export const OFFER_DOCUMENT_RANK: Readonly<Record<string, number>> = {
  PROSPECTUS: 3,
  RHP: 2,
  PRICE_BAND_AD: 2,
  DRHP: 1,
};

/** Document types that outrank `docType` for the listing sentence. Unknown type -> every ranked type. */
export function higherRankedOfferDocumentTypes(docType: string): string[] {
  const own = OFFER_DOCUMENT_RANK[docType] ?? 0;
  return Object.entries(OFFER_DOCUMENT_RANK)
    .filter(([, rank]) => rank > own)
    .map(([type]) => type);
}
