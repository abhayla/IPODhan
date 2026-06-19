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
 *    PDF-magic validity check (done here with Node's built-in `zlib`, NO new dep).
 *
 * Pure parsers do NOT log (per `structured-logging.md`, no console.* in src/**).
 */

import * as cheerio from 'cheerio';
import * as zlib from 'node:zlib';

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
  // Case-insensitive; matched against the REAL NSE dataList titles (verified live):
  // "Security Parameters (Pre Anchor)" / "(Post Anchor)" / bare "Security Parameters",
  // "Anchor Allocation Report", "Red Herring Prospectus", "Ratios / Basis of Issue Price",
  // "Bidding Centers", "Sample Application Forms".
  const t = title.toLowerCase();
  // Security-parameters rows contain "anchor" — match them BEFORE the broad anchor rule,
  // or they'd be misclassified as ANCHOR_ALLOCATION_REPORT (the live-caught bug). A bare
  // "Security Parameters" (no Pre/Post qualifier) is the pre-anchor file by NSE convention.
  if (t.includes('security parameter')) {
    return t.includes('post') ? 'SECURITY_PARAMS_POST_ANCHOR' : 'SECURITY_PARAMS_PRE_ANCHOR';
  }
  if (t.includes('red herring') || t.includes('prospectus')) return 'RHP';
  if (t.includes('anchor allocation') || t.includes('anchor')) return 'ANCHOR_ALLOCATION_REPORT';
  if (t.includes('addendum') || t.includes('corrigendum')) return 'ADDENDUM';
  if (t.includes('ratios') || t.includes('basis of issue price')) return 'RATIOS_BASIS_ISSUE_PRICE';
  if (t.includes('bidding center')) return 'BIDDING_CENTERS';
  if (t.includes('sample application form')) return 'SAMPLE_APPLICATION_FORMS';
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

const ZIP_LOCAL_FILE_SIG = 0x04034b50;   // "PK\x03\x04"
const ZIP_CENTRAL_DIR_SIG = 0x02014b50;  // "PK\x01\x02"
const ZIP_EOCD_SIG = 0x06054b50;         // "PK\x05\x06" (End Of Central Directory)
const ZIP_LOCAL_HEADER_SIZE = 30;

/** Inflate one member's data at a local-header offset, using the authoritative
 * compressed size from the central directory. Returns the bytes or null. */
function inflateZipMember(buf: Buffer, localHeaderOffset: number, method: number, compSize: number): Buffer | null {
  if (localHeaderOffset + ZIP_LOCAL_HEADER_SIZE > buf.length) return null;
  if (buf.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIG) return null;
  const nameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + ZIP_LOCAL_HEADER_SIZE + nameLen + extraLen;
  if (dataStart + compSize > buf.length) return null;
  const data = buf.subarray(dataStart, dataStart + compSize);
  try {
    if (method === 0) return Buffer.from(data);          // stored
    if (method === 8) return zlib.inflateRawSync(data);  // deflate
  } catch { /* fall through */ }
  return null;
}

/**
 * Extract the first `%PDF` member from a `.zip` buffer (NSE/BSE serve docs as `.zip`
 * wrappers — C-1) using Node's built-in `zlib` (NO new dependency). Parses the ZIP
 * CENTRAL DIRECTORY (authoritative for sizes) so it handles real NSE archives that use
 * a streaming data descriptor — the local-header compressed size is 0 there, which a
 * naive local-header walk cannot follow (verified against a real 16 MB RHP_*.zip).
 * Falls back to a local-header scan for trivial single-member zips. Never throws.
 */
export function extractPdfFromZipBuffer(buf: Buffer): Buffer | null {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;

  // 1) Central-directory path (robust). Find the EOCD record by scanning back from the
  // end (it is within the last 64 KB + 22 bytes; comment is usually empty).
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) !== ZIP_EOCD_SIG) continue;
    const entryCount = buf.readUInt16LE(i + 10);
    let cdOffset = buf.readUInt32LE(i + 16);
    for (let e = 0; e < entryCount && cdOffset + 46 <= buf.length; e++) {
      if (buf.readUInt32LE(cdOffset) !== ZIP_CENTRAL_DIR_SIG) break;
      const method = buf.readUInt16LE(cdOffset + 10);
      const compSize = buf.readUInt32LE(cdOffset + 20);
      const nameLen = buf.readUInt16LE(cdOffset + 28);
      const extraLen = buf.readUInt16LE(cdOffset + 30);
      const commentLen = buf.readUInt16LE(cdOffset + 32);
      const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
      const content = inflateZipMember(buf, localHeaderOffset, method, compSize);
      if (content && looksLikePdf(content)) return content;
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    break; // found the EOCD; central-dir walked
  }

  // 2) Fallback: simple local-header scan (member sizes present in the local header).
  let offset = 0;
  while (offset + ZIP_LOCAL_HEADER_SIZE <= buf.length && buf.readUInt32LE(offset) === ZIP_LOCAL_FILE_SIG) {
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + ZIP_LOCAL_HEADER_SIZE + nameLen + extraLen;
    if ((flags & 0x08) !== 0 && compSize === 0) break; // data descriptor — handled by path 1
    if (dataStart + compSize > buf.length) break;
    const content = inflateZipMember(buf, offset, method, compSize);
    if (content && looksLikePdf(content)) return content;
    offset = dataStart + compSize;
  }
  return null;
}
