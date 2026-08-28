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
import type { DocumentType } from './document-types.js';
import {
  classifyByTitle,
  classifyBseField,
  BSE_DOCUMENT_FIELDS,
  type BseDocumentField,
} from './document-classifier.js';

/**
 * The document vocabulary now lives in `document-types.ts` (T-403) so the
 * classifier, the fetch-state machine and these parsers cannot drift apart.
 * Re-exported under the historical name for the existing callers.
 */
export type DiscoveredDocumentType = DocumentType;

export interface DiscoveredDocument {
  type: DiscoveredDocumentType;
  url: string;
  source: 'NSE' | 'BSE' | 'SEBI';
  title: string;
  /** The BSE field or NSE row title the link came from — kept for the attempt log. */
  sourceField?: string;
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

    const type = classifyByTitle(title);
    if (!type) continue;
    if (!looksLikeDocumentUrl(value)) continue;

    docs.push({
      type,
      url: (value as string).trim(),
      source: 'NSE',
      title: symbol ? `${symbol} — ${title.trim()}` : title.trim(),
      sourceField: title,
    });
  }
  return docs;
}

/**
 * BSE core-API (`GetMkt_ISSUE_BBS_IPO`) detail-row fields to discovered documents.
 *
 * T-403 RC2. This used to hard-code one type per field, and folded THREE distinct
 * filings into `ADDENDUM`:
 *
 *   Prospectus_GID          -> RHP        (always, even after the final Prospectus lands)
 *   Addendum                -> ADDENDUM
 *   Corrigendum             -> ADDENDUM   (loses the date precedence a corrigendum carries)
 *   Price_Band_Advertisement-> ADDENDUM   (loses the price-band ad entirely)
 *
 * Typing is now delegated to `classifyBseField`, which reads the file NAME first
 * (so `Prospectus_GID` correctly flips from RHP to PROSPECTUS after close --
 * lifecycle-plan S4) and falls back to the field default. `Anchor_Details` is
 * covered too; it is empty until anchor day, which is F3 (NOT_YET_FILED), not a
 * failure, and simply produces no document here.
 *
 * URL construction is still DEFERRED: a bare GID (non-URL) is skipped, never
 * invented into a URL. Returns [] when no field resolves to a document URL.
 */
export function parseBSEDocuments(detailRow: any): DiscoveredDocument[] {
  if (!detailRow || typeof detailRow !== 'object') return [];

  const docs: DiscoveredDocument[] = [];
  for (const field of Object.keys(BSE_DOCUMENT_FIELDS) as BseDocumentField[]) {
    const value = detailRow[field];
    // DEFER URL construction: only take values that are already resolvable URLs.
    if (!looksLikeDocumentUrl(value)) continue;
    const url = (value as string).trim();
    const type = classifyBseField(field, url);
    if (!type) continue;
    docs.push({ type, url, source: 'BSE', title: field.replace(/_/g, ' ').trim(), sourceField: field });
  }
  return docs;
}

/**
 * Percent-encode the parts of a document URL that a raw `fetch` would choke on.
 *
 * BSE serves real links with LITERAL SPACES in the path -- verified live
 * 2026-08-28 on IPO_NO=7903:
 *   https://www.bseindia.com/downloads/ipo/Addendum to RHP_250820261220.zip
 * `new URL()` normalises those to %20; anything already encoded is left alone
 * (encoding twice would turn %20 into %2520 and 404). Returns the input
 * unchanged when it is not parseable as a URL.
 */
export function encodeDocumentUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
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

/** One PDF found inside a zip, with the member name it was stored under. */
export interface ZipPdfMember {
  name: string;
  content: Buffer;
}

/**
 * EVERY `%PDF` member inside a zip, in central-directory order, with names.
 *
 * The names are load-bearing and their absence was a real, silent defect. NSE's
 * `RHP_SKYWAYS.zip` (23 MB, captured live 2026-08-28) contains FOUR entries:
 *
 *   RHP_SKYWAYS/CorrigendumofRHPSkyways.pdf   1,391,575 bytes
 *   RHP_SKYWAYS/GID_Skyways.pdf               2,744,810 bytes
 *   RHP_SKYWAYS/RHP Skyways.pdf              19,866,505 bytes   <- the actual RHP
 *
 * Taking the FIRST PDF member — which is all the previous helper could do —
 * stored the CORRIGENDUM under the RHP's document type. It passed every check we
 * had: a valid PDF, of the right company, of a plausible size. The T-403
 * acceptance run caught it only because two different document types came out
 * with an identical sha256. This is the wrong-but-working class exactly.
 *
 * Never throws; returns [] for anything that is not a readable zip.
 */
export function extractPdfMembersFromZip(buf: Buffer): ZipPdfMember[] {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return [];
  const members: ZipPdfMember[] = [];

  // Central-directory path (authoritative for sizes; real NSE archives use a
  // streaming data descriptor, so the local header's compressed size is 0).
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
      const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('latin1');
      const content = inflateZipMember(buf, localHeaderOffset, method, compSize);
      if (content && looksLikePdf(content)) members.push({ name, content });
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return members;
  }

  // Fallback: local-header scan (trivial single-member zips with real sizes).
  let offset = 0;
  while (offset + ZIP_LOCAL_HEADER_SIZE <= buf.length && buf.readUInt32LE(offset) === ZIP_LOCAL_FILE_SIG) {
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + ZIP_LOCAL_HEADER_SIZE + nameLen + extraLen;
    if ((flags & 0x08) !== 0 && compSize === 0) break; // data descriptor
    if (dataStart + compSize > buf.length) break;
    const name = buf.subarray(offset + ZIP_LOCAL_HEADER_SIZE, offset + ZIP_LOCAL_HEADER_SIZE + nameLen).toString('latin1');
    const content = inflateZipMember(buf, offset, method, compSize);
    if (content && looksLikePdf(content)) members.push({ name, content });
    offset = dataStart + compSize;
  }
  return members;
}

/**
 * The FIRST `%PDF` member of a zip.
 *
 * Retained for callers that genuinely want any PDF out of a single-member
 * archive. Anything that cares WHICH document it gets must use
 * `extractPdfMembersFromZip` plus `selectZipMemberForType`
 * (`document-download-verifier.ts`) — see that function's note on the
 * Skyways multi-member archive.
 */
export function extractPdfFromZipBuffer(buf: Buffer): Buffer | null {
  return extractPdfMembersFromZip(buf)[0]?.content ?? null;
}

