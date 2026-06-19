/**
 * Primary-Source Document Discovery — PURE, no-network core (Stage B spine).
 *
 * Stage B of `docs/goals/2026-06-19-ipo-data-pipeline-foolproof.md`: the
 * company's-own-filing path (NSE / BSE / SEBI, incl. SME boards) for discovering
 * RHP / DRHP / ADDENDUM / ANCHOR documents. This module is the deterministic,
 * unit-testable CORE: every function takes an ALREADY-FETCHED payload (NSE
 * issueInfo, a BSE detail row, SEBI HTML, or a downloaded buffer) and returns the
 * discovered documents. It performs NO network I/O — fetching, persistence, and
 * orchestration are a separate (network) concern deferred to a later session.
 *
 * Authoritative facts applied here (C-1/C-2 of the contract, live-verified):
 *  - NSE/BSE serve the final RHP (NOT the draft DRHP). Doc URLs are parsed from
 *    the row/detail values — NEVER constructed by filename template (inconsistent).
 *  - `documents.type` maps to the EXISTING `documentTypeEnum`. Anchor docs map to
 *    `ANCHOR_ALLOCATION_REPORT` — there is NO `ANCHOR` enum value.
 *  - NSE/BSE docs are `.zip` wrappers → unzip to the `%PDF` member BEFORE the
 *    PDF-magic validity check (the unzip step is DEFERRED — no unzip dep yet).
 *
 * Pure parsers do NOT log (per `structured-logging.md`, no console.* in src/**).
 */

import * as cheerio from 'cheerio';

/** A `document_type` enum value relevant to primary-source discovery. */
export type DiscoveredDocumentType =
  | 'DRHP'
  | 'RHP'
  | 'PROSPECTUS'
  | 'ADDENDUM'
  | 'ANCHOR_ALLOCATION_REPORT'
  | 'RATIOS_BASIS_ISSUE_PRICE'
  | 'BIDDING_CENTERS'
  | 'SAMPLE_APPLICATION_FORMS'
  | 'SECURITY_PARAMS_PRE_ANCHOR'
  | 'SECURITY_PARAMS_POST_ANCHOR';

export interface DiscoveredDocument {
  type: DiscoveredDocumentType;
  url: string;
  source: 'NSE' | 'BSE' | 'SEBI';
  title: string;
}

export interface SEBIDrhpListingRow {
  detailHref: string;
  title: string;
}

const DOC_URL_EXTENSIONS = ['.zip', '.pdf', '.doc', '.docx'];

/**
 * True when `value` is an http(s) URL pointing at a downloadable document
 * (ends in a doc/zip/pdf extension, ignoring any query string). Rejects plain
 * text ("Available on website") and html-page links (the detail page itself).
 */
function looksLikeDocumentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const pathPart = trimmed.split(/[?#]/)[0].toLowerCase();
  return DOC_URL_EXTENSIONS.some((ext) => pathPart.endsWith(ext));
}

/**
 * Map an NSE dataList row TITLE to a document_type, mirroring the title strings
 * `extractAdditionalNSEFields()` already keys on (nse-api-client.ts:723-752).
 * Returns null for titles that are not tracked document rows.
 */
function nseTitleToDocType(title: string): DiscoveredDocumentType | null {
  // Order matters: the more-specific "Security Parameters Pre/Post-Anchor" rows
  // contain the substring "Anchor", so they MUST be matched before the broad
  // "Anchor" → ANCHOR_ALLOCATION_REPORT rule, or they'd be misclassified.
  if (title.includes('Security Parameters Pre-Anchor')) return 'SECURITY_PARAMS_PRE_ANCHOR';
  if (title.includes('Security Parameters Post-Anchor')) return 'SECURITY_PARAMS_POST_ANCHOR';
  if (title.includes('Red Herring Prospectus') || title.includes('Prospectus')) return 'RHP';
  if (title.includes('Anchor Allocation Report') || title.includes('Anchor')) {
    return 'ANCHOR_ALLOCATION_REPORT';
  }
  if (title.includes('Addendum') || title.includes('Corrigendum')) return 'ADDENDUM';
  if (title.includes('Ratios') || title.includes('Basis of Issue Price')) {
    return 'RATIOS_BASIS_ISSUE_PRICE';
  }
  if (title.includes('Bidding Centers')) return 'BIDDING_CENTERS';
  if (title.includes('Sample Application Forms')) return 'SAMPLE_APPLICATION_FORMS';
  return null;
}

/**
 * Parse NSE `issueInfo.dataList` (`{title, value}[]`) into discovered documents.
 * The row VALUE is the archive URL (taken verbatim, never templated). A row is
 * kept only when its title maps to a tracked doc type AND its value is a real
 * document URL. Returns [] for empty/missing dataList.
 */
export function parseNSEDocuments(issueInfo: any, symbol: string): DiscoveredDocument[] {
  const dataList = issueInfo?.dataList;
  if (!Array.isArray(dataList) || dataList.length === 0) return [];

  const docs: DiscoveredDocument[] = [];
  for (const item of dataList) {
    if (!item || typeof item !== 'object') continue;
    const title = typeof item.title === 'string' ? item.title : '';
    const value = item.value;
    if (!title) continue;

    const type = nseTitleToDocType(title);
    if (!type) continue;
    if (!looksLikeDocumentUrl(value)) continue;

    docs.push({
      type,
      url: (value as string).trim(),
      source: 'NSE',
      title: symbol ? `${symbol} — ${title}` : title,
    });
  }
  return docs;
}

/**
 * BSE detail-row fields → discovered documents. The C-1 research found the
 * `GetMkt_ISSUE_BBS_IPO` detail row carries the RHP under `Prospectus_GID` plus
 * `Addendum` / `Corrigendum` / `Price_Band_Advertisement`. The existing BSE doc
 * code (`scrapeBSEDocuments`) parses URLs straight from the response and there is
 * NO GID→URL builder in the codebase — so we accept a PRE-RESOLVED URL in each
 * field and DEFER URL construction: a bare GID (non-URL) is skipped, never
 * invented into a URL. Returns [] when no field resolves to a document URL.
 */
export function parseBSEDocuments(detailRow: any): DiscoveredDocument[] {
  if (!detailRow || typeof detailRow !== 'object') return [];

  const fieldMap: { field: string; type: DiscoveredDocumentType; label: string }[] = [
    { field: 'Prospectus_GID', type: 'RHP', label: 'Red Herring Prospectus' },
    { field: 'Addendum', type: 'ADDENDUM', label: 'Addendum' },
    { field: 'Corrigendum', type: 'ADDENDUM', label: 'Corrigendum' },
    { field: 'Price_Band_Advertisement', type: 'ADDENDUM', label: 'Price Band Advertisement' },
  ];

  const docs: DiscoveredDocument[] = [];
  for (const { field, type, label } of fieldMap) {
    const value = detailRow[field];
    // DEFER URL construction: only take values that are already resolvable URLs.
    if (!looksLikeDocumentUrl(value)) continue;
    docs.push({ type, url: (value as string).trim(), source: 'BSE', title: label });
  }
  return docs;
}

/**
 * Parse a SEBI filings listing page (server-rendered `table#sample_1` — NOT the
 * dead `table.table-data`) into `{detailHref, title}` rows. The detail href later
 * resolves to a full PDF at `/sebi_data/attachdocs/<mon-yyyy>/<id>.pdf` (network
 * session). Returns [] when the table is absent.
 */
export function parseSEBIDrhpListing(html: string): SEBIDrhpListingRow[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const table = $('table#sample_1');
  if (table.length === 0) return [];

  const rows: SEBIDrhpListingRow[] = [];
  table.find('tbody tr').each((_, tr) => {
    const anchor = $(tr).find('a[href]').first();
    if (anchor.length === 0) return;
    const href = anchor.attr('href');
    const title = anchor.text().trim();
    if (!href || !title) return;
    rows.push({ detailHref: href.trim(), title });
  });

  // Fallback: some SEBI tables omit <tbody> — scan direct rows if none matched.
  if (rows.length === 0) {
    table.find('tr').each((_, tr) => {
      const anchor = $(tr).find('a[href]').first();
      if (anchor.length === 0) return;
      const href = anchor.attr('href');
      const title = anchor.text().trim();
      if (!href || !title) return;
      rows.push({ detailHref: href.trim(), title });
    });
  }

  return rows;
}

/**
 * True when `buf` starts with the `%PDF` magic bytes — the PDF-validity check
 * applied AFTER unzipping (`.zip` wrappers from NSE/BSE must be unzipped first).
 */
export function looksLikePdf(buf: Buffer): boolean {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  return buf.subarray(0, 4).toString('latin1') === '%PDF';
}

/**
 * Extract the first `%PDF` member from a `.zip` buffer.
 *
 * DEFERRED: no unzip dependency (adm-zip/jszip/unzipper) exists in
 * `scraper/package.json`, and the contract forbids adding deps without
 * authorization. This is a documented no-op (returns null) so the download/
 * validate path has a stable signature; the network session that wires real
 * fetching will add the unzip dep and implement the body. `looksLikePdf` already
 * covers the post-unzip validity check and IS unit-tested.
 */
export function extractPdfFromZipBuffer(_buf: Buffer): Buffer | null {
  return null;
}
