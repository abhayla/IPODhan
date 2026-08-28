/**
 * Download verification — decision-matrix §3, "verify before trusting any download".
 *
 * The defect this closes (RC4): the old path trusted an HTTP 200. BSE does not
 * earn that trust. Verified live on 2026-08-28 against a deliberately mangled
 * `listing.bseindia.com` path:
 *
 *     HTTP/1.1 302 Redirect
 *     Location: https://listing.bseindia.com/notfound.htm
 *     Content-Type: text/html; charset=UTF-8
 *     Content-Length: 164
 *     <head><title>Document Moved</title></head>
 *     <body><h1>Object Moved</h1>This document may be found <a HREF="...">here</a></body>
 *
 * A redirect-FOLLOWING client (which `fetch` is by default) ends up on
 * `notfound.htm` at **200 text/html** — the matrix's "200 with an HTML Object
 * Moved body". So status is never the signal: content-type, size, magic bytes
 * and an HTML sniff are.
 *
 * PURE: every function takes an already-downloaded buffer plus its response
 * metadata. No network, no filesystem, no logging — so every rule is unit
 * testable against a byte array.
 */

import { createHash } from 'node:crypto';
import { extractPdfMembersFromZip, looksLikePdf, type ZipPdfMember } from './primary-source-discovery.js';
import { classifyByTitle } from './document-classifier.js';
import type { DocumentType } from './document-types.js';

/** Minimum plausible size for a real filing. The BSE error page is 164 bytes. */
export const MIN_DOCUMENT_BYTES = 50 * 1024;

/** Hard ceiling (matrix F20 — zip bombs / pathological scans). */
export const MAX_DOCUMENT_BYTES = 150 * 1024 * 1024;


/** Fuzzy threshold for the cover-page company-name check (matrix §3 step 4). */
export const COVER_NAME_MIN_TOKEN_RATIO = 0.6;

export type VerifyFailureReason =
  | 'http_error'
  | 'html_body'
  | 'wrong_content_type'
  | 'too_small'
  | 'too_large'
  | 'zip_without_pdf'
  | 'not_a_pdf'
  | 'wrong_company'
  | 'unzipped_too_small'
  | 'unreadable_pdf';

export interface DownloadResponseMeta {
  status: number;
  contentType?: string | null;
  /** The URL actually fetched (post-redirect when known) — recorded in lineage. */
  url: string;
}

export interface VerifyOptions {
  /** When given, the cover page must plausibly name this company (§3 step 4). */
  expectedCompanyName?: string;
  /**
   * Size ceiling override. Injectable so the F20 refusal can be exercised
   * without allocating 150 MB in a unit test, and so a future per-source cap
   * needs no change here. Defaults to MAX_DOCUMENT_BYTES.
   */
  maxBytes?: number;
  /**
   * Which document this download is supposed to BE. Used to pick the right
   * member out of a multi-PDF zip — see `selectZipMemberForType`.
   */
  wantedType?: DocumentType;
  /**
   * Page-1 text, ALREADY extracted by the caller (`pdf-cover-text.ts`).
   *
   * Passed in rather than extracted here so this module stays pure and
   * synchronous — every rule in it is decidable from bytes. Absent or empty
   * means the check is skipped, which is the correct behaviour for a scanned or
   * font-subsetted filing (matrix E4), not a reason to reject one.
   */
  coverText?: string;
  /**
   * True when page-1 extraction FAILED STRUCTURALLY (a parse error), as opposed
   * to succeeding with no usable text.
   *
   * The distinction is the whole point. A scanned or font-subsetted filing has a
   * valid structure and an empty text layer — normal, and the cover check is
   * skipped (E4). A PDF the parser cannot open at all has 0 readable pages, and
   * the matrix records exactly that case live: SEBI's copy of one DRHP was
   * structurally broken. Storing it would hand WP C a file it can never read,
   * so it is rejected here instead.
   */
  coverExtractFailed?: boolean;
}

/**
 * Split into named arms with an explicit guard because this workspace compiles
 * with `strict: false` (deliberate — see shared-package-build.md), and without
 * strictNullChecks TypeScript will not narrow a `ok: true | false` discriminant
 * through `if (verdict.ok)`. `isVerifyFailure` gives consumers the narrowing the
 * compiler flags cannot.
 */
export type VerifySuccess = {
  ok: true;
  /** The PDF bytes — unwrapped from the zip when the download was a zip. */
  pdf: Buffer;
  sha256: string;
  bytes: number;
  wasZip: boolean;
  /** The zip member chosen, when the download was a zip. For the attempt log. */
  zipMember?: string;
  /**
   * Whether the cover-page company check actually RAN. Recorded so a skip is
   * visible in the attempt log instead of looking like a pass — the failure mode
   * this whole check was silently in for the first cut of T-403.
   */
  coverCheck: 'passed' | 'skipped_no_text_layer' | 'skipped_not_requested';
  /**
   * Set when the chosen zip member's own NAME classifies as a DIFFERENT type
   * from the one requested (T-403 V8).
   *
   * This is information, not an error. India's exchanges genuinely label the
   * same PDF differently: NSE's `RATIOS_<SYM>.zip` ("Ratios / Basis of Issue
   * Price") contains the price-band newspaper advertisement, because that ad IS
   * the document carrying the basis of issue price — while BSE publishes the
   * same thing under `Price_Band_Advertisement`. Both are correctly typed for
   * their own source, which is why this is recorded rather than 'corrected':
   * rewriting NSE's type to BSE's would misrepresent what NSE actually served.
   * The sha256 dedup already links the two when the bytes match.
   */
  memberTypeMismatch?: string;
};

export type VerifyFailure = { ok: false; reason: VerifyFailureReason; detail: string };

/** True when the verdict is a failure — and narrows it for the caller. */
export function isVerifyFailure(result: VerifyResult): result is VerifyFailure {
  return result.ok === false;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

const fail = (reason: VerifyFailureReason, detail: string): VerifyResult => ({
  ok: false,
  reason,
  detail,
});

/** sha256 hex of a buffer. The dedup identity across sources (matrix E7/R2). */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * True when the bytes look like an HTML document rather than a filing.
 *
 * Checked on the RAW body regardless of the declared content-type, because the
 * BSE not-found page is the failure we are actually guarding against and a
 * misconfigured host can serve HTML under any content-type. Only the first
 * bytes are examined; a leading BOM/whitespace is skipped.
 */
export function looksLikeHtml(buf: Buffer): boolean {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
  const head = buf.subarray(0, 512).toString('latin1').replace(/^﻿/, '').trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body') ||
    head.includes('object moved')
  );
}

/** True when the declared content-type is one a filing may legitimately have. */
export function isAcceptableContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false; // absent is not acceptable — we cannot vouch for it
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return false;
  return (
    ct.includes('application/pdf') ||
    ct.includes('application/zip') ||
    ct.includes('application/x-zip') ||
    ct.includes('application/octet-stream') ||
    ct.includes('application/download')
  );
}

/** Alphanumeric word tokens, lower-cased, with legal-suffix noise removed. */
function nameTokens(name: string): string[] {
  const STOP = new Set([
    'limited', 'ltd', 'private', 'pvt', 'the', 'and', 'of', 'company', 'co', 'india',
  ]);
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Matrix §3 step 4 — does the cover plausibly name this company?
 *
 * Deliberately token-overlap rather than an exact string match: a PDF text layer
 * extracted from a scanned or oddly-kerned cover breaks the name across spaces
 * and line breaks, so an exact match would reject good documents. Requiring
 * MOST significant tokens to appear still rejects another company's filing,
 * which is the failure being guarded (F8).
 *
 * A company name with no significant tokens left (e.g. "The India Company")
 * returns TRUE — refusing to judge is correct there; a false reject would drop
 * a legitimate filing on a technicality.
 */
export function coverNamesCompany(coverText: string, companyName: string): boolean {
  const wanted = nameTokens(companyName);
  if (wanted.length === 0) return true;
  const haystack = String(coverText || '').toLowerCase();
  const hits = wanted.filter((t) => haystack.includes(t)).length;
  return hits / wanted.length >= COVER_NAME_MIN_TOKEN_RATIO;
}

/**
 * Choose which PDF inside a multi-member zip is the document we asked for.
 *
 * THE DEFECT THIS EXISTS FOR. NSE's `RHP_SKYWAYS.zip` (captured live
 * 2026-08-28) holds three PDFs — CorrigendumofRHPSkyways.pdf (1.4 MB),
 * GID_Skyways.pdf (2.7 MB) and `RHP Skyways.pdf` (19.9 MB). Taking the first
 * member stored the CORRIGENDUM under the RHP's type, and the BSE addendum zip
 * stored the real RHP under ADDENDUM. Both passed every check: valid PDFs, of
 * the right company, of a plausible size. Nothing was broken; everything was
 * wrong. Only the acceptance run noticed, because two document types came out
 * with the same sha256.
 *
 * Selection order:
 *   1. a member whose NAME classifies as the wanted type (the same classifier
 *      used everywhere else, so the rules cannot drift);
 *   2. failing that, the LARGEST member — a prospectus-class filing is an order
 *      of magnitude bigger than the covering letters shipped beside it, so this
 *      is the better guess than 'whichever came first';
 *   3. a single-member zip needs no choosing.
 */
export function selectZipMemberForType(
  members: ZipPdfMember[],
  wantedType?: DocumentType
): ZipPdfMember | null {
  if (members.length === 0) return null;
  if (members.length === 1) return members[0];

  if (wantedType) {
    const named = members.filter((m) => classifyByTitle(baseName(m.name)) === wantedType);
    if (named.length > 0) {
      // More than one member of the right type: take the biggest, on the same
      // reasoning as step 2.
      return named.reduce((a, b) => (b.content.length > a.content.length ? b : a));
    }
  }
  return members.reduce((a, b) => (b.content.length > a.content.length ? b : a));
}

/** The file name inside a zip path ('RHP_SKYWAYS/RHP Skyways.pdf' -> 'RHP Skyways.pdf'). */
function baseName(name: string): string {
  return name.split(/[\/]/).pop() ?? name;
}

/**
 * Verify one downloaded body against every §3 rule that can be checked from
 * bytes. Order matters: cheapest and most diagnostic first, so the failure
 * REASON recorded on the state row names the real problem (an HTML error page
 * is reported as `html_body`, not as `not_a_pdf`).
 *
 * `extractCoverText` is injected rather than imported so this module stays pure
 * and dependency-free; the runner passes a pdftotext-backed implementation, and
 * omitting it simply skips step 4.
 */
export function verifyDownload(
  body: Buffer,
  meta: DownloadResponseMeta,
  options: VerifyOptions = {}
): VerifyResult {
  if (!Buffer.isBuffer(body)) return fail('not_a_pdf', 'body is not a buffer');

  // 1. Status. A non-2xx is a failure even when a body came back.
  if (meta.status < 200 || meta.status >= 300) {
    return fail('http_error', `HTTP ${meta.status} for ${meta.url}`);
  }

  // 2. An HTML body is checked BEFORE size, so the BSE "Object Moved" page is
  //    reported for what it is instead of as a 164-byte "too small".
  if (looksLikeHtml(body)) {
    return fail(
      'html_body',
      `server returned an HTML page (${body.length} bytes) at HTTP ${meta.status} for ${meta.url} — ` +
        'BSE serves its not-found page this way, so a 200 does not mean a document'
    );
  }

  if (!isAcceptableContentType(meta.contentType)) {
    return fail('wrong_content_type', `content-type ${meta.contentType ?? '(absent)'} for ${meta.url}`);
  }

  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  if (body.length > maxBytes) {
    return fail('too_large', `${body.length} bytes exceeds the ${maxBytes}-byte cap`);
  }
  if (body.length < MIN_DOCUMENT_BYTES) {
    return fail('too_small', `${body.length} bytes is under the ${MIN_DOCUMENT_BYTES}-byte floor`);
  }

  // 3. Unwrap a zip to its first PDF member (NSE/BSE serve zip wrappers).
  let pdf = body;
  let wasZip = false;
  let zipMember: string | undefined;
  let memberTypeMismatch: string | undefined;
  const isZip = body.length > 4 && body.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    wasZip = true;
    const members = extractPdfMembersFromZip(body);
    const chosen = selectZipMemberForType(members, options.wantedType);
    if (!chosen) return fail('zip_without_pdf', `zip at ${meta.url} contains no PDF member`);
    pdf = chosen.content;
    zipMember = chosen.name;
    const memberType = classifyByTitle(baseName(chosen.name));
    if (memberType && options.wantedType && memberType !== options.wantedType) {
      memberTypeMismatch = memberType;
    }
  }

  if (!looksLikePdf(pdf)) {
    return fail('not_a_pdf', `body at ${meta.url} does not start with the %PDF magic bytes`);
  }

  // N2: the size floor was checked on the DOWNLOAD. A 60 KB zip can unpack to a
  // 2 KB stub, which would sail past it — so the floor is re-applied to the PDF
  // we are actually going to store.
  if (wasZip && pdf.length < MIN_DOCUMENT_BYTES) {
    return fail(
      'unzipped_too_small',
      `zip member ${zipMember ?? '(unnamed)'} unpacked to ${pdf.length} bytes, under the ${MIN_DOCUMENT_BYTES}-byte floor`
    );
  }

  // 4. Cover page names the expected company (F8 — wrong company's filing).
  let coverCheck: 'passed' | 'skipped_no_text_layer' | 'skipped_not_requested' =
    'skipped_not_requested';
  if (options.coverExtractFailed === true) {
    return fail(
      'unreadable_pdf',
      `page 1 of ${meta.url} could not be parsed at all (0 readable pages) — refusing to store a file nothing can read`
    );
  }

  if (options.expectedCompanyName) {
    const cover = (options.coverText ?? '').trim();
    if (cover === '') {
      // Scanned or font-subsetted cover (matrix E4). Skipping is correct;
      // rejecting would drop legitimate newspaper-advertisement filings.
      coverCheck = 'skipped_no_text_layer';
    } else if (!coverNamesCompany(cover, options.expectedCompanyName)) {
      return fail(
        'wrong_company',
        `cover page does not name "${options.expectedCompanyName}" — refusing to store ${meta.url}`
      );
    } else {
      coverCheck = 'passed';
    }
  }

  return {
    ok: true,
    pdf,
    sha256: sha256Hex(pdf),
    bytes: pdf.length,
    wasZip,
    zipMember,
    memberTypeMismatch,
    coverCheck,
  };
}
