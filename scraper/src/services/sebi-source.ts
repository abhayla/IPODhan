/**
 * SEBI rung — the THIRD source in the decision tree (T-403 G1, matrix §1).
 *
 * Consulted only when BOTH exchanges have failed for a document type, with one
 * exception: the DRHP. Neither exchange hosts a draft prospectus before the RHP
 * is filed, so at stage S0 SEBI is the ONLY exchange-equivalent source there is
 * (matrix §2, row S0).
 *
 * SHAPE, verified live 2026-08-28 (fixtures in tests/fixtures/documents/):
 *
 *   Listing endpoint (returns just the table fragment, no menu):
 *     .../HomeAction.do?doListing=yes&sid=3&ssid=15&smid=<N>
 *       smid=10  Draft Offer Documents   -> DRHP        (discovered by probing;
 *       smid=11  Red Herring Documents   -> RHP          each smid confirmed by
 *       smid=12  Final Prospectus        -> PROSPECTUS   reading its own rows)
 *
 *   Each row is `<td>date</td><td><a href="<DETAIL PAGE>.html" title="<Company> -
 *   <DocKind><br><a href='...Abridged Prospectus_p.pdf'>...</a>">`. Two traps in
 *   that one line:
 *     1. The row href is a DETAIL PAGE, not the PDF. The PDF lives on that page
 *        at `/sebi_data/attachdocs/<mon-yyyy>/<id>.pdf` and costs a second GET.
 *     2. The `title` attribute has a NESTED anchor for the Abridged Prospectus.
 *        Taking "the first href in the row" therefore yields the abridged
 *        document — a summary, not the filing — so the company name and the doc
 *        kind are parsed from the title's TEXT PREFIX, before that nested tag.
 *
 * Pure: every function here takes already-fetched HTML. Fetching is the runner's.
 */

import * as cheerio from 'cheerio';
import { compactCompanyNameKey } from '@ipodhan/shared/utils/company-name-normalizer';
import { levenshteinSimilarity } from '@ipodhan/shared/utils/company-name-similarity';
import { classifyByTitle } from './document-classifier.js';
import type { DocumentType } from './document-types.js';

export const SEBI_BASE = 'https://www.sebi.gov.in';

/** SEBI's public-issues listings, by the document kind each one carries. */
export const SEBI_LISTINGS = {
  DRHP: `${SEBI_BASE}/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=10`,
  RHP: `${SEBI_BASE}/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=11`,
  PROSPECTUS: `${SEBI_BASE}/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=12`,
} as const;

/** Document types SEBI can serve. Anything else must not consult it at all. */
export const SEBI_SERVED_TYPES: readonly DocumentType[] = ['DRHP', 'RHP', 'PROSPECTUS'];

/** The listing to consult for a wanted type, or null when SEBI cannot serve it. */
export function sebiListingUrlFor(docType: DocumentType): string | null {
  if (docType === 'DRHP') return SEBI_LISTINGS.DRHP;
  if (docType === 'RHP') return SEBI_LISTINGS.RHP;
  if (docType === 'PROSPECTUS') return SEBI_LISTINGS.PROSPECTUS;
  return null;
}

export interface SebiListingRow {
  /** Company name as SEBI prints it, before the " - <kind>" suffix. */
  companyName: string;
  /** The kind SEBI labelled it, classified through the shared classifier. */
  docType: DocumentType | null;
  /** Absolute URL of the row's DETAIL page (not the PDF). */
  detailUrl: string;
  /** Raw title text, kept for the attempt log. */
  title: string;
}

/** Absolute-ise a SEBI href. Already-absolute URLs pass through. */
function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${SEBI_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * Parse a SEBI public-issues listing into its rows.
 *
 * The company name and document kind come from the title's TEXT PREFIX — the
 * part before the nested Abridged-Prospectus anchor — because that anchor makes
 * naive "first link / whole title" parsing pick the summary document.
 */
export function parseSebiListing(html: string): SebiListingRow[] {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const table = $('table#sample_1');
  if (table.length === 0) return [];

  const rows: SebiListingRow[] = [];
  table.find('tr').each((_, tr) => {
    const anchor = $(tr).find('a[href]').first();
    if (anchor.length === 0) return;
    const href = anchor.attr('href');
    if (!href) return;

    // The title carries the same text as the cell but survives markup changes
    // inside the cell; fall back to the cell's own text when it is absent.
    const rawTitle = (anchor.attr('title') ?? anchor.text() ?? '').trim();
    if (rawTitle === '') return;

    // Cut at the nested anchor. `<br><a ...>` introduces the abridged document.
    const prefix = rawTitle.split(/<br\s*\/?>/i)[0].split('<a')[0].trim();
    if (prefix === '') return;

    // "<Company> - <Kind>". Split on the LAST ' - ' so a company whose own name
    // contains a hyphen-space (e.g. "T.C. Terrytex - Unit II") keeps it.
    const sep = prefix.lastIndexOf(' - ');
    const companyName = sep > 0 ? prefix.slice(0, sep).trim() : prefix;
    const kind = sep > 0 ? prefix.slice(sep + 3).trim() : '';

    rows.push({
      companyName,
      docType: classifyByTitle(kind),
      detailUrl: absolute(href.trim()),
      title: prefix,
    });
  });
  return rows;
}

/** Fuzzy threshold for matching our company name to SEBI's, per the contract. */
export const SEBI_NAME_MATCH_THRESHOLD = 0.85;

/**
 * Find the SEBI row for a company and a wanted document type.
 *
 * Exact normalized-key match first, then a fuzzy pass at >= 0.85. An ambiguous
 * best score returns null rather than guessing: the wrong row here downloads
 * another company's prospectus, which §3 step 6 would then have to catch.
 */
export function matchSebiRow(
  rows: SebiListingRow[],
  companyName: string,
  docType: DocumentType
): SebiListingRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const key = compactCompanyNameKey(String(companyName ?? ''));
  if (key === '') return null;

  const candidates = rows.filter((r) => r.docType === docType);
  if (candidates.length === 0) return null;

  const exact = candidates.filter((r) => compactCompanyNameKey(r.companyName) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  let best: SebiListingRow | null = null;
  let bestScore = 0;
  let tied = false;
  for (const row of candidates) {
    const score = levenshteinSimilarity(key, compactCompanyNameKey(row.companyName));
    if (score < SEBI_NAME_MATCH_THRESHOLD) continue;
    if (score > bestScore) {
      bestScore = score;
      best = row;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * Extract the filing PDF from a SEBI detail page.
 *
 * SEBI serves filings from `/sebi_data/attachdocs/<mon-yyyy>/<id>.pdf`; the
 * abridged copy lives under `/sebi_data/commondocs/`. Only `attachdocs` is
 * accepted, so the abridged summary can never be stored as the filing itself.
 */
export function parseSebiDetailPdfUrl(html: string): string | null {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);

  const hrefs: string[] = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (href) hrefs.push(href.trim());
  });

  const attach = hrefs.find((h) => /attachdocs\/.*\.pdf(\?|$)/i.test(h));
  if (attach) return absolute(attach);

  // Some detail pages embed the PDF outside an anchor (an iframe or a script).
  const embedded = html.match(/https?:\/\/[^"'\s]*attachdocs\/[^"'\s]*\.pdf/i);
  return embedded ? embedded[0] : null;
}
