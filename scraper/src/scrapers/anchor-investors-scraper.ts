/**
 * Anchor Investors Scraper
 *
 * Extracts anchor investor allocation from the exchange's ANCHOR_ALLOCATION_REPORT
 * (NSE "Anchor Allocation Report", BSE "Anchor_Details") - the "Anchor Intimation
 * letter" the issuer files on T-1.
 *
 * SOURCE CHANGE (W-39, 2026-09-02). This scraper used to start from the DRHP and
 * give up with "No DRHP found". That was wrong twice over:
 *
 *   * A DRHP cannot carry anchor investors. Anchors are allotted the day before
 *     the issue opens; the DRHP is filed months earlier and names nobody.
 *   * The DRHP lookup could not have worked in any case: it filtered on
 *     `documents.documentType` / `documentName` / `documentUrl`, none of which
 *     exist - the columns are `type`, `title`, `url`. `scraper/` compiles with
 *     `strict: false` and has no commit-time type gate, so the dead property
 *     reads were silently `undefined` and the lookup returned null for every IPO
 *     on every run. No git history, test, or row shows it ever producing data.
 *
 * The DRHP path is therefore deleted rather than kept as a fallback: a fallback
 * that has never returned a row is not a fallback, it is a place for bugs to hide.
 *
 * @module scrapers/anchor-investors-scraper
 */

import { existsSync } from 'fs';
import { mkdtemp, writeFile } from 'fs/promises';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { logger } from '../utils/logger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { documentPath, getStoreDir } from '../services/document-store';
import { parseAnchorReport } from './anchor-report-parser';
import { isMemoryAbortStderr } from '../services/memory-abort-stderr.js';

/**
 * Individual anchor investor data
 */
interface AnchorInvestor {
  name: string;
  type: string; // "Mutual Fund", "FII", "Insurance", "AIF", etc.
  shares: number;
  amount: number; // in Crores
  percentOfIssue: number;
}

/**
 * Complete anchor investor allocation data for an IPO
 */
export interface AnchorInvestorData {
  bidDate: Date | null;
  totalSharesOffered: number;
  totalAmountRaised: number; // in Crores
  anchorInvestorsCount: number;
  lockIn50PercentDate: Date | null; // 30 days from bid date
  lockInRemainingDate: Date | null; // 90 days from bid date
  investorList: AnchorInvestor[];

  // T-434 round 4 (MAJOR-2): the letter'''s OWN printed totals, carried through
  // UNCHANGED from the parser so the persistence gates can reconcile the summed
  // rows against an INDEPENDENT statement of the same figures. Null where the
  // scan left the value unreadable — never defaulted to the summed value, which
  // would make the check compare a number with itself.
  printedTotalShares: number | null;
  printedTotalAmountRaised: number | null; // crores, matching totalAmountRaised
  printedCount: number | null;
  /** Both parser-internal cross-checks passed (an ok parse implies both). */
  percentageCheckPassed: boolean;
  sharesTimesPriceCheckPassed: boolean;
}

/**
 * Result of scraping operation
 */
interface ScrapeResult {
  success: boolean;
  data: AnchorInvestorData | null;
  error?: string;
  ipoId: string;
  companyName: string;
}

const RUPEES_PER_CRORE = 10_000_000;
/** SEBI ICDR: the anchor portion may not exceed 60% of the QIB portion. */
const MAX_ANCHOR_SHARE_OF_QIB = 0.6;
/**
 * Largest QIB portion an issue can have: 50% of a Reg 6(1) book-built offer, but
 * 75% when the issuer does not meet the profitability test (Reg 6(2)). The row
 * does not say which regime applies, so the check uses the loosest lawful figure
 * - its job is to catch an impossible anchor book, not to adjudicate the split.
 * Deepa Jewellers is a live example: an anchor book of 42% of the offer is legal
 * under 6(2) and would be wrongly rejected by assuming 50%.
 */
const MAX_QIB_SHARE_OF_ISSUE = 0.75;
/** Slack on the issue-size check - `issue_size` is a scraped, rounded figure. */
const ISSUE_SIZE_SLACK = 0.02;
export const SIDECAR_TIMEOUT_MS = 120_000;
/** Mirrors `memory_guard.EXIT_MEMORY_CEILING` — the sidecar's own OOM exit code. */
export const ANCHOR_SIDECAR_MEMORY_CEILING_EXIT = 3;
/**
 * W-139. The exact reason recorded on `documents.extraction_error` when the
 * sidecar returned pages but every one of them is blank: the letter is a scan
 * and `anchor_report_text.py`'s OCR route did not fire for it. Retrying is
 * pointless until a human looks, so the auto door writes MANUAL_REVIEW.
 */
export const ANCHOR_EMPTY_PAGES_REASON = 'no text and OCR heuristic did not fire';

/**
 * W-142: WHY the scrape now reports a REASON, not just `null`.
 *
 * The automatic door (`filing-auto-persist.ts`) has to stamp
 * `documents.extraction_status` honestly: an OOM-killed sidecar must take the
 * W-137 hard-failure backoff, a page with no text at all is a human's problem
 * (MANUAL_REVIEW), and an ordinary parse failure is a retryable FAILED. All
 * three used to collapse into one `null`, which can only be recorded as "it
 * did not work" — the shape that leaves rows stuck at PENDING forever.
 * `scrapeAnchorInvestors` keeps its exact old signature and delegates here, so
 * the legacy callers are untouched.
 */
export type AnchorScrapeFailureKind =
  | 'no_document'
  | 'unreadable_file'
  | 'hard_failure'
  | 'empty_pages'
  | 'sidecar_error'
  | 'parse_failed'
  | 'issue_size_conflict'
  | 'error';

/**
 * MAJOR-1 (round 2). The automatic door has ALREADY selected one document row
 * and proved its stored file exists. Letting the scrape re-select "the newest
 * active anchor row" (`getAnchorReport`) meant that, with two active anchor
 * rows, the door could stamp COMPLETED on the row it did NOT extract — and
 * `resolvePdfPath`'s last resort is a 3-retry HTTP download with no timeout,
 * fired from inside the deadline-checked extract loop. Pinning both the row id
 * and the verified path closes that: the sidecar runs on exactly the selected
 * row's file, and the automatic door NEVER reaches the network.
 */
export interface PinnedAnchorDocument {
  documentId: string;
  /** The store path the door already proved exists. Never a URL. */
  pdfPath: string;
}

export interface AnchorScrapeOutcome {
  data: AnchorInvestorData | null;
  failure?: { kind: AnchorScrapeFailureKind; reason: string };
}

/** The sidecar's own outcome, before any anchor-table parsing. */
export type SidecarFailure = {
  ok: false;
  kind: 'hard_failure' | 'empty_pages' | 'sidecar_error';
  reason: string;
};
export type SidecarResult = { ok: true; pages: string[] } | SidecarFailure;

/**
 * This workspace compiles with `strict: false`, where a boolean discriminant
 * does NOT narrow a union (the same trap documented on
 * `filing-auto-persist.ts`'s `isExtractorFailure`). A type-predicate function
 * narrows in both modes.
 */
export function isSidecarFailure(result: SidecarResult): result is SidecarFailure {
  return result.ok === false;
}

/**
 * W-139: a page whose text layer produced nothing readable.
 *
 * Every page blank means the sidecar read a scan whose OCR route did not fire
 * (see `anchor_report_text.py`'s `page_needs_ocr`). Parsing that is guaranteed
 * to fail, and retrying it hourly is guaranteed to fail identically — so it is
 * classified here, once, rather than surfacing as a generic parse failure.
 */
export function pagesAreEmpty(pages: string[]): boolean {
  return pages.length === 0 || pages.every((p) => String(p ?? '').trim().length === 0);
}

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/anchor_report_text.py'
);

/**
 * Scrapes anchor investor data from the IPO's anchor allocation report.
 *
 * Returns null - never a partial figure - when the letter cannot be read or its
 * arithmetic does not check out. A half-parsed anchor book published as fact is
 * worse than an empty one.
 *
 * @param db - Database instance
 * @param ipoId - IPO identifier
 * @param companyName - Company name (for logging)
 */
export async function scrapeAnchorInvestors(
  db: NodePgDatabase<typeof schema>,
  ipoId: string,
  companyName: string
): Promise<AnchorInvestorData | null> {
  return (await scrapeAnchorInvestorsDetailed(db, ipoId, companyName)).data;
}

/**
 * The same scrape, reporting WHY it produced nothing (W-142).
 *
 * `scrapeAnchorInvestors` above is a one-line wrapper over this — there is one
 * scrape path, not two, so the automatic and the CLI door can never drift.
 */
export async function scrapeAnchorInvestorsDetailed(
  db: NodePgDatabase<typeof schema>,
  ipoId: string,
  companyName: string,
  pinned?: PinnedAnchorDocument
): Promise<AnchorScrapeOutcome> {
  try {
    logger.info(`[Anchor Investors] Starting scrape for ${companyName} (${ipoId})`);

    let pdfPath: string | null;
    if (pinned) {
      // MAJOR-1: no row re-selection and no download — the caller already
      // selected the row and proved its stored file exists.
      if (!existsSync(pinned.pdfPath)) {
        const reason =
          `anchor report ${pinned.documentId}: stored file missing at ${pinned.pdfPath} — ` +
          'the automatic door never downloads';
        logger.error(`[Anchor Investors] ${reason}`);
        return { data: null, failure: { kind: 'unreadable_file', reason } };
      }
      pdfPath = pinned.pdfPath;
    } else {
      const document = await getAnchorReport(db, ipoId);
      if (!document) {
        logger.warn(`[Anchor Investors] No anchor allocation report on file for ${companyName}`);
        return { data: null, failure: { kind: 'no_document', reason: 'no anchor allocation report on file' } };
      }
      pdfPath = await resolvePdfPath(document, ipoId);
      if (!pdfPath) {
        logger.error(`[Anchor Investors] Anchor report ${document.id} could not be read for ${companyName}`);
        return {
          data: null,
          failure: { kind: 'unreadable_file', reason: `anchor report ${document.id} could not be read` },
        };
      }
    }

    const sidecar = extractPageTexts(pdfPath);
    if (isSidecarFailure(sidecar)) {
      logger.error(`[Anchor Investors] Text extraction failed for ${companyName}: ${sidecar.reason}`);
      return { data: null, failure: { kind: sidecar.kind, reason: sidecar.reason } };
    }

    const parsed = parseAnchorReport((sidecar as { pages: string[] }).pages);
    if (!parsed.ok) {
      // `strict: false` again — read the refusal reason off an explicitly
      // narrowed view rather than relying on the boolean to narrow.
      const reason = (parsed as { reason: string }).reason;
      logger.warn(`[Anchor Investors] ${companyName}: ${reason}`);
      return { data: null, failure: { kind: 'parse_failed', reason } };
    }
    const report = parsed.value;

    const qibReason = await checkAgainstIssueSize(db, ipoId, report.totalAmountRupees);
    if (qibReason) {
      logger.warn(`[Anchor Investors] ${companyName}: ${qibReason}`);
      return { data: null, failure: { kind: 'issue_size_conflict', reason: qibReason } };
    }

    const bidDate = report.letterDate;
    const mutualFunds = new Set(report.mutualFundShares);

    logger.info(
      `[Anchor Investors] ${companyName}: ${report.rows.length} investors, ` +
        `${report.totalShares} shares at Rs ${report.bidPrice}, ` +
        `Rs ${(report.totalAmountRupees / RUPEES_PER_CRORE).toFixed(2)} Cr`
    );

    const data: AnchorInvestorData = {
      bidDate,
      totalSharesOffered: report.totalShares,
      totalAmountRaised: report.totalAmountRupees / RUPEES_PER_CRORE,
      anchorInvestorsCount: report.rows.length,
      lockIn50PercentDate: bidDate ? addDays(bidDate, 30) : null,
      lockInRemainingDate: bidDate ? addDays(bidDate, 90) : null,
      printedTotalShares: report.printedTotalShares,
      printedTotalAmountRaised:
        report.printedTotalAmountRupees === null
          ? null
          : report.printedTotalAmountRupees / RUPEES_PER_CRORE,
      printedCount: report.printedCount,
      percentageCheckPassed: report.percentageCheckPassed,
      sharesTimesPriceCheckPassed: report.sharesTimesPriceCheckPassed,
      investorList: report.rows.map((row) => ({
        name: row.name,
        // The letter names the mutual-fund allottees in a sub-table and nowhere
        // states a category for anyone else, so anything not in that sub-table
        // is reported as unknown rather than guessed at.
        type: mutualFunds.has(row.shares) ? 'Mutual Fund' : 'Unknown',
        shares: row.shares,
        amount: row.amountRupees / RUPEES_PER_CRORE,
        percentOfIssue: row.percentOfAnchorPortion,
      })),
    };
    return { data };
  } catch (error) {
    logger.error(`[Anchor Investors] Error scraping ${companyName}:`, error);
    return {
      data: null,
      failure: { kind: 'error', reason: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** The IPO's live anchor allocation report, newest sequence first. */
async function getAnchorReport(db: NodePgDatabase<typeof schema>, ipoId: string) {
  const rows = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.ipoId, ipoId),
        eq(schema.documents.type, 'ANCHOR_ALLOCATION_REPORT'),
        eq(schema.documents.isActive, true)
      )
    )
    .orderBy(desc(schema.documents.sequenceNumber))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Where the PDF lives on this machine: the document store if the bytes were
 * kept, the row's own path if it points at a file, otherwise a fresh download.
 */
async function resolvePdfPath(
  document: { url: string; sha256: string | null },
  ipoId: string
): Promise<string | null> {
  if (document.sha256) {
    const stored = documentPath(ipoId, 'ANCHOR_ALLOCATION_REPORT', document.sha256, getStoreDir());
    if (existsSync(stored)) return stored;
  }
  if (!/^https?:/i.test(document.url) && existsSync(document.url)) return document.url;

  const pdf = await downloadPDF(document.url);
  if (!pdf) return null;
  const dir = await mkdtemp(path.join(tmpdir(), 'anchor-report-'));
  const file = path.join(dir, 'anchor-allocation-report.pdf');
  await writeFile(file, pdf);
  return file;
}

/**
 * Page texts, via the pdfplumber sidecar.
 *
 * The letter is a scan whose text layer has no reading order, so `pdf-parse`
 * returns the table's digits interleaved between rows. Only word coordinates can
 * rebuild it - see `scripts/anchor_report_text.py`.
 */
export function extractPageTexts(pdfPath: string): SidecarResult {
  const res = spawnSync('python', [SIDECAR, pdfPath], {
    encoding: 'utf8',
    timeout: SIDECAR_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  // W-137 shape, applied to THIS sidecar: `memory_guard` exits 3 on the memory
  // ceiling and prints its JSON; a C-level abort (OpenBLAS/OOM-killer) leaves
  // no usable exit code at all, only a stderr signature. Either is a HARD
  // failure the caller must back off far longer than a parse failure.
  const stderr = res.stderr || '';
  const memoryAbort =
    res.status === ANCHOR_SIDECAR_MEMORY_CEILING_EXIT || isMemoryAbortStderr(stderr);

  // MAJOR-2 (round 2). `spawnSync` reports `status === null` for ANY signal —
  // including its OWN 120s timeout kill. Treating that as a memory abort gave
  // a merely-slow scan the W-137 hard-failure marker, a 24h backoff floor and
  // an error line that named a cause that never happened. The timeout is
  // checked FIRST and reported honestly as an ordinary retryable failure;
  // only exit 3 or the W-137 stderr shape is a memory abort.
  const timedOut = (res.error as { code?: string } | undefined)?.code === 'ETIMEDOUT';
  if (timedOut && !memoryAbort) {
    const reason = `anchor sidecar timed out after ${SIDECAR_TIMEOUT_MS}ms`;
    logger.error(`[Anchor Investors] ${reason}`);
    return { ok: false, kind: 'sidecar_error', reason };
  }
  if (memoryAbort) {
    const reason = `anchor sidecar memory abort (exit ${String(res.status)}): ${stderr.slice(0, 300)}`;
    logger.error(`[Anchor Investors] ${reason}`);
    return { ok: false, kind: 'hard_failure', reason };
  }
  // Round 3 (regression of the W-137 outage fix). `spawnSync` runs python
  // WITHOUT a shell, so the kernel OOM-killer leaves `status: null,
  // signal: 'SIGKILL', error: undefined` and NO stderr at all — the "Killed"
  // text `isMemoryAbortStderr` matches is printed by a SHELL, which is not in
  // this pipeline. That is the exact live W-137 shape (an OOM kill that took
  // pm2 down with it), so it must keep the 24h hard-failure floor rather than
  // fall through to an ordinary hourly retry. A SIGKILL we did not ask for
  // (no `error.code`; the timeout path already returned above) is therefore
  // classified as a hard failure.
  if (res.status === null && res.signal === 'SIGKILL' && !(res.error as { code?: string } | undefined)?.code) {
    const reason = 'anchor sidecar killed by SIGKILL (kernel OOM or external kill), no stderr';
    logger.error(`[Anchor Investors] ${reason}`);
    return { ok: false, kind: 'hard_failure', reason };
  }
  if (res.status === null) {
    // Any other signal, with no memory signature: real, but not a memory
    // ceiling. Ordinary FAILED + backoff, with the signal named.
    const reason = `anchor sidecar killed (signal ${String(res.signal ?? 'unknown')}): ${stderr.slice(0, 300)}`;
    logger.error(`[Anchor Investors] ${reason}`);
    return { ok: false, kind: 'sidecar_error', reason };
  }

  if (!res.stdout) {
    const reason = `text sidecar produced no output: ${stderr.slice(0, 300)}`;
    logger.error(`[Anchor Investors] ${reason}`);
    return { ok: false, kind: 'sidecar_error', reason };
  }
  let parsed: { error?: string; pages?: unknown };
  try {
    parsed = JSON.parse(res.stdout.trim().split('\n').pop() || '{}');
  } catch {
    logger.error('[Anchor Investors] Text sidecar output was not JSON');
    return { ok: false, kind: 'sidecar_error', reason: 'text sidecar output was not JSON' };
  }
  if (parsed.error) {
    logger.error(`[Anchor Investors] Text sidecar failed: ${parsed.error}`);
    return { ok: false, kind: 'sidecar_error', reason: `text sidecar failed: ${parsed.error}` };
  }
  if (!Array.isArray(parsed.pages)) {
    return { ok: false, kind: 'sidecar_error', reason: 'text sidecar returned no pages array' };
  }
  const pages = (parsed.pages as unknown[]).map((p) => String(p ?? ''));
  if (pagesAreEmpty(pages)) {
    return {
      ok: false,
      kind: 'empty_pages',
      reason: ANCHOR_EMPTY_PAGES_REASON,
    };
  }
  return { ok: true, pages };
}

/**
 * SEBI caps the anchor portion at 60% of the QIB portion, which is half of a
 * book-built issue - so the anchor book can never exceed ~30% of the offer.
 * Checked only when the IPO row carries an issue size; a missing size is not
 * evidence of anything and must not fail the parse.
 *
 * Returns a reason when the letter contradicts the offer, null when it does not.
 */
async function checkAgainstIssueSize(
  db: NodePgDatabase<typeof schema>,
  ipoId: string,
  anchorAmountRupees: number
): Promise<string | null> {
  const rows = await db
    .select({ issueSize: schema.ipos.issueSize })
    .from(schema.ipos)
    .where(eq(schema.ipos.id, ipoId))
    .limit(1);
  const issueSize = Number(rows[0]?.issueSize ?? 0);
  if (!Number.isFinite(issueSize) || issueSize <= 0) return null;

  const cap = issueSize * MAX_QIB_SHARE_OF_ISSUE * MAX_ANCHOR_SHARE_OF_QIB * (1 + ISSUE_SIZE_SLACK);
  if (anchorAmountRupees > cap) {
    return (
      `anchor allocation Rs ${(anchorAmountRupees / RUPEES_PER_CRORE).toFixed(2)} Cr exceeds ` +
      `60% of the QIB portion (Rs ${(cap / RUPEES_PER_CRORE).toFixed(2)} Cr) for an issue of ` +
      `Rs ${(issueSize / RUPEES_PER_CRORE).toFixed(2)} Cr`
    );
  }
  return null;
}

/**
 * Download PDF from URL with retry logic
 */
async function downloadPDF(url: string): Promise<Buffer | null> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[Anchor Investors] Downloading PDF (attempt ${attempt}/${maxRetries})`);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 seconds
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/pdf',
        },
      });

      return Buffer.from(response.data);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`[Anchor Investors] Download attempt ${attempt} failed: ${error}`);

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error('[Anchor Investors] All download attempts failed:', lastError);
  return null;
}

// T-327 (round-7 P1-1 class sweep): every branch below builds the returned
// Date via Date.UTC(...), never `new Date(localString)` / `new Date(y, m, d)`
// (both construct at LOCAL midnight and drift a day on a non-UTC host when
// later read back via toISOString() — the prod box is Asia/Kolkata and PM2
// does not propagate TZ; see .claude/rules/utc-naive-timestamp-normalization.md).
const FULL_MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const ABBR_MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Extract an anchor bid date from free text.
 *
 * Retained for callers that hold a date sentence rather than a filing; the
 * anchor report's own date is read by the parser (`letterDate`).
 *
 * Exported purely for direct unit testing (T-327 class sweep) — same pattern
 * as `parseNSEDate` (T-308/T-327), no other behavior change.
 */
export function extractBidDate(text: string): Date | null {
  // Pattern 1: "Month DD, YYYY"
  const pattern1 = /(?:bid\s+date|anchor\s+.*?date|opened\s+on).*?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
  const match1 = text.match(pattern1);

  if (match1) {
    const month = FULL_MONTH_MAP[match1[1].toLowerCase()];
    const day = parseInt(match1[2]);
    const year = parseInt(match1[3]);
    const date = month !== undefined ? new Date(Date.UTC(year, month, day)) : new Date(NaN);

    if (!isNaN(date.getTime())) {
      logger.info(`[Anchor Investors] Extracted bid date: ${date.toISOString()}`);
      return date;
    }
  }

  // Pattern 2: "DD/MM/YYYY" or "DD-MM-YYYY"
  const pattern2 = /(?:bid\s+date|anchor\s+.*?date|opened\s+on).*?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i;
  const match2 = text.match(pattern2);

  if (match2) {
    const day = parseInt(match2[1]);
    const month = parseInt(match2[2]);
    const year = parseInt(match2[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (!isNaN(date.getTime())) {
      logger.info(`[Anchor Investors] Extracted bid date: ${date.toISOString()}`);
      return date;
    }
  }

  // Pattern 3: "DD MMM YYYY"
  const pattern3 = /(?:bid\s+date|anchor\s+.*?date|opened\s+on).*?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i;
  const match3 = text.match(pattern3);

  if (match3) {
    const day = parseInt(match3[1]);
    const monthStr = match3[2];
    const year = parseInt(match3[3]);

    const month = ABBR_MONTH_MAP[monthStr];
    if (month !== undefined) {
      const date = new Date(Date.UTC(year, month, day));

      if (!isNaN(date.getTime())) {
        logger.info(`[Anchor Investors] Extracted bid date: ${date.toISOString()}`);
        return date;
      }
    }
  }

  logger.warn('[Anchor Investors] Could not extract bid date');
  return null;
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Batch scrape anchor investors for multiple IPOs
 *
 * @param db - Database instance
 * @param ipos - Array of IPOs to scrape
 * @returns Array of scrape results
 */
export async function batchScrapeAnchorInvestors(
  db: NodePgDatabase<typeof schema>,
  ipos: Array<{ id: string; companyName: string }>
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  for (const ipo of ipos) {
    try {
      const data = await scrapeAnchorInvestors(db, ipo.id, ipo.companyName);

      results.push({
        success: data !== null,
        data,
        ipoId: ipo.id,
        companyName: ipo.companyName,
      });

      // Rate limiting: 5 seconds between IPOs (PDF processing is CPU-intensive)
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      logger.error(`[Anchor Investors] Batch scrape error for ${ipo.companyName}:`, error);
      results.push({
        success: false,
        data: null,
        error: (error as Error).message,
        ipoId: ipo.id,
        companyName: ipo.companyName,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  logger.info(`[Anchor Investors] Batch complete: ${successCount}/${ipos.length} successful`);

  return results;
}
