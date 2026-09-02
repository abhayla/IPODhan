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
/** QIB portion of a book-built issue. */
const QIB_SHARE_OF_ISSUE = 0.5;
/** Slack on the issue-size check - `issue_size` is a scraped, rounded figure. */
const ISSUE_SIZE_SLACK = 0.02;
const SIDECAR_TIMEOUT_MS = 120_000;

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
  try {
    logger.info(`[Anchor Investors] Starting scrape for ${companyName} (${ipoId})`);

    const document = await getAnchorReport(db, ipoId);
    if (!document) {
      logger.warn(`[Anchor Investors] No anchor allocation report on file for ${companyName}`);
      return null;
    }

    const pdfPath = await resolvePdfPath(document, ipoId);
    if (!pdfPath) {
      logger.error(`[Anchor Investors] Anchor report ${document.id} could not be read for ${companyName}`);
      return null;
    }

    const pages = extractPageTexts(pdfPath);
    if (!pages) {
      logger.error(`[Anchor Investors] Text extraction failed for ${companyName}`);
      return null;
    }

    const parsed = parseAnchorReport(pages);
    if (!parsed.ok) {
      logger.warn(`[Anchor Investors] ${companyName}: ${parsed.reason}`);
      return null;
    }
    const report = parsed.value;

    const qibReason = await checkAgainstIssueSize(db, ipoId, report.totalAmountRupees);
    if (qibReason) {
      logger.warn(`[Anchor Investors] ${companyName}: ${qibReason}`);
      return null;
    }

    const bidDate = report.letterDate;
    const mutualFunds = new Set(report.mutualFundShares);

    logger.info(
      `[Anchor Investors] ${companyName}: ${report.rows.length} investors, ` +
        `${report.totalShares} shares at Rs ${report.bidPrice}, ` +
        `Rs ${(report.totalAmountRupees / RUPEES_PER_CRORE).toFixed(2)} Cr`
    );

    return {
      bidDate,
      totalSharesOffered: report.totalShares,
      totalAmountRaised: report.totalAmountRupees / RUPEES_PER_CRORE,
      anchorInvestorsCount: report.rows.length,
      lockIn50PercentDate: bidDate ? addDays(bidDate, 30) : null,
      lockInRemainingDate: bidDate ? addDays(bidDate, 90) : null,
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
  } catch (error) {
    logger.error(`[Anchor Investors] Error scraping ${companyName}:`, error);
    return null;
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
function extractPageTexts(pdfPath: string): string[] | null {
  const res = spawnSync('python', [SIDECAR, pdfPath], {
    encoding: 'utf8',
    timeout: SIDECAR_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (!res.stdout) {
    logger.error(`[Anchor Investors] Text sidecar produced no output: ${res.stderr?.slice(0, 300)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout.trim().split('\n').pop() || '{}');
    if (parsed.error) {
      logger.error(`[Anchor Investors] Text sidecar failed: ${parsed.error}`);
      return null;
    }
    return Array.isArray(parsed.pages) ? parsed.pages : null;
  } catch {
    logger.error('[Anchor Investors] Text sidecar output was not JSON');
    return null;
  }
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

  const cap = issueSize * QIB_SHARE_OF_ISSUE * MAX_ANCHOR_SHARE_OF_QIB * (1 + ISSUE_SIZE_SLACK);
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
