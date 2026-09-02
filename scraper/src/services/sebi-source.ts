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
import {
  compactCompanyNameKey,
  normalizeCompanyNameForMatching,
} from '@ipodhan/shared/utils/company-name-normalizer';
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

/**
 * W-27 — the SEBI listing endpoint (`SEBI_LISTINGS`) is a single GET returning
 * only the newest 25 rows. The DRHP list alone carries 2,193 records across 88
 * pages (verified live 2026-09-02 against Deepa Jewellers, whose DRHP was on a
 * later page and therefore invisible to `matchSebiRow` on page 1 — recorded
 * `SEBI:not_listed` for a filing that existed). This section adds a search +
 * paging path so a company beyond page 1 can still be found.
 *
 * The listing's own JS (`searchFormNewsList`, in an external file this
 * fixture set does not carry) is opaque, so the POST recipe below was derived
 * by direct experiment against the live site (2026-09-02):
 *
 *   - The search/paging FORM is `<form name="homeForm" method="post"
 *     action="/sebiweb/home/HomeAction.do;jsessionid=<SID>" ...>` on the same
 *     page returned by the plain listing GET. The `;jsessionid=<SID>` path
 *     segment is what ties the POST to the session that rendered page 1 — no
 *     `Cookie` header is required, confirmed live with a cookie-less POST.
 *   - The POST target needs `?doListing=yes` appended to that action URL, or
 *     the server 302-redirects to the SEBI homepage (empty response). This is
 *     NOT visible anywhere in the form markup; it was found by trial.
 *   - `Referer` (the listing URL) and `Origin` (`SEBI_BASE`) headers are
 *     required or the WAF returns HTTP 530 "Unauthorized Request Blocked".
 *   - The visible `org.apache.struts.taglib.html.TOKEN` hidden field is
 *     rendered literally as `"..."` by the server (not a real token — some
 *     client-side script fills it in a real browser) and is NOT required for
 *     the POST to succeed; it is carried through unchanged if present so a
 *     future server-side check has something to see, but never relied on.
 *   - Search: set the form's own hidden `search` field to a short company-name
 *     key and `nextValue=-1` (matches the page's own `GO` link,
 *     `searchFormNewsList('s','-1')`).
 *   - Paging: leave `search` empty and set `nextValue=<0-based page index>`
 *     (matches `searchFormNewsList('n','<n>')` on the numbered page links).
 *
 * Live proof: `scraper/scripts/_walk-c3-proof.ts` (run once, then deleted per
 * the walk contract) resolved Deepa Jewellers Limited's DRHP via this path.
 */

/** Minimal HTTP contract this module needs — decoupled from the runner's
 * Buffer-based `HttpFetcher` so this file stays fetch-shape-agnostic. */
export type SebiFetcher = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
) => Promise<{ status: number; body: string }>;

export interface SebiSearchForm {
  /** Absolute POST target, jsessionid path segment preserved, `?doListing=yes` appended. */
  actionUrl: string;
  /** Every hidden input + selected `<option>` inside the form, name -> value. */
  fields: Record<string, string>;
}

/**
 * Read the search/paging form (`name="homeForm"`) out of a rendered listing
 * page: its POST action (jsessionid preserved) and every hidden/select field
 * a real submit would carry.
 */
export function extractSebiSearchForm(html: string): SebiSearchForm | null {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const form = $('form[name="homeForm"]');
  if (form.length === 0) return null;

  const rawAction = form.attr('action');
  if (!rawAction) return null;
  const actionUrl = `${absolute(rawAction.split('?')[0])}?doListing=yes`;

  const fields: Record<string, string> = {};
  form.find('input[name]').each((_, el) => {
    const $el = $(el);
    const type = ($el.attr('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return;
    const name = $el.attr('name');
    if (!name) return;
    fields[name] = $el.attr('value') ?? '';
  });
  form.find('select[name]').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (!name) return;
    const selected = $el.find('option[selected]').first().attr('value');
    fields[name] = selected ?? $el.find('option').first().attr('value') ?? '';
  });

  return { actionUrl, fields };
}

/** A short, high-signal search term: the first two significant words of the
 * legal-suffix-stripped company name (e.g. "Deepa Jewellers Limited" -> "deepa
 * jewellers"). Keeps the query specific enough to avoid a flood of unrelated
 * matches while staying tolerant of minor SEBI-side name spelling drift. */
function sebiSearchTerm(companyName: string): string {
  const words = normalizeCompanyNameForMatching(companyName)
    .split(' ')
    .filter(Boolean);
  return words.slice(0, 2).join(' ');
}

function encodeFormBody(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) params.set(name, value);
  return params.toString();
}

const SEBI_FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

export interface FetchSebiListingRowsOptions {
  /** When given, search + page for this company before giving up. */
  companyName?: string;
  fetchImpl: SebiFetcher;
  /** Extra POST/GET requests to attempt after an unmatched search. Default 6. */
  maxPages?: number;
}

export interface FetchSebiListingRowsResult {
  /** Rows from whichever fetch last succeeded (page 1, the search, or a page). */
  rows: SebiListingRow[];
  /** The matched row for `companyName` + the wanted `docType`, or null. */
  matched: SebiListingRow | null;
  /** What this call did, in order — `SEBI:page1`, `SEBI:searched`,
   * `SEBI:paged:<n>`, or an `:http_error:<status>` / `:no_form_found` /
   * `:exhausted` suffix on any step that did not proceed further. */
  rungs: string[];
}

/**
 * `matchSebiRow`, widened for search/paged results.
 *
 * Confirmed live 2026-09-02: a row on the normal listing carries "<Company> -
 * <Kind>" (classified by `classifyByTitle`), but a row returned by the SEARCH
 * or PAGED endpoint carries only the bare company name — no " - DRHP" suffix
 * — so `classifyByTitle` sees an empty kind and `docType` parses as null.
 * Those rows are never a different kind: the listing itself is already
 * scoped to ONE kind via `smid`, which is exactly what picked `docType` in
 * the first place. So an otherwise-unmatched, untyped row is retried as if
 * it carried the wanted `docType` before giving up.
 */
function matchAnyKindRow(
  rows: SebiListingRow[],
  companyName: string,
  docType: DocumentType
): SebiListingRow | null {
  const exact = matchSebiRow(rows, companyName, docType);
  if (exact) return exact;
  const untyped = rows.filter((r) => r.docType === null).map((r) => ({ ...r, docType }));
  if (untyped.length === 0) return null;
  return matchSebiRow(untyped, companyName, docType);
}

/**
 * Fetch a SEBI filing listing for `docType`, searching and paging beyond page
 * 1 when `companyName` is given and not found on the first page. Never throws
 * — an HTTP failure at any step is recorded in `rungs` and the call returns
 * whatever rows it already has.
 */
export async function fetchSebiListingRows(
  docType: DocumentType,
  options: FetchSebiListingRowsOptions
): Promise<FetchSebiListingRowsResult> {
  const rungs: string[] = [];
  const listingUrl = sebiListingUrlFor(docType);
  if (!listingUrl) {
    rungs.push('SEBI:skipped:not_served_by_sebi');
    return { rows: [], matched: null, rungs };
  }

  const { companyName, fetchImpl, maxPages = 6 } = options;

  const page1 = await fetchImpl(listingUrl, { method: 'GET', headers: {} });
  if (page1.status !== 200) {
    rungs.push(`SEBI:page1:http_error:${page1.status}`);
    return { rows: [], matched: null, rungs };
  }
  rungs.push('SEBI:page1');

  let rows = parseSebiListing(page1.body);
  let matched = companyName ? matchAnyKindRow(rows, companyName, docType) : null;
  if (matched || !companyName) {
    return { rows, matched, rungs };
  }

  const form = extractSebiSearchForm(page1.body);
  if (!form) {
    rungs.push('SEBI:search:no_form_found');
    return { rows, matched: null, rungs };
  }

  const requestHeaders = { ...SEBI_FORM_HEADERS, Referer: listingUrl, Origin: SEBI_BASE };

  const searchRes = await fetchImpl(form.actionUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: encodeFormBody({
      ...form.fields,
      search: sebiSearchTerm(companyName),
      fromDate: '',
      toDate: '',
      nextValue: '-1',
    }),
  });
  if (searchRes.status !== 200) {
    rungs.push(`SEBI:searched:http_error:${searchRes.status}`);
    return { rows, matched: null, rungs };
  }
  rungs.push('SEBI:searched');
  rows = parseSebiListing(searchRes.body);
  matched = matchAnyKindRow(rows, companyName, docType);
  if (matched) return { rows, matched, rungs };

  // The search ran but did not surface the row (SEBI's search can be title-only
  // or otherwise miss a valid company) — fall back to paging.
  for (let page = 1; page <= maxPages; page++) {
    const pageRes = await fetchImpl(form.actionUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: encodeFormBody({ ...form.fields, search: '', fromDate: '', toDate: '', nextValue: String(page) }),
    });
    if (pageRes.status !== 200) {
      rungs.push(`SEBI:paged:${page}:http_error:${pageRes.status}`);
      return { rows, matched: null, rungs };
    }
    rungs.push(`SEBI:paged:${page}`);
    rows = parseSebiListing(pageRes.body);
    matched = matchAnyKindRow(rows, companyName, docType);
    if (matched) return { rows, matched, rungs };
  }

  rungs.push('SEBI:paged:exhausted');
  return { rows, matched: null, rungs };
}
