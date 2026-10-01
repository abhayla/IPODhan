/**
 * Chittorgarh Document (DRHP / RHP / Prospectus) Scraper
 *
 * WHY THIS EXISTS (root cause, verified 2026-06-16):
 *   The `documents` table is 0% because nothing ever WRITES extracted prospectus links:
 *   - The old DRHP downloader's search methods were 100% stubbed (`return null`); that dead
 *     module was deleted (T-407) rather than fixed — see `docs/reviews/T-407-plan.md`.
 *   - The BSE detail path (`bse-detail-scraper` + `scrapeBSEIPODetailWithDocuments`) is dead:
 *     BSE's `DisplayIPO.aspx` is now a JS-rendered SPA — a static fetch returns a ~12KB shell
 *     with zero IPO fields and zero document links.
 *   The viable real source is Chittorgarh report 20 (`ipo_prospectus_document_drhp_rhp_pdf`),
 *   a static JSON report listing each IPO with a real `Prospectus (pdf)` URL plus
 *   `~isin` / `~bse_script_code` / `~nse_symbol` / `~URLRewrite_Folder_Name`.
 *
 * This module only DISCOVERS + classifies the document URLs. Persistence is done by the
 * backfill via the shared `DocumentRepository`; downstream extraction (financials/objectives)
 * is a separate, deferred concern (C3b). We store the real external PDF URL — never a fabricated one.
 */
import logger from '../utils/logger.js';
import { classifyByTitle, classifyOfferDocumentCover, fileNameFromUrl } from '../services/document-classifier.js';
import { looksLikePdf } from '../services/primary-source-discovery.js';
import { extractCoverText, type CoverTextResult } from '../services/pdf-cover-text.js';

export type ProspectusDocType = 'DRHP' | 'RHP' | 'PROSPECTUS';

export interface ChittorgarhProspectusRow {
  companyName: string;
  slug: string | null;
  isin: string | null;
  bseScripCode: string | null;
  nseSymbol: string | null;
  exchange: string | null;
  issueType: string | null;
  openDate: string | null;
  pdfUrl: string;
  /** null = the file name names no offer-document type; resolve by cover (#1417), never default. */
  docType: ProspectusDocType | null;
}

const CHITTORGARH_API_BASE = 'https://webnodejs.chittorgarh.com/cloud/report/data-read';
const PROSPECTUS_REPORT_IDS = ['20', '29']; // 20 = mainboard+SME prospectus list; 29 = SME variant

/**
 * Extract the first `href` from an HTML anchor cell, but ONLY if it points at a real PDF.
 * Returns null for missing/empty input or a non-PDF link (honesty: a non-document href is not a document).
 */
export function extractAnchorHref(html: string | null | undefined): string | null {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/href\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  const url = m[1].trim();
  // Only count genuine PDF document links
  if (!/\.pdf(\?|#|$)/i.test(url)) return null;
  return url;
}

/**
 * Classify a prospectus PDF by its FILE NAME only, through the shared classifier
 * (#1116: Gabion's final Prospectus sat at '/RHP/Final%20Prospectus.pdf' and the
 * whole-URL test typed it RHP from the folder name). The folder and host never
 * decide. A file name that names none of the three returns null (#1417): the old
 * default of PROSPECTUS typed a non-offer PDF (an annual report) as the terminal,
 * top-ranked final prospectus (OD-30, OD-154). Such a row is typed by its cover
 * (`resolveProspectusRowType`) or not stored.
 */
export function detectProspectusDocType(
  url: string,
  _exchange?: string | null,
  _issueType?: string | null
): ProspectusDocType | null {
  const fromName = classifyByTitle(fileNameFromUrl(url));
  if (fromName === 'DRHP' || fromName === 'RHP' || fromName === 'PROSPECTUS') return fromName;
  return null;
}

/**
 * The ONE builder of the title a Chittorgarh-sourced `documents` row carries. The backfill writes
 * it; the #1442 repair tool re-writes it on a retype so the stored title never contradicts the new
 * type (retype-misclassified-documents falls back to the title when the file name names no type).
 */
export function chittorgarhDocumentTitle(docType: ProspectusDocType, companyName: string): string {
  return `${docType} — ${companyName} (Chittorgarh)`;
}

export type ProspectusTypeResolution =
  | { ok: true; docType: ProspectusDocType }
  | { ok: false; reason: 'fetch_failed' | 'not_pdf' | 'cover_unreadable' | 'cover_names_no_offer_type' };

export interface ProspectusTypeResolverDeps {
  fetchPdf: (url: string) => Promise<Buffer | null>;
  coverText?: (pdf: Buffer) => Promise<CoverTextResult>;
}

/**
 * Type a Chittorgarh row whose file name named no type, from the downloaded PDF's cover
 * page (#1417). Anything that is not provably an offer document (download failed, not a
 * PDF, unreadable cover, cover names no DRHP/RHP/PROSPECTUS title) is reported with its
 * reason and is NOT stored under a guessed type (same convention as an unclassified zip
 * member, document-download-verifier.ts).
 */
export async function resolveProspectusRowType(
  row: ChittorgarhProspectusRow,
  deps: ProspectusTypeResolverDeps
): Promise<ProspectusTypeResolution> {
  if (row.docType) return { ok: true, docType: row.docType };
  const pdf = await deps.fetchPdf(row.pdfUrl);
  if (!pdf) return { ok: false, reason: 'fetch_failed' };
  if (!looksLikePdf(pdf)) return { ok: false, reason: 'not_pdf' };
  const cover = await (deps.coverText ?? extractCoverText)(pdf);
  if (!cover.usable) return { ok: false, reason: 'cover_unreadable' };
  const t = classifyOfferDocumentCover(cover.text);
  if (t === 'DRHP' || t === 'RHP' || t === 'PROSPECTUS') return { ok: true, docType: t };
  return { ok: false, reason: 'cover_names_no_offer_type' };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Parse raw report-20 rows into typed rows, dropping any row without a usable PDF URL.
 */
export function parseProspectusReportRows(rows: any[] | null | undefined): ChittorgarhProspectusRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ChittorgarhProspectusRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const pdfUrl = extractAnchorHref(row['Prospectus (pdf)'] ?? row['Prospectus'] ?? row['Document']);
    if (!pdfUrl) continue;
    const exchange = str(row['Exchange']);
    const issueType = str(row['Issue Type']);
    out.push({
      companyName: str(row['Company']) ?? '',
      slug: str(row['~URLRewrite_Folder_Name']),
      isin: str(row['~isin']),
      bseScripCode: str(row['~bse_script_code']),
      nseSymbol: str(row['~nse_symbol']),
      exchange,
      issueType,
      openDate: str(row['Opening Date']) ?? str(row['~orderdate']),
      pdfUrl,
      docType: detectProspectusDocType(pdfUrl, exchange, issueType),
    });
  }
  return out;
}

async function fetchReportPage(
  reportId: string,
  page: number,
  perPage: number,
  year: number,
  yearRange: string
): Promise<{ rows: any[]; totalPages: number }> {
  const url = `${CHITTORGARH_API_BASE}/${reportId}/${page}/${perPage}/${year}/${yearRange}/0/all/0?search=&v=15-11`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Chittorgarh report ${reportId} HTTP ${res.status}`);
  const data: any = await res.json();
  return { rows: data?.reportTableData ?? [], totalPages: Number(data?.totalPages) || 1 };
}

/**
 * Fetch all prospectus rows across the given fiscal years (paginated), de-duplicated by pdfUrl.
 * `fiscalYears` entries are { year, range } e.g. { year: 2025, range: '2025-26' }.
 */
export async function fetchChittorgarhProspectusRows(
  fiscalYears: Array<{ year: number; range: string }>,
  perPage = 10 // KNOWN LIMITATION (verified 2026-06-16): this report's JSON only honours
  // perPage 5/10 and ignores pagination (always totalPages=1, ~5 latest rows per fiscal year).
  // The full DRHP archive is behind an unexposed paginated/search endpoint — see DEFERRED note.
): Promise<ChittorgarhProspectusRow[]> {
  const seen = new Set<string>();
  const all: ChittorgarhProspectusRow[] = [];
  for (const reportId of PROSPECTUS_REPORT_IDS) {
    for (const fy of fiscalYears) {
      try {
        const first = await fetchReportPage(reportId, 1, perPage, fy.year, fy.range);
        const rows = first.rows; // pagination is non-functional on this endpoint (see note above)
        const parsed = parseProspectusReportRows(rows);
        for (const r of parsed) {
          if (seen.has(r.pdfUrl)) continue;
          seen.add(r.pdfUrl);
          all.push(r);
        }
        logger.info(
          { reportId, fy: fy.range, fetched: rows.length, withPdf: parsed.length },
          'Chittorgarh prospectus report page set fetched'
        );
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        logger.warn(
          { reportId, fy: fy.range, error: err instanceof Error ? err.message : String(err) },
          'Chittorgarh prospectus report fetch failed (continuing)'
        );
      }
    }
  }
  return all;
}
