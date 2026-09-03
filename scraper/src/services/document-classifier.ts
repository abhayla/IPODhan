/**
 * Document-type classifier — the SINGLE place a filing title / BSE field / file
 * name is turned into a `DocumentType` (T-403 RC2).
 *
 * Root cause it fixes (lifecycle-plan E14, matrix §3 step 4 "the Skyways trap"):
 * the previous classifier lived inline in `primary-source-discovery.ts` and did
 *
 *     if (t.includes('red herring') || t.includes('prospectus')) return 'RHP';
 *
 * so a FINAL Prospectus — the highest-precedence filing there is — was stored as
 * an RHP, and BSE's `Price_Band_Advertisement` and `Corrigendum` fields both
 * collapsed into `ADDENDUM`. Both parsers (NSE titles and BSE fields) and the
 * discovery runner now share this module, so the fix cannot drift between them.
 *
 * Ordering inside `classifyByTitle` is load-bearing and documented per branch.
 * Pure: no network, no logging (`structured-logging.md` — no console.* in src/**).
 */

import type { DocumentType } from './document-types.js';

/** Strip a URL down to its (decoded) file name, lower-cased. '' when not a URL. */
export function fileNameFromUrl(url: string | null | undefined): string {
  if (typeof url !== 'string' || url.trim() === '') return '';
  const withoutQuery = url.split(/[?#]/)[0];
  const last = withoutQuery.split('/').pop() ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    /* a malformed %-escape is not worth failing a classification over */
  }
  return decoded.toLowerCase();
}

/**
 * Normalize a lower-cased title/file-name for word-boundary matching: BSE
 * glues words with `_`/`-` in real file names ("Red_Herring_Prospectus",
 * "Red-Herring-Prospectus") and appends the file extension with `.` — none of
 * that reads as a space to `.includes('red herring')`. Strip the extension,
 * fold every `_`/`-`/`.` run into a single space, and collapse whitespace so
 * every phrase check below sees word-separated text regardless of source.
 * (2026-09-02, IPO_NO 7922 Deepa Jewellers: `Prospectus_GID` held
 * "..._Red_Herring_Prospectus_and_GID_....zip" and was mistyped PROSPECTUS
 * because the underscores defeated the `red herring` phrase check.)
 */
function normalizeTitle(t: string): string {
  return t
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the text names a DRAFT red-herring prospectus. Checked before
 * anything else that mentions "prospectus" so a DRHP never lands as RHP.
 */
function isDraft(t: string): boolean {
  // No word boundary around 'drhp': real file names glue it to the company
  // ('DRHP_ACME.pdf', 'DRHPSkyways.pdf') and '_' is a word character, so `\b`
  // would NOT match there — the title would fall through to the /rhp/ test and
  // a DRAFT prospectus would be stored as the final RHP.
  return t.includes('draft') || /drhp/.test(t);
}

/**
 * True when the text names a RED HERRING prospectus (the pre-pricing filing).
 * `rhp` is matched as a token OR as the common no-space filename prefix BSE
 * uses ("RHPSkyways_20260818181315.pdf" — verified live 2026-08-28).
 */
function isRedHerring(t: string): boolean {
  return t.includes('red herring') || /rhp/.test(t);
}

/**
 * Classify a free-text document TITLE or FILE NAME into a `DocumentType`.
 * Returns null when the text names nothing we track (NSE's dataList carries
 * ~35 rows, only ~8 of which are documents).
 */
export function classifyByTitle(rawTitle: string | null | undefined): DocumentType | null {
  if (typeof rawTitle !== 'string') return null;
  const t = normalizeTitle(rawTitle.toLowerCase().trim());
  if (t === '') return null;

  // 1. Security-parameter rows contain the word "anchor", so they MUST be
  //    matched before the anchor rule or they become ANCHOR_ALLOCATION_REPORT.
  //    A BARE "Security Parameters" (no Pre/Post qualifier) is the pre-anchor
  //    file by NSE convention — verified live on MADHURKNIT, whose title is
  //    literally "Security Parameters " with a trailing space (matrix F11).
  if (t.includes('security parameter')) {
    return t.includes('post') ? 'SECURITY_PARAMS_POST_ANCHOR' : 'SECURITY_PARAMS_PRE_ANCHOR';
  }

  // 2. Price band advertisement — before the generic "prospectus"/"addendum"
  //    rules because BSE's PBA file name is "PriceBandAdvertisementSkyways_*.pdf".
  if (t.includes('price band') || t.includes('pricebandad')) return 'PRICE_BAND_AD';

  // 3. Basis of allotment advertisement — before the bare "basis" rule below,
  //    which belongs to "Basis of Issue Price" (a different document).
  if (t.includes('basis of allot') || t.includes('allotment advert')) {
    return 'BASIS_OF_ALLOTMENT_AD';
  }

  // 4. Corrigendum is its OWN type, not an addendum: it outranks the RHP for the
  //    fields it carries (lifecycle-plan S3). It must be checked before the
  //    red-herring rule because BSE names the file "CorrigendumofRHPSkyways_*.pdf"
  //    — the file name contains "RHP", so red-herring-first would mistype it.
  if (t.includes('corrigendum')) return 'CORRIGENDUM';
  if (t.includes('addendum')) return 'ADDENDUM';

  // 5. Draft beats red-herring beats final. "Draft Red Herring Prospectus"
  //    contains all three words, so the most specific test runs first.
  if (isDraft(t) && t.includes('prospectus')) return 'DRHP';
  if (isDraft(t) && isRedHerring(t)) return 'DRHP';
  if (isRedHerring(t)) return 'RHP';

  // 6. THE SKYWAYS TRAP (matrix §3 step 4): a final Prospectus's cover also says
  //    "Prospectus". Classify as PROSPECTUS only once "draft" and "red herring"
  //    (and the "rhp" filename form) have all been ruled out above.
  if (t.includes('prospectus')) return 'PROSPECTUS';

  if (t.includes('anchor')) return 'ANCHOR_ALLOCATION_REPORT';
  if (t.includes('ratios') || t.includes('basis of issue price')) return 'RATIOS_BASIS_ISSUE_PRICE';
  if (t.includes('bidding center') || t.includes('bidding centre')) return 'BIDDING_CENTERS';
  if (t.includes('application form')) return 'SAMPLE_APPLICATION_FORMS';

  return null;
}

/**
 * The BSE core-API (`GetMkt_ISSUE_BBS_IPO`) fields that carry document links,
 * with the type each field means BY DEFAULT. Verified live 2026-08-28 against
 * IPO_NO=7903 (Skyways): all four are populated, `Anchor_Details` is empty.
 */
export const BSE_DOCUMENT_FIELDS = {
  Prospectus_GID: 'RHP',
  Corrigendum: 'CORRIGENDUM',
  Addendum: 'ADDENDUM',
  Price_Band_Advertisement: 'PRICE_BAND_AD',
  Anchor_Details: 'ANCHOR_ALLOCATION_REPORT',
} as const satisfies Record<string, DocumentType>;

export type BseDocumentField = keyof typeof BSE_DOCUMENT_FIELDS;

/**
 * Classify a BSE core-API document field.
 *
 * `Prospectus_GID` is the one field whose meaning CHANGES over the IPO's life:
 * it serves the RHP before close and the FINAL Prospectus after (lifecycle-plan
 * S4). So for that field the FILE NAME decides, and the field default is only
 * the fallback when the name says nothing. Every other field has a fixed
 * meaning; a file name that positively identifies a different tracked type
 * (e.g. a "Corrigendum" PDF parked in the Addendum field) still wins, because
 * mistyping a corrigendum as an addendum loses its date precedence.
 */
export function classifyBseField(
  field: BseDocumentField | string,
  url: string | null | undefined
): DocumentType | null {
  const fallback = (BSE_DOCUMENT_FIELDS as Record<string, DocumentType | undefined>)[field];
  if (fallback === undefined) return null;
  const fromName = classifyByTitle(fileNameFromUrl(url));
  return fromName ?? fallback;
}

/**
 * True when `url` is NSE's own `RATIOS_<SYMBOL>.zip` archive-naming convention
 * (W-90, verified live 2026-09-02: `RATIOS_DEEPA.zip`).
 *
 * NSE issues this file name itself — it is not chosen by the company/RTA that
 * uploads the PDF inside — so it is a stronger, exchange-controlled signal of
 * document identity than an arbitrary member file name. NSE's combined
 * "Price Band Advertisement-cum-Basis of Issue Price" filing was verified live
 * to ship inside this archive under a member named
 * "<Company> - Price Band Advertisement.pdf": trusting that member name alone
 * (the W-29 "bytes win" rule) mistypes every such filing as PRICE_BAND_AD and
 * leaves `RATIOS_BASIS_ISSUE_PRICE` permanently unreachable. BSE has no
 * equivalent field (`BSE_DOCUMENT_FIELDS` carries no "Ratios" entry) — this
 * archive-naming override is NSE-only by construction.
 */
export function isNseRatiosArchiveUrl(url: string | null | undefined): boolean {
  return /^ratios[_-]/i.test(fileNameFromUrl(url));
}
