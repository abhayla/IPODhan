/**
 * Objectives Scraper
 *
 * Extracts IPO objectives (use of funds) from DRHP PDFs:
 * - Objects of the offer (fundraising objectives)
 * - Allocation amounts per objective
 * - Serial number ordering
 *
 * Data Source: DRHP PDF documents (pages 10-30 typically)
 * Update Frequency: Daily at 6 AM (after anchor investors scraper)
 */

import * as pdfParse from 'pdf-parse';
import axios from 'axios';
import logger from '../utils/logger.js';
import type { DocumentRepository } from '@ipodhan/shared';
import type { IPOObjective } from '@ipodhan/shared';

/**
 * Scraped objectives interface
 */
export interface ScrapedObjectives {
  ipoId: string;
  objectives: IPOObjective[];
}

/**
 * Get DRHP document URL for an IPO
 */
async function getDRHPUrl(
  documentRepository: DocumentRepository,
  ipoId: string
): Promise<string | null> {
  try {
    const documents = await documentRepository.findByIPO(ipoId);

    // Look for DRHP, RHP, or PROSPECTUS
    const drhpDoc = documents.find(
      (doc) =>
        doc.documentType === 'DRHP' ||
        doc.documentType === 'RHP' ||
        doc.documentType === 'PROSPECTUS'
    );

    if (!drhpDoc) {
      logger.warn({ ipoId }, 'No DRHP document found for IPO');
      return null;
    }

    return drhpDoc.documentUrl;
  } catch (error) {
    logger.error({ ipoId, error }, 'Failed to get DRHP URL');
    return null;
  }
}

/**
 * Download PDF from URL
 */
async function downloadPDF(url: string): Promise<Buffer> {
  try {
    logger.debug({ url }, 'Downloading PDF');

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return Buffer.from(response.data);
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      throw new Error(`PDF download timeout: ${url}`);
    }
    throw new Error(`Failed to download PDF: ${error.message}`);
  }
}

/**
 * Extract "Objects of the Offer" section from PDF text
 */
function extractObjectivesSection(text: string): string | null {
  // Common section headers in DRHPs
  const sectionHeaders = [
    'OBJECTS OF THE OFFER',
    'OBJECTS OF THE ISSUE',
    'OBJECT OF THE ISSUE',
    'OBJECT OF THE OFFER',
    'USE OF PROCEEDS',
    'USE OF ISSUE PROCEEDS',
    'FUND UTILIZATION',
  ];

  // Find the section start
  let sectionStart = -1;
  let matchedHeader = '';

  for (const header of sectionHeaders) {
    const index = text.indexOf(header);
    if (index !== -1) {
      sectionStart = index;
      matchedHeader = header;
      break;
    }
  }

  if (sectionStart === -1) {
    logger.warn('No objectives section found in DRHP');
    return null;
  }

  logger.debug({ matchedHeader }, 'Found objectives section');

  // Extract text after the header (next 5000 characters should be enough)
  const sectionText = text.slice(sectionStart, sectionStart + 5000);

  // Find the end of the section (next major heading or page break)
  const endMarkers = [
    '\nCAPITAL STRUCTURE',
    '\nBASIS FOR ISSUE PRICE',
    '\nCAPITALIZATION',
    '\nOVERVIEW OF',
    '\nBUSINESS OVERVIEW',
    '\nINDUSTRY OVERVIEW',
    '\n\n\n\n', // Page break indicator
  ];

  let sectionEnd = sectionText.length;
  for (const marker of endMarkers) {
    const endIndex = sectionText.indexOf(marker, matchedHeader.length + 50);
    if (endIndex !== -1 && endIndex < sectionEnd) {
      sectionEnd = endIndex;
    }
  }

  return sectionText.slice(0, sectionEnd);
}

/**
 * Parse objectives table from section text
 *
 * Handles multiple formats:
 * 1. "1. Working capital requirements - ₹50.00 Cr"
 * 2. "1. Working capital requirements ₹50.00 Crores"
 * 3. "1. Working capital requirements Rs. 50.00 Cr"
 * 4. "(i) General corporate purposes - ₹25.00 Cr"
 * 5. "a. Expansion of facilities ₹100.00 Cr"
 */
function parseObjectivesTable(text: string): IPOObjective[] {
  const objectives: IPOObjective[] = [];

  // Pattern 1: Numbered objectives with amounts
  // Matches: "1. Description - ₹50.00 Cr" or "1. Description ₹50.00 Crores"
  const numberedPattern =
    /(\d+)\.\s+([^\n₹\d]+?)(?:\s*[-–—:]\s*)?(?:₹|Rs\.?)\s*([\d,\.]+)\s*(?:Cr|Crore|crore|Lakhs|lakh)?/gi;

  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    const sno = parseInt(match[1]);
    const description = match[2].trim();
    const amountStr = match[3].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    // Skip invalid entries
    if (!description || description.length < 5 || isNaN(amount)) {
      continue;
    }

    objectives.push({
      sno,
      description,
      amount,
    });
  }

  // Pattern 2: Roman numeral objectives
  // Matches: "(i) Description - ₹50.00 Cr"
  const romanPattern =
    /\(([ivxIVX]+)\)\s+([^\n₹\d]+?)(?:\s*[-–—:]\s*)?(?:₹|Rs\.?)\s*([\d,\.]+)\s*(?:Cr|Crore|crore)?/gi;

  let romanMatch;
  while ((romanMatch = romanPattern.exec(text)) !== null) {
    const romanNumeral = romanMatch[1];
    const description = romanMatch[2].trim();
    const amountStr = romanMatch[3].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (!description || description.length < 5 || isNaN(amount)) {
      continue;
    }

    // Convert roman to number
    const sno = romanToNumber(romanNumeral);

    objectives.push({
      sno,
      description,
      amount,
    });
  }

  // Pattern 3: Lettered objectives
  // Matches: "a. Description - ₹50.00 Cr"
  const letterPattern =
    /([a-z])\.\s+([^\n₹\d]+?)(?:\s*[-–—:]\s*)?(?:₹|Rs\.?)\s*([\d,\.]+)\s*(?:Cr|Crore|crore)?/gi;

  let letterMatch;
  while ((letterMatch = letterPattern.exec(text)) !== null) {
    const letter = letterMatch[1];
    const description = letterMatch[2].trim();
    const amountStr = letterMatch[3].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (!description || description.length < 5 || isNaN(amount)) {
      continue;
    }

    // Convert letter to number (a=1, b=2, etc.)
    const sno = letter.charCodeAt(0) - 96;

    objectives.push({
      sno,
      description,
      amount,
    });
  }

  // Pattern 4: Objectives without amounts (general purposes)
  // Only add if we don't have any objectives yet
  if (objectives.length === 0) {
    const generalPattern =
      /(\d+)\.\s+([^\n]+?)(?=\n\d+\.|\n\n|$)/gi;

    let generalMatch;
    while ((generalMatch = generalPattern.exec(text)) !== null) {
      const sno = parseInt(generalMatch[1]);
      const description = generalMatch[2].trim();

      // Skip if description is too short or contains amount indicators
      if (
        description.length < 10 ||
        /₹|Rs\.?|Cr|crore/i.test(description)
      ) {
        continue;
      }

      objectives.push({
        sno,
        description,
        amount: null, // No amount specified
      });
    }
  }

  // Sort by serial number
  objectives.sort((a, b) => a.sno - b.sno);

  // Deduplicate (keep first occurrence)
  const seen = new Set<number>();
  const deduplicated = objectives.filter((obj) => {
    if (seen.has(obj.sno)) {
      return false;
    }
    seen.add(obj.sno);
    return true;
  });

  logger.debug(
    { count: deduplicated.length },
    'Parsed objectives from DRHP'
  );

  return deduplicated;
}

/**
 * Convert roman numeral to number
 */
function romanToNumber(roman: string): number {
  const romanMap: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
  };

  let result = 0;
  let prevValue = 0;

  for (let i = roman.length - 1; i >= 0; i--) {
    const char = roman[i].toLowerCase();
    const value = romanMap[char] || 0;

    if (value < prevValue) {
      result -= value;
    } else {
      result += value;
    }

    prevValue = value;
  }

  return result;
}

/**
 * Main scraper function: Extract objectives from DRHP PDF
 */
export async function scrapeIPOObjectives(
  documentRepository: DocumentRepository,
  ipoId: string,
  companyName: string
): Promise<ScrapedObjectives | null> {
  try {
    logger.info({ ipoId, companyName }, 'Starting objectives scraping');

    // Step 1: Get DRHP URL
    const drhpUrl = await getDRHPUrl(documentRepository, ipoId);
    if (!drhpUrl) {
      logger.warn({ ipoId }, 'No DRHP URL found, skipping objectives scraping');
      return null;
    }

    // Step 2: Download PDF
    logger.debug({ ipoId, drhpUrl }, 'Downloading DRHP PDF');
    const pdfBuffer = await downloadPDF(drhpUrl);

    // Step 3: Extract text from PDF
    logger.debug({ ipoId }, 'Extracting text from PDF');
    const pdfData = await (pdfParse as any).default(pdfBuffer);
    const text = pdfData.text;

    if (!text || text.length < 100) {
      throw new Error('PDF text extraction failed or empty');
    }

    logger.debug(
      { ipoId, textLength: text.length },
      'PDF text extracted successfully'
    );

    // Step 4: Find objectives section
    const objectivesSection = extractObjectivesSection(text);
    if (!objectivesSection) {
      logger.warn(
        { ipoId },
        'No objectives section found in DRHP'
      );
      return null;
    }

    // Step 5: Parse objectives table
    const objectives = parseObjectivesTable(objectivesSection);

    if (objectives.length === 0) {
      logger.warn(
        { ipoId },
        'No objectives parsed from DRHP section'
      );
      return null;
    }

    // Calculate total amount
    const totalAmount = objectives.reduce(
      (sum, obj) => sum + (obj.amount || 0),
      0
    );

    logger.info(
      {
        ipoId,
        companyName,
        objectivesCount: objectives.length,
        totalAmount,
      },
      'Successfully scraped objectives'
    );

    return {
      ipoId,
      objectives,
    };
  } catch (error: any) {
    logger.error(
      {
        ipoId,
        companyName,
        error: error.message,
        stack: error.stack,
      },
      'Failed to scrape objectives'
    );
    return null;
  }
}

/**
 * Batch scrape objectives for multiple IPOs
 */
export async function batchScrapeObjectives(
  documentRepository: DocumentRepository,
  ipos: Array<{ id: string; companyName: string }>
): Promise<{
  successful: ScrapedObjectives[];
  failed: Array<{ ipoId: string; companyName: string; error: string }>;
}> {
  const successful: ScrapedObjectives[] = [];
  const failed: Array<{ ipoId: string; companyName: string; error: string }> =
    [];

  logger.info({ count: ipos.length }, 'Starting batch objectives scraping');

  for (const ipo of ipos) {
    try {
      const result = await scrapeIPOObjectives(
        documentRepository,
        ipo.id,
        ipo.companyName
      );

      if (result) {
        successful.push(result);
      } else {
        failed.push({
          ipoId: ipo.id,
          companyName: ipo.companyName,
          error: 'No objectives data extracted',
        });
      }

      // Rate limiting: 3 seconds between requests
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error: any) {
      failed.push({
        ipoId: ipo.id,
        companyName: ipo.companyName,
        error: error.message,
      });
    }
  }

  logger.info(
    {
      total: ipos.length,
      successful: successful.length,
      failed: failed.length,
    },
    'Batch objectives scraping completed'
  );

  return { successful, failed };
}
