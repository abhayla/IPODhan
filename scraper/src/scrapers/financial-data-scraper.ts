/**
 * Financial Data Scraper
 *
 * Extracts financial metrics from DRHP PDFs:
 * - Revenue (FY2022-2024)
 * - Profit (FY2022-2024)
 * - EBITDA (FY2022-2024)
 * - Financial ratios (ROE, RONW, P/E, Debt/Equity)
 * - Net worth, total assets, borrowings
 *
 * Data Source: DRHP PDF documents (pages 200-300 typically)
 * Update Frequency: Daily at 3 AM (after document scraper)
 */

import * as pdfParse from 'pdf-parse';
import axios from 'axios';
import logger from '../utils/logger.js';
import type { DocumentRepository } from '@ipodhan/shared';
import type { FinancialDataInsert } from '@ipodhan/shared';

/**
 * Scraped financial data interface
 */
export interface ScrapedFinancialData {
  ipoId: string;
  // Revenue by fiscal year (in INR crores)
  revenueFy2022?: number;
  revenueFy2023?: number;
  revenueFy2024?: number;
  // Profit by fiscal year (in INR crores)
  profitFy2022?: number;
  profitFy2023?: number;
  profitFy2024?: number;
  // EBITDA by fiscal year (in INR crores)
  ebitdaFy2022?: number;
  ebitdaFy2023?: number;
  ebitdaFy2024?: number;
  // Total Income by fiscal year
  totalIncomeFy2022?: number;
  totalIncomeFy2023?: number;
  totalIncomeFy2024?: number;
  // Financial ratios
  netWorth?: number;
  peRatio?: number;
  eps?: number;
  roe?: number; // Return on Equity (%)
  ronw?: number; // Return on Net Worth (%)
  debtToEquity?: number;
  reservesAndSurplus?: number;
  totalAssets?: number;
  totalBorrowing?: number;
  // Additional metrics
  promoterHoldingPreIssue?: number;
  promoterHoldingPostIssue?: number;
  marketCap?: number;
  preIpoEps?: number;
  postIpoEps?: number;
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return Buffer.from(response.data);
  } catch (error) {
    logger.error({ url, error }, 'Failed to download PDF');
    throw new Error(`PDF download failed: ${error}`);
  }
}

/**
 * Extract numeric value from text (handles crores, lakhs, etc.)
 */
function extractNumericValue(text: string): number | null {
  // Remove commas and extra spaces
  const cleaned = text.replace(/,/g, '').trim();

  // Try to extract number
  const match = cleaned.match(/([\d.]+)/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;

  // Check for unit multipliers
  if (cleaned.toLowerCase().includes('lakh')) {
    return value / 100; // Convert lakhs to crores
  }

  return value;
}

/**
 * Parse revenue data from DRHP text
 */
function parseRevenue(text: string): Partial<ScrapedFinancialData> {
  const revenue: Partial<ScrapedFinancialData> = {};

  // Patterns for revenue extraction
  const patterns = [
    /Revenue(?:\s+from\s+Operations)?.*?FY\s*['\s]?20?(\d{2}).*?₹?\s*([\d,\.]+)\s*(?:Cr|crore)/gi,
    /Total\s+Income.*?FY\s*['\s]?20?(\d{2}).*?₹?\s*([\d,\.]+)\s*(?:Cr|crore)/gi,
    /(?:Revenue|Income).*?(?:2022|22).*?₹?\s*([\d,\.]+)/gi,
    /(?:Revenue|Income).*?(?:2023|23).*?₹?\s*([\d,\.]+)/gi,
    /(?:Revenue|Income).*?(?:2024|24).*?₹?\s*([\d,\.]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern);

    while ((match = regex.exec(text)) !== null) {
      const year = match[1] ? `20${match[1]}` : match[0].includes('2022') || match[0].includes('22') ? '2022' :
                    match[0].includes('2023') || match[0].includes('23') ? '2023' :
                    match[0].includes('2024') || match[0].includes('24') ? '2024' : null;

      const value = extractNumericValue(match[2] || match[1]);

      if (year && value) {
        if (year === '2022') revenue.revenueFy2022 = value;
        if (year === '2023') revenue.revenueFy2023 = value;
        if (year === '2024') revenue.revenueFy2024 = value;
      }
    }
  }

  return revenue;
}

/**
 * Parse profit data from DRHP text
 */
function parseProfit(text: string): Partial<ScrapedFinancialData> {
  const profit: Partial<ScrapedFinancialData> = {};

  const patterns = [
    /(?:Profit After Tax|PAT|Net Profit).*?FY\s*['\s]?20?(\d{2}).*?₹?\s*([\d,\.]+)\s*(?:Cr|crore)/gi,
    /(?:PAT|Net Profit).*?(?:2022|22).*?₹?\s*([\d,\.]+)/gi,
    /(?:PAT|Net Profit).*?(?:2023|23).*?₹?\s*([\d,\.]+)/gi,
    /(?:PAT|Net Profit).*?(?:2024|24).*?₹?\s*([\d,\.]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern);

    while ((match = regex.exec(text)) !== null) {
      const year = match[1] ? `20${match[1]}` : match[0].includes('2022') || match[0].includes('22') ? '2022' :
                    match[0].includes('2023') || match[0].includes('23') ? '2023' :
                    match[0].includes('2024') || match[0].includes('24') ? '2024' : null;

      const value = extractNumericValue(match[2] || match[1]);

      if (year && value) {
        if (year === '2022') profit.profitFy2022 = value;
        if (year === '2023') profit.profitFy2023 = value;
        if (year === '2024') profit.profitFy2024 = value;
      }
    }
  }

  return profit;
}

/**
 * Parse EBITDA data from DRHP text
 */
function parseEBITDA(text: string): Partial<ScrapedFinancialData> {
  const ebitda: Partial<ScrapedFinancialData> = {};

  const patterns = [
    /EBITDA.*?FY\s*['\s]?20?(\d{2}).*?₹?\s*([\d,\.]+)\s*(?:Cr|crore)/gi,
    /EBITDA.*?(?:2022|22).*?₹?\s*([\d,\.]+)/gi,
    /EBITDA.*?(?:2023|23).*?₹?\s*([\d,\.]+)/gi,
    /EBITDA.*?(?:2024|24).*?₹?\s*([\d,\.]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern);

    while ((match = regex.exec(text)) !== null) {
      const year = match[1] ? `20${match[1]}` : match[0].includes('2022') || match[0].includes('22') ? '2022' :
                    match[0].includes('2023') || match[0].includes('23') ? '2023' :
                    match[0].includes('2024') || match[0].includes('24') ? '2024' : null;

      const value = extractNumericValue(match[2] || match[1]);

      if (year && value) {
        if (year === '2022') ebitda.ebitdaFy2022 = value;
        if (year === '2023') ebitda.ebitdaFy2023 = value;
        if (year === '2024') ebitda.ebitdaFy2024 = value;
      }
    }
  }

  return ebitda;
}

/**
 * Parse financial ratios from DRHP text
 */
function parseFinancialRatios(text: string): Partial<ScrapedFinancialData> {
  const ratios: Partial<ScrapedFinancialData> = {};

  // ROE pattern
  const roeMatch = text.match(/(?:ROE|Return on Equity)[:\s]*([\d.]+)%/i);
  if (roeMatch) {
    ratios.roe = parseFloat(roeMatch[1]);
  }

  // RONW pattern
  const ronwMatch = text.match(/(?:RONW|Return on Net Worth)[:\s]*([\d.]+)%/i);
  if (ronwMatch) {
    ratios.ronw = parseFloat(ronwMatch[1]);
  }

  // EPS pattern
  const epsMatch = text.match(/(?:EPS|Earnings Per Share)[:\s]*₹?\s*([\d.]+)/i);
  if (epsMatch) {
    ratios.eps = parseFloat(epsMatch[1]);
  }

  // P/E Ratio pattern
  const peMatch = text.match(/(?:P\/E|PE Ratio)[:\s]*([\d.]+)/i);
  if (peMatch) {
    ratios.peRatio = parseFloat(peMatch[1]);
  }

  // Debt/Equity pattern
  const deMatch = text.match(/Debt[\/\s-]*Equity[:\s]*([\d.]+)/i);
  if (deMatch) {
    ratios.debtToEquity = parseFloat(deMatch[1]);
  }

  // Net Worth pattern
  const nwMatch = text.match(/Net Worth[:\s]*₹?\s*([\d,\.]+)\s*(?:Cr|crore)/i);
  if (nwMatch) {
    ratios.netWorth = extractNumericValue(nwMatch[1]);
  }

  return ratios;
}

/**
 * Calculate derived metrics from parsed data
 */
function calculateDerivedMetrics(
  data: Partial<ScrapedFinancialData>
): Partial<ScrapedFinancialData> {
  // Calculate ROE if not present but we have profit and net worth
  if (!data.roe && data.profitFy2024 && data.netWorth) {
    data.roe = (data.profitFy2024 / data.netWorth) * 100;
  }

  // Calculate RONW if not present (same as ROE typically)
  if (!data.ronw && data.roe) {
    data.ronw = data.roe;
  }

  return data;
}

/**
 * Parse financial tables from DRHP text
 */
function parseFinancialTables(text: string): Partial<ScrapedFinancialData> {
  logger.debug('Parsing financial tables from DRHP');

  // Extract different sections
  const revenue = parseRevenue(text);
  const profit = parseProfit(text);
  const ebitda = parseEBITDA(text);
  const ratios = parseFinancialRatios(text);

  // Combine all data
  let financialData: Partial<ScrapedFinancialData> = {
    ...revenue,
    ...profit,
    ...ebitda,
    ...ratios,
  };

  // Calculate derived metrics
  financialData = calculateDerivedMetrics(financialData);

  return financialData;
}

/**
 * Main scraper function: Extract financial data from DRHP PDF
 * @param documentRepository - Document repository for finding DRHPs
 * @param ipoId - IPO ID to scrape financial data for
 * @returns Scraped financial data or null if scraping failed
 */
export async function scrapeFinancialData(
  documentRepository: DocumentRepository,
  ipoId: string
): Promise<ScrapedFinancialData | null> {
  const startTime = Date.now();

  try {
    logger.info({ ipoId }, 'Starting financial data scraping');

    // Step 1: Get DRHP URL
    const drhpUrl = await getDRHPUrl(documentRepository, ipoId);
    if (!drhpUrl) {
      logger.warn({ ipoId }, 'No DRHP URL found, skipping financial data scraping');
      return null;
    }

    // Step 2: Download PDF
    const pdfBuffer = await downloadPDF(drhpUrl);
    logger.debug({ ipoId, size: pdfBuffer.length }, 'PDF downloaded successfully');

    // Step 3: Extract text from PDF
    const pdfData = await (pdfParse as any).default(pdfBuffer);
    const text = pdfData.text;
    logger.debug({ ipoId, textLength: text.length, pages: pdfData.numpages }, 'PDF text extracted');

    // Step 4: Parse financial tables
    const financialData = parseFinancialTables(text);

    // Step 5: Validate we extracted at least some data
    const hasData = Object.values(financialData).some((val) => val !== null && val !== undefined);

    if (!hasData) {
      logger.warn({ ipoId }, 'No financial data extracted from DRHP');
      return null;
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        ipoId,
        duration,
        fieldsExtracted: Object.keys(financialData).filter(
          (k) => financialData[k as keyof typeof financialData] !== null
        ).length,
      },
      'Financial data scraping completed successfully'
    );

    return {
      ipoId,
      ...financialData,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({ ipoId, duration, error }, 'Financial data scraping failed');
    return null;
  }
}

/**
 * Batch scrape financial data for multiple IPOs
 * @param documentRepository - Document repository
 * @param ipoIds - Array of IPO IDs to scrape
 * @returns Array of successfully scraped financial data
 */
export async function batchScrapeFinancialData(
  documentRepository: DocumentRepository,
  ipoIds: string[]
): Promise<ScrapedFinancialData[]> {
  logger.info({ count: ipoIds.length }, 'Starting batch financial data scraping');

  const results: ScrapedFinancialData[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const ipoId of ipoIds) {
    try {
      const data = await scrapeFinancialData(documentRepository, ipoId);
      if (data) {
        results.push(data);
        successCount++;
      } else {
        failCount++;
      }

      // Add delay between requests to avoid overloading servers
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error({ ipoId, error }, 'Batch scraping failed for IPO');
      failCount++;
    }
  }

  logger.info(
    {
      total: ipoIds.length,
      success: successCount,
      failed: failCount,
    },
    'Batch financial data scraping completed'
  );

  return results;
}
