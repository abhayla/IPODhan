/**
 * Anchor Investors Scraper
 *
 * Extracts anchor investor allocation data from DRHP PDFs.
 *
 * Features:
 * - Downloads and parses DRHP PDF documents
 * - Extracts "Anchor Investor Allocation" section
 * - Parses investor table (name, type, shares, amount, % of issue)
 * - Calculates aggregates (total shares, total amount, investor count)
 * - Computes lock-in dates (30 days, 90 days from bid date)
 * - Handles multiple DRHP formats and layouts
 *
 * @module scrapers/anchor-investors-scraper
 */

import * as pdfParse from 'pdf-parse';
import axios from 'axios';
import { logger } from '../utils/logger';
import { DocumentRepository } from '../repositories/document-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

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

/**
 * Scrapes anchor investor data from DRHP PDF
 *
 * @param db - Database instance
 * @param ipoId - IPO identifier
 * @param companyName - Company name (for logging)
 * @returns Anchor investor data or null if not available
 */
export async function scrapeAnchorInvestors(
  db: NodePgDatabase<typeof schema>,
  ipoId: string,
  companyName: string
): Promise<AnchorInvestorData | null> {
  try {
    logger.info(`[Anchor Investors] Starting scrape for ${companyName} (${ipoId})`);

    // Step 1: Get DRHP URL from documents table
    const drhpUrl = await getDRHPUrl(db, ipoId);
    if (!drhpUrl) {
      logger.warn(`[Anchor Investors] No DRHP found for ${companyName}`);
      return null;
    }

    logger.info(`[Anchor Investors] DRHP URL found: ${drhpUrl}`);

    // Step 2: Download PDF
    const pdfBuffer = await downloadPDF(drhpUrl);
    if (!pdfBuffer) {
      logger.error(`[Anchor Investors] Failed to download PDF for ${companyName}`);
      return null;
    }

    logger.info(`[Anchor Investors] PDF downloaded, size: ${pdfBuffer.length} bytes`);

    // Step 3: Extract text from PDF
    const pdfData = await (pdfParse as any).default(pdfBuffer);
    const text = pdfData.text;

    logger.info(`[Anchor Investors] PDF parsed, text length: ${text.length} characters`);

    // Step 4: Find anchor investor section
    const anchorSection = extractAnchorSection(text);
    if (!anchorSection) {
      logger.warn(`[Anchor Investors] No anchor investor section found for ${companyName}`);
      return null;
    }

    logger.info(`[Anchor Investors] Anchor section found, length: ${anchorSection.length} characters`);

    // Step 5: Parse investor table
    const investors = parseInvestorTable(anchorSection);
    if (investors.length === 0) {
      logger.warn(`[Anchor Investors] No investors parsed for ${companyName}`);
      return null;
    }

    logger.info(`[Anchor Investors] Parsed ${investors.length} investors`);

    // Step 6: Calculate aggregates
    const totalShares = investors.reduce((sum, inv) => sum + inv.shares, 0);
    const totalAmount = investors.reduce((sum, inv) => sum + inv.amount, 0);
    const investorCount = investors.length;

    // Extract bid date (typically 1 day before IPO open)
    const bidDate = extractBidDate(anchorSection);

    // Calculate lock-in dates
    const lockIn50Date = bidDate ? addDays(bidDate, 30) : null;  // 30 days
    const lockIn100Date = bidDate ? addDays(bidDate, 90) : null; // 90 days

    logger.info(`[Anchor Investors] ✓ Successfully scraped ${investorCount} investors, Total: ₹${totalAmount.toFixed(2)} Cr`);

    return {
      bidDate,
      totalSharesOffered: totalShares,
      totalAmountRaised: totalAmount,
      anchorInvestorsCount: investorCount,
      lockIn50PercentDate: lockIn50Date,
      lockInRemainingDate: lockIn100Date,
      investorList: investors
    };

  } catch (error) {
    logger.error(`[Anchor Investors] Error scraping ${companyName}:`, error);
    return null;
  }
}

/**
 * Get DRHP document URL from database
 */
async function getDRHPUrl(
  db: NodePgDatabase<typeof schema>,
  ipoId: string
): Promise<string | null> {
  try {
    const documents = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.ipoId, ipoId))
      .limit(10);

    // Look for DRHP document
    const drhp = documents.find(doc =>
      doc.documentType === 'DRHP' ||
      doc.documentName?.toUpperCase().includes('DRHP') ||
      doc.documentName?.toUpperCase().includes('RED HERRING')
    );

    return drhp?.documentUrl || null;
  } catch (error) {
    logger.error('[Anchor Investors] Error fetching DRHP URL:', error);
    return null;
  }
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
          'Accept': 'application/pdf'
        }
      });

      return Buffer.from(response.data);

    } catch (error) {
      lastError = error as Error;
      logger.warn(`[Anchor Investors] Download attempt ${attempt} failed: ${error}`);

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error('[Anchor Investors] All download attempts failed:', lastError);
  return null;
}

/**
 * Extract anchor investor section from PDF text
 *
 * Searches for common section headers:
 * - "Anchor Investor Allocation"
 * - "Details of Anchor Investors"
 * - "Allocation to Anchor Investors"
 */
function extractAnchorSection(text: string): string | null {
  // Normalize text (remove extra whitespace, normalize case)
  const normalized = text.replace(/\s+/g, ' ');

  // Common section headers
  const sectionHeaders = [
    /anchor\s+investor\s+allocation/i,
    /details\s+of\s+anchor\s+investors/i,
    /allocation\s+to\s+anchor\s+investors/i,
    /anchor\s+investor\s+portion/i,
    /issue\s+to\s+anchor\s+investors/i
  ];

  // Find section start
  let sectionStart = -1;
  let matchedHeader = '';

  for (const pattern of sectionHeaders) {
    const match = normalized.match(pattern);
    if (match && match.index !== undefined) {
      sectionStart = match.index;
      matchedHeader = match[0];
      break;
    }
  }

  if (sectionStart === -1) {
    logger.warn('[Anchor Investors] No anchor section header found');
    return null;
  }

  logger.info(`[Anchor Investors] Found section header: "${matchedHeader}" at position ${sectionStart}`);

  // Extract text from section start to next major section (typically 5000-10000 characters)
  // Look for next section indicators
  const nextSectionPatterns = [
    /\b(issue\s+procedure|basis\s+of\s+allotment|refund\s+procedure|market\s+lot|capitalization)/i
  ];

  let sectionEnd = sectionStart + 15000; // Default: 15000 chars
  for (const pattern of nextSectionPatterns) {
    const match = normalized.substring(sectionStart + 500).match(pattern);
    if (match && match.index !== undefined) {
      sectionEnd = sectionStart + 500 + match.index;
      break;
    }
  }

  const section = normalized.substring(sectionStart, sectionEnd);
  return section;
}

/**
 * Parse investor table from anchor section text
 *
 * Handles multiple table formats:
 * - Tab-separated
 * - Pipe-separated
 * - Space-separated with alignment
 */
function parseInvestorTable(text: string): AnchorInvestor[] {
  const investors: AnchorInvestor[] = [];

  // Pattern 1: Pipe-separated table
  // Example: "SBI Mutual Fund | Mutual Fund | 150,000 | ₹10.43 Cr | 13.04%"
  const pipePattern = /([A-Za-z0-9\s&\(\)\-\.,']+?)\s*[\|\│]\s*([A-Za-z\s]+?)\s*[\|\│]\s*([\d,]+)\s*[\|\│]\s*(?:₹|Rs\.?)?\s*([\d,\.]+)\s*(?:Cr|crore|Crore)?\s*[\|\│]\s*([\d\.]+)\s*%?/g;

  let match;
  while ((match = pipePattern.exec(text)) !== null) {
    const name = match[1].trim();
    const type = match[2].trim();
    const shares = parseInt(match[3].replace(/,/g, ''));
    const amount = parseFloat(match[4].replace(/,/g, ''));
    const percentOfIssue = parseFloat(match[5]);

    // Validation: Skip header rows and invalid data
    if (
      name.toLowerCase().includes('investor') ||
      name.toLowerCase().includes('total') ||
      isNaN(shares) ||
      isNaN(amount) ||
      isNaN(percentOfIssue) ||
      shares <= 0 ||
      amount <= 0
    ) {
      continue;
    }

    investors.push({
      name,
      type,
      shares,
      amount,
      percentOfIssue
    });
  }

  // Pattern 2: Tab or multi-space separated (fallback)
  if (investors.length === 0) {
    const tabPattern = /([A-Za-z0-9\s&\(\)\-\.,']+?)\s{2,}([A-Za-z\s]+?)\s{2,}([\d,]+)\s{2,}(?:₹|Rs\.?)?\s*([\d,\.]+)\s*(?:Cr|crore)?\s{2,}([\d\.]+)\s*%?/g;

    while ((match = tabPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const type = match[2].trim();
      const shares = parseInt(match[3].replace(/,/g, ''));
      const amount = parseFloat(match[4].replace(/,/g, ''));
      const percentOfIssue = parseFloat(match[5]);

      if (
        name.toLowerCase().includes('investor') ||
        name.toLowerCase().includes('total') ||
        isNaN(shares) ||
        isNaN(amount) ||
        isNaN(percentOfIssue) ||
        shares <= 0 ||
        amount <= 0
      ) {
        continue;
      }

      investors.push({
        name,
        type,
        shares,
        amount,
        percentOfIssue
      });
    }
  }

  // Pattern 3: Named capture groups for specific formats
  if (investors.length === 0) {
    // Example: "1. SBI Mutual Fund Mutual Fund 150,000 shares ₹10.43 Crores 13.04%"
    const namedPattern = /\d+\.\s+([A-Za-z0-9\s&\(\)\-\.,']+?)\s+([A-Za-z\s]+?)\s+([\d,]+)\s+(?:shares?)?\s*(?:₹|Rs\.?)?\s*([\d,\.]+)\s*(?:Cr|crore|Crores)\s*([\d\.]+)\s*%/gi;

    while ((match = namedPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const type = match[2].trim();
      const shares = parseInt(match[3].replace(/,/g, ''));
      const amount = parseFloat(match[4].replace(/,/g, ''));
      const percentOfIssue = parseFloat(match[5]);

      if (
        name.toLowerCase().includes('investor') ||
        name.toLowerCase().includes('total') ||
        isNaN(shares) ||
        isNaN(amount) ||
        isNaN(percentOfIssue) ||
        shares <= 0 ||
        amount <= 0
      ) {
        continue;
      }

      investors.push({
        name,
        type,
        shares,
        amount,
        percentOfIssue
      });
    }
  }

  logger.info(`[Anchor Investors] Parsed ${investors.length} investors from table`);

  // Log first few investors for debugging
  if (investors.length > 0) {
    logger.debug(`[Anchor Investors] Sample: ${investors.slice(0, 3).map(i => i.name).join(', ')}`);
  }

  return investors;
}

/**
 * Extract anchor bid date from section text
 *
 * Looks for patterns like:
 * - "Anchor Investor Bidding Date: October 27, 2025"
 * - "Bid Date: 27/10/2025"
 * - "Anchor Portion opened on: 27 Oct 2025"
 */
function extractBidDate(text: string): Date | null {
  // Pattern 1: "Month DD, YYYY"
  const pattern1 = /(?:bid\s+date|anchor\s+.*?date|opened\s+on).*?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
  const match1 = text.match(pattern1);

  if (match1) {
    const month = match1[1];
    const day = parseInt(match1[2]);
    const year = parseInt(match1[3]);
    const date = new Date(`${month} ${day}, ${year}`);

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
    const date = new Date(year, month - 1, day);

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

    const monthMap: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const month = monthMap[monthStr];
    if (month !== undefined) {
      const date = new Date(year, month, day);

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
  result.setDate(result.getDate() + days);
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
        companyName: ipo.companyName
      });

      // Rate limiting: 5 seconds between IPOs (PDF processing is CPU-intensive)
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      logger.error(`[Anchor Investors] Batch scrape error for ${ipo.companyName}:`, error);
      results.push({
        success: false,
        data: null,
        error: (error as Error).message,
        ipoId: ipo.id,
        companyName: ipo.companyName
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  logger.info(`[Anchor Investors] Batch complete: ${successCount}/${ipos.length} successful`);

  return results;
}
