/**
 * Rights & Debt Issue Detail Enrichment Scraper
 *
 * Story: 11.1 - Implement Rights/Debt IPO Detail Scraper
 * Created: 2025-10-17
 *
 * Purpose:
 * - Enrich BSE Rights Issues (RI) with detail data from alternative sources
 * - Enrich BSE Debt Issues (NCD/DPI) with detail data from alternative sources
 * - Fix missing issue_size, lot_size, face_value, registrar data for 12 BSE IPOs
 *
 * Data Sources (Priority Order):
 * 1. Chittorgarh API - Primary source (supports REIT/InvIT, NCD/BOND)
 * 2. Moneycontrol - Fallback source (to be implemented if needed)
 * 3. Manual Entry - Last resort for critical IPOs
 *
 * Approach:
 * - Fuzzy matching: Match Rights/Debt IPOs by company name (85% similarity)
 * - Data merging: Only enrich fields that are 0 or null in BSE data
 * - Validation: Ensure all enriched data passes Zod schemas
 */

import logger from '../utils/logger.js';
import { sanitizeText } from '../utils/scraper-utils.js';
import type { ScrapedIPO } from '../utils/validators.js';

export interface RightsDebtEnrichmentData {
  companyName: string;
  issueSize: number;
  lotSize: number;
  faceValue: number;
  priceRangeMin: number;
  priceRangeMax: number;
  openDate: string;
  closeDate: string;
  registrar: string | null;
  leadManagers: string[] | null;
  category: 'RIGHTS' | 'NCD';
  dataSource: 'CHITTORGARH' | 'MONEYCONTROL' | 'MANUAL';
}

export interface RightsDebtEnrichmentResult {
  enriched: ScrapedIPO[];
  errors: string[];
  stats: {
    totalProcessed: number;
    enrichedCount: number;
    failedMatches: number;
    dataSource: 'CHITTORGARH' | 'MONEYCONTROL' | 'MANUAL';
  };
}

/**
 * Calculate string similarity using Levenshtein distance
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity percentage (0-100)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 100;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 || len2 === 0) return 0;

  // Levenshtein distance algorithm
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const similarity = ((maxLen - distance) / maxLen) * 100;

  return Math.round(similarity);
}

/**
 * Normalize company name for better matching
 * Removes common suffixes like "LIMITED", "LTD", "PVT", etc.
 */
function normalizeCompanyName(name: string): string {
  let normalized = sanitizeText(name).toUpperCase();

  // Remove common company suffixes
  const suffixes = [
    'LIMITED',
    'LTD',
    'PVT',
    'PRIVATE',
    'CORPORATION',
    'CORP',
    'COMPANY',
    'CO',
    'INC',
    'INCORPORATED',
    'IPO',
    'ISSUE',
    'RIGHTS',
    'DEBT',
    'NCD',
  ];

  for (const suffix of suffixes) {
    const regex = new RegExp(`\\b${suffix}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Find best match for a BSE IPO from enrichment data sources
 * Uses fuzzy matching with 85% similarity threshold
 */
export function findBestMatch(
  bseIPO: ScrapedIPO,
  enrichmentData: RightsDebtEnrichmentData[]
): RightsDebtEnrichmentData | null {
  const bseNameNormalized = normalizeCompanyName(bseIPO.companyName);

  let bestMatch: RightsDebtEnrichmentData | null = null;
  let bestSimilarity = 0;

  for (const enrichment of enrichmentData) {
    const enrichmentNameNormalized = normalizeCompanyName(enrichment.companyName);
    const similarity = calculateSimilarity(bseNameNormalized, enrichmentNameNormalized);

    logger.debug({
      bseName: bseIPO.companyName,
      bseNormalized: bseNameNormalized,
      enrichmentName: enrichment.companyName,
      enrichmentNormalized: enrichmentNameNormalized,
      similarity,
    }, 'Calculating name similarity');

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = enrichment;
    }
  }

  // Require at least 85% similarity for a match
  if (bestSimilarity >= 85) {
    logger.info({
      bseName: bseIPO.companyName,
      matchedName: bestMatch?.companyName,
      similarity: bestSimilarity,
    }, 'Found match for BSE IPO');
    return bestMatch;
  }

  logger.warn({
    bseName: bseIPO.companyName,
    bestMatchName: bestMatch?.companyName,
    bestSimilarity,
  }, 'No match found (similarity < 85%)');

  return null;
}

/**
 * Merge enrichment data into BSE IPO
 * Only updates fields that are missing (0, null, or default values)
 */
export function mergeEnrichmentData(
  bseIPO: ScrapedIPO,
  enrichment: RightsDebtEnrichmentData
): ScrapedIPO {
  const enriched = { ...bseIPO };

  // Enrich issue size (if 0)
  if (enriched.issueSize === 0 && enrichment.issueSize > 0) {
    enriched.issueSize = enrichment.issueSize;
    logger.debug({ field: 'issueSize', value: enrichment.issueSize }, 'Enriched field');
  }

  // Enrich lot size (if default 100)
  if (enriched.lotSize === 100 && enrichment.lotSize > 0 && enrichment.lotSize !== 100) {
    enriched.lotSize = enrichment.lotSize;
    logger.debug({ field: 'lotSize', value: enrichment.lotSize }, 'Enriched field');
  }

  // Enrich face value (if default 10)
  if (enriched.faceValue === 10 && enrichment.faceValue > 0 && enrichment.faceValue !== 10) {
    enriched.faceValue = enrichment.faceValue;
    logger.debug({ field: 'faceValue', value: enrichment.faceValue }, 'Enriched field');
  }

  // Enrich price range (if 0)
  if (enriched.priceRangeMin === 0 && enrichment.priceRangeMin > 0) {
    enriched.priceRangeMin = enrichment.priceRangeMin;
    enriched.priceRangeMax = enrichment.priceRangeMax;
    logger.debug({
      field: 'priceRange',
      min: enrichment.priceRangeMin,
      max: enrichment.priceRangeMax,
    }, 'Enriched field');
  }

  // Enrich dates (if empty)
  if (!enriched.openDate && enrichment.openDate) {
    enriched.openDate = enrichment.openDate;
    logger.debug({ field: 'openDate', value: enrichment.openDate }, 'Enriched field');
  }

  if (!enriched.closeDate && enrichment.closeDate) {
    enriched.closeDate = enrichment.closeDate;
    logger.debug({ field: 'closeDate', value: enrichment.closeDate }, 'Enriched field');
  }

  // Enrich registrar (if not already set)
  if (!('registrar' in enriched) && enrichment.registrar) {
    (enriched as any).registrar = enrichment.registrar;
    logger.debug({ field: 'registrar', value: enrichment.registrar }, 'Enriched field');
  }

  // Enrich lead managers (if not already set)
  if (!('leadManagers' in enriched) && enrichment.leadManagers) {
    (enriched as any).leadManagers = enrichment.leadManagers;
    logger.debug({
      field: 'leadManagers',
      value: enrichment.leadManagers,
    }, 'Enriched field');
  }

  // Add data source tracking
  (enriched as any).enrichmentSource = enrichment.dataSource;

  return enriched;
}

/**
 * Enrich Rights Issues using Chittorgarh data
 * @param bseRightsIPOs - Rights IPOs from BSE that need enrichment
 * @param chittorgarhData - Rights issue data from Chittorgarh API
 */
export async function enrichRightsIssuesFromChittorgarh(
  bseRightsIPOs: ScrapedIPO[],
  chittorgarhData: RightsDebtEnrichmentData[]
): Promise<RightsDebtEnrichmentResult> {
  const result: RightsDebtEnrichmentResult = {
    enriched: [],
    errors: [],
    stats: {
      totalProcessed: bseRightsIPOs.length,
      enrichedCount: 0,
      failedMatches: 0,
      dataSource: 'CHITTORGARH',
    },
  };

  logger.info({
    bseRightsCount: bseRightsIPOs.length,
    chittorgarhCount: chittorgarhData.length,
  }, 'Starting Rights Issue enrichment from Chittorgarh');

  for (const bseIPO of bseRightsIPOs) {
    try {
      // Find matching Chittorgarh data
      const match = findBestMatch(bseIPO, chittorgarhData);

      if (!match) {
        logger.warn({ companyName: bseIPO.companyName }, 'No Chittorgarh match found for Rights Issue');
        result.errors.push(`No match found for: ${bseIPO.companyName}`);
        result.stats.failedMatches++;
        result.enriched.push(bseIPO); // Include original IPO even if no match
        continue;
      }

      // Merge enrichment data
      const enriched = mergeEnrichmentData(bseIPO, match);
      result.enriched.push(enriched);
      result.stats.enrichedCount++;

      logger.info({
        companyName: bseIPO.companyName,
        matchedName: match.companyName,
        enrichedFields: {
          issueSize: enriched.issueSize !== bseIPO.issueSize,
          lotSize: enriched.lotSize !== bseIPO.lotSize,
          faceValue: enriched.faceValue !== bseIPO.faceValue,
        },
      }, 'Successfully enriched Rights Issue');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({
        companyName: bseIPO.companyName,
        error: errorMsg,
      }, 'Failed to enrich Rights Issue');
      result.errors.push(`${bseIPO.companyName}: ${errorMsg}`);
      result.enriched.push(bseIPO); // Include original IPO on error
    }
  }

  logger.info({
    totalProcessed: result.stats.totalProcessed,
    enrichedCount: result.stats.enrichedCount,
    failedMatches: result.stats.failedMatches,
    errors: result.errors.length,
  }, 'Rights Issue enrichment completed');

  return result;
}

/**
 * Enrich Debt Issues using Chittorgarh data
 * @param bseDebtIPOs - Debt IPOs from BSE that need enrichment
 * @param chittorgarhData - Debt issue data from Chittorgarh API
 */
export async function enrichDebtIssuesFromChittorgarh(
  bseDebtIPOs: ScrapedIPO[],
  chittorgarhData: RightsDebtEnrichmentData[]
): Promise<RightsDebtEnrichmentResult> {
  const result: RightsDebtEnrichmentResult = {
    enriched: [],
    errors: [],
    stats: {
      totalProcessed: bseDebtIPOs.length,
      enrichedCount: 0,
      failedMatches: 0,
      dataSource: 'CHITTORGARH',
    },
  };

  logger.info({
    bseDebtCount: bseDebtIPOs.length,
    chittorgarhCount: chittorgarhData.length,
  }, 'Starting Debt Issue enrichment from Chittorgarh');

  for (const bseIPO of bseDebtIPOs) {
    try {
      // Find matching Chittorgarh data
      const match = findBestMatch(bseIPO, chittorgarhData);

      if (!match) {
        logger.warn({ companyName: bseIPO.companyName }, 'No Chittorgarh match found for Debt Issue');
        result.errors.push(`No match found for: ${bseIPO.companyName}`);
        result.stats.failedMatches++;
        result.enriched.push(bseIPO); // Include original IPO even if no match
        continue;
      }

      // Merge enrichment data
      const enriched = mergeEnrichmentData(bseIPO, match);
      result.enriched.push(enriched);
      result.stats.enrichedCount++;

      logger.info({
        companyName: bseIPO.companyName,
        matchedName: match.companyName,
        enrichedFields: {
          issueSize: enriched.issueSize !== bseIPO.issueSize,
          lotSize: enriched.lotSize !== bseIPO.lotSize,
          faceValue: enriched.faceValue !== bseIPO.faceValue,
        },
      }, 'Successfully enriched Debt Issue');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({
        companyName: bseIPO.companyName,
        error: errorMsg,
      }, 'Failed to enrich Debt Issue');
      result.errors.push(`${bseIPO.companyName}: ${errorMsg}`);
      result.enriched.push(bseIPO); // Include original IPO on error
    }
  }

  logger.info({
    totalProcessed: result.stats.totalProcessed,
    enrichedCount: result.stats.enrichedCount,
    failedMatches: result.stats.failedMatches,
    errors: result.errors.length,
  }, 'Debt Issue enrichment completed');

  return result;
}

/**
 * Validate enrichment data before merging
 */
export function validateEnrichmentData(data: RightsDebtEnrichmentData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.companyName || data.companyName.trim() === '') {
    errors.push('Missing company name');
  }

  if (data.issueSize < 0) {
    errors.push('Invalid issue size (negative)');
  }

  if (data.lotSize < 0) {
    errors.push('Invalid lot size (negative)');
  }

  if (data.faceValue < 0) {
    errors.push('Invalid face value (negative)');
  }

  if (data.priceRangeMin < 0 || data.priceRangeMax < 0) {
    errors.push('Invalid price range (negative)');
  }

  if (data.priceRangeMin > data.priceRangeMax) {
    errors.push('Invalid price range (min > max)');
  }

  if (data.category !== 'RIGHTS' && data.category !== 'NCD') {
    errors.push(`Invalid category: ${data.category} (must be RIGHTS or NCD)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
