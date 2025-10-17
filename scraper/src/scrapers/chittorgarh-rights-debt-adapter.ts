/**
 * Chittorgarh Rights & Debt Issue Data Adapter
 *
 * Story: 11.1 - Implement Rights/Debt IPO Detail Scraper
 * Created: 2025-10-17
 *
 * Purpose:
 * - Fetch Rights Issue data from Chittorgarh API (REIT/InvIT category)
 * - Fetch Debt Issue data from Chittorgarh API (NCD/BOND category)
 * - Transform to RightsDebtEnrichmentData format for enrichment
 *
 * API Details:
 * - Base URL: https://webnodejs.chittorgarh.com/cloud/report/data-read/82/...
 * - Categories: "reit", "invit", "ncd", "bond"
 * - Returns: IPO list with issue size, price, dates, lead managers
 */

import logger from '../utils/logger.js';
import { retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import type { RightsDebtEnrichmentData } from './rights-debt-enrichment-scraper.js';

const CHITTORGARH_API_BASE = 'https://webnodejs.chittorgarh.com/cloud/report/data-read';
const REPORT_ID = '82'; // IPO list report ID
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_RANGE = `${CURRENT_YEAR}-${(CURRENT_YEAR + 1) % 100}`; // e.g., "2025-26"

interface ChittorgarhAPIResponse {
  msg: number;
  sSearchWhere: string;
  reportTableData: ChittorgarhAPIRecord[];
  error?: string;
}

interface ChittorgarhAPIRecord {
  'Company': string; // HTML: <a href="/ipo/slug/id/">Company Name</a>
  'Opening Date': string; // "Tue, Oct 07, 2025"
  'Closing Date': string; // "Thu, Oct 09, 2025"
  'Listing Date': string; // "Fri, Oct 10, 2025" or empty
  'Issue Price (Rs.)': string; // "1140.00" or "120.00 to 125.00"
  'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': string; // "11607.01"
  'Listing at': string; // "BSE, NSE" or "NSE SME" or "BSE SME"
  'Lead Manager': string; // HTML: <a href="/lead-manager/slug/">Manager Name</a>
  '~Issue_Open_Date'?: string; // ISO: "2025-10-07T00:00:00.000Z"
  '~IssueCloseDate'?: string; // ISO: "2025-10-09T00:00:00.000Z"
  '~ListingDate'?: string; // ISO: "2025-10-10T00:00:00.000Z"
  'Minimum Application': string; // "14 Shares (Rs. 14,910)" - contains lot size
  'Face Value (Rs.)': string; // "5.00"
  'Registrar': string; // HTML: <a href="/registrar/slug/">Registrar Name</a>
}

/**
 * Extract plain text from HTML anchor tag
 */
function extractTextFromAnchor(html: string): string {
  if (!html) return '';
  const text = html.replace(/<\/?[^>]+(>|$)/g, '');
  return text.trim();
}

/**
 * Parse Chittorgarh API date format to ISO 8601
 */
function parseChittorgarhDate(displayDate: string, isoDate?: string): string {
  if (isoDate) {
    return isoDate.split('T')[0];
  }

  if (!displayDate || displayDate.trim() === '') return '';

  try {
    const date = new Date(displayDate);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Parse price string (fixed or range)
 */
function parseChittorgarhPrice(priceStr: string): { min: number; max: number } {
  if (!priceStr) return { min: 0, max: 0 };

  const cleaned = priceStr.trim();

  // Handle range: "120.00 to 125.00"
  if (cleaned.includes(' to ')) {
    const parts = cleaned.split(' to ').map(p => parseFloat(p.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { min: parts[0], max: parts[1] };
    }
  }

  // Handle fixed price: "1140.00"
  const price = parseFloat(cleaned);
  if (!isNaN(price)) {
    return { min: price, max: price };
  }

  return { min: 0, max: 0 };
}

/**
 * Parse issue amount in crores and convert to basic units
 */
function parseChittorgarhAmount(amountStr: string): number {
  if (!amountStr) return 0;

  const cleaned = amountStr.replace(/[,\s]/g, '');
  const amount = parseFloat(cleaned);

  if (isNaN(amount)) return 0;

  // Amount is in crores, convert to basic units (multiply by 10^7)
  return amount * 10000000;
}

/**
 * Parse lot size from "Minimum Application" field
 * Format: "14 Shares (Rs. 14,910)" or "100 Shares"
 */
function parseLotSize(minApplicationStr: string): number {
  if (!minApplicationStr) return 100; // Default

  try {
    // Extract number before "Shares"
    const match = minApplicationStr.match(/(\d+)\s*Shares?/i);
    if (match && match[1]) {
      const lotSize = parseInt(match[1], 10);
      if (!isNaN(lotSize) && lotSize > 0) {
        return lotSize;
      }
    }
  } catch (error) {
    logger.warn({ minApplicationStr, error }, 'Failed to parse lot size');
  }

  return 100; // Default
}

/**
 * Parse face value
 */
function parseFaceValue(faceValueStr: string): number {
  if (!faceValueStr) return 10; // Default

  try {
    const cleaned = faceValueStr.replace(/[,\s]/g, '');
    const faceValue = parseFloat(cleaned);

    if (!isNaN(faceValue) && faceValue > 0) {
      return Math.round(faceValue); // Integer face value
    }
  } catch (error) {
    logger.warn({ faceValueStr, error }, 'Failed to parse face value');
  }

  return 10; // Default
}

/**
 * Parse lead managers from comma-separated list
 */
function parseLeadManagers(leadManagerStr: string): string[] | null {
  if (!leadManagerStr) return null;

  const managerName = extractTextFromAnchor(leadManagerStr);
  if (!managerName) return null;

  // Split by comma if multiple managers
  const managers = managerName
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0);

  return managers.length > 0 ? managers : null;
}

/**
 * Fetch Rights/Debt issues from Chittorgarh API
 */
async function fetchChittorgarhAPI(
  page: number = 1,
  perPage: number = 100,
  category: 'reit' | 'invit' | 'ncd' | 'bond' = 'reit'
): Promise<ChittorgarhAPIResponse> {
  const url = `${CHITTORGARH_API_BASE}/${REPORT_ID}/${page}/${perPage}/${CURRENT_YEAR}/${YEAR_RANGE}/0/${category}/0?search=&v=15-11`;

  logger.info({ url, category }, 'Fetching Chittorgarh API');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as ChittorgarhAPIResponse;

  logger.debug({
    category,
    msg: data.msg,
    recordCount: data.reportTableData?.length || 0,
  }, 'Chittorgarh API response received');

  return data;
}

/**
 * Transform Chittorgarh API record to RightsDebtEnrichmentData
 */
function transformChittorgarhRecord(
  record: ChittorgarhAPIRecord,
  category: 'RIGHTS' | 'NCD'
): RightsDebtEnrichmentData | null {
  try {
    // Extract company name
    const companyName = extractTextFromAnchor(record['Company']);
    if (!companyName) {
      logger.warn('Chittorgarh record missing company name');
      return null;
    }

    // Parse dates
    const openDate = parseChittorgarhDate(
      record['Opening Date'],
      record['~Issue_Open_Date']
    );
    const closeDate = parseChittorgarhDate(
      record['Closing Date'],
      record['~IssueCloseDate']
    );

    // Skip if missing open date
    if (!openDate) {
      logger.debug({ companyName }, 'Skipping record with missing open date');
      return null;
    }

    // For records without close date, use open date + 3 days as default
    const effectiveCloseDate =
      closeDate ||
      (() => {
        const openDateObj = new Date(openDate);
        openDateObj.setDate(openDateObj.getDate() + 3);
        return openDateObj.toISOString().split('T')[0];
      })();

    // Parse price
    const price = parseChittorgarhPrice(record['Issue Price (Rs.)']);

    // Parse issue amount
    const issueSize = parseChittorgarhAmount(
      record['Total Issue Amount (Incl.Firm reservations) (Rs.cr.)']
    );

    // Parse lot size
    const lotSize = parseLotSize(record['Minimum Application']);

    // Parse face value
    const faceValue = parseFaceValue(record['Face Value (Rs.)']);

    // Parse lead managers
    const leadManagers = parseLeadManagers(record['Lead Manager']);

    // Parse registrar
    const registrar = extractTextFromAnchor(record['Registrar']) || null;

    const enrichmentData: RightsDebtEnrichmentData = {
      companyName,
      issueSize,
      lotSize,
      faceValue,
      priceRangeMin: price.min,
      priceRangeMax: price.max,
      openDate,
      closeDate: effectiveCloseDate,
      registrar,
      leadManagers,
      category,
      dataSource: 'CHITTORGARH',
    };

    return enrichmentData;
  } catch (error) {
    logger.error({ error, record }, 'Failed to transform Chittorgarh record');
    return null;
  }
}

/**
 * Fetch Rights Issue data from Chittorgarh API
 * Combines REIT and InvIT categories
 */
export async function fetchRightsIssuesFromChittorgarh(): Promise<RightsDebtEnrichmentData[]> {
  const results: RightsDebtEnrichmentData[] = [];

  logger.info('Fetching Rights Issues from Chittorgarh API');

  try {
    // Fetch REIT data
    const reitData = await retryWithExponentialBackoff(
      () => fetchChittorgarhAPI(1, 100, 'reit'),
      3,
      1000
    );

    if (reitData.error) {
      logger.error({ error: reitData.error }, 'Chittorgarh API error (REIT)');
    } else if (reitData.reportTableData && reitData.reportTableData.length > 0) {
      for (const record of reitData.reportTableData) {
        const transformed = transformChittorgarhRecord(record, 'RIGHTS');
        if (transformed) {
          results.push(transformed);
        }
      }
      logger.info({ count: results.length }, 'Fetched REIT data');
    }

    // Fetch InvIT data
    const invitData = await retryWithExponentialBackoff(
      () => fetchChittorgarhAPI(1, 100, 'invit'),
      3,
      1000
    );

    if (invitData.error) {
      logger.error({ error: invitData.error }, 'Chittorgarh API error (InvIT)');
    } else if (invitData.reportTableData && invitData.reportTableData.length > 0) {
      for (const record of invitData.reportTableData) {
        const transformed = transformChittorgarhRecord(record, 'RIGHTS');
        if (transformed) {
          results.push(transformed);
        }
      }
      logger.info({ count: results.length }, 'Fetched InvIT data');
    }

    logger.info({ totalRightsIssues: results.length }, 'Rights Issue data fetched from Chittorgarh');
    return results;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Failed to fetch Rights Issues from Chittorgarh');
    return results; // Return partial results
  }
}

/**
 * Fetch Debt Issue data from Chittorgarh API
 * Uses NCD category (bond category may also be available)
 */
export async function fetchDebtIssuesFromChittorgarh(): Promise<RightsDebtEnrichmentData[]> {
  const results: RightsDebtEnrichmentData[] = [];

  logger.info('Fetching Debt Issues from Chittorgarh API');

  try {
    // Fetch NCD data
    const ncdData = await retryWithExponentialBackoff(
      () => fetchChittorgarhAPI(1, 100, 'ncd'),
      3,
      1000
    );

    if (ncdData.error) {
      logger.error({ error: ncdData.error }, 'Chittorgarh API error (NCD)');
    } else if (ncdData.reportTableData && ncdData.reportTableData.length > 0) {
      for (const record of ncdData.reportTableData) {
        const transformed = transformChittorgarhRecord(record, 'NCD');
        if (transformed) {
          results.push(transformed);
        }
      }
      logger.info({ count: results.length }, 'Fetched NCD data');
    }

    logger.info({ totalDebtIssues: results.length }, 'Debt Issue data fetched from Chittorgarh');
    return results;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Failed to fetch Debt Issues from Chittorgarh');
    return results; // Return partial results
  }
}
