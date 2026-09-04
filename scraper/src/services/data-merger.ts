import logger from '../utils/logger.js';
import { normalizeCompanyName, fuzzyMatch } from '../utils/scraper-utils.js';
import type { ScrapedIPO } from '../utils/validators.js';
import type { MoneycontrolIPO, ChittorgarhIPO } from '../utils/validators.js';

/**
 * Data source priority for conflict resolution
 * Lower number = higher priority (authoritative data)
 */
export const SOURCE_PRIORITY = {
  'NSE': 1,
  'BSE': 2,
  'MONEYCONTROL': 3,
  'CHITTORGARH': 4,
  'API_FALLBACK': 5
} as const;

export type DataSource = keyof typeof SOURCE_PRIORITY;

export interface IPOWithSources extends Omit<ScrapedIPO, 'openDate' | 'closeDate'> {
  dataSources: DataSource[];
  rating?: number;
  listingGains?: number;
  gmp?: number;
  gmpPercentage?: number;
  gmpUpdatedAt?: string;
  // W-116: MONEYCONTROL never provides a real open/close date (see
  // moneycontrol-scraper.ts) - ScrapedIPO's required openDate/closeDate would
  // force this merged-state type to demand a value no source of the union
  // (ScrapedIPO | MoneycontrolIPO | ChittorgarhIPO) is guaranteed to carry.
  openDate?: string;
  closeDate?: string;
}

/**
 * Find matching IPO by company name
 * Uses normalized matching and fuzzy matching for company names
 * @param companyName - Company name to search for
 * @param existingIPOs - Array of existing IPOs
 * @returns Matched IPO or null
 */
export function findMatchingIPO(
  companyName: string,
  existingIPOs: IPOWithSources[]
): IPOWithSources | null {
  const normalized = normalizeCompanyName(companyName);

  // Try exact normalized match first
  for (const ipo of existingIPOs) {
    const existingNormalized = normalizeCompanyName(ipo.companyName);
    if (existingNormalized === normalized) {
      logger.debug({ companyName, match: ipo.companyName }, 'Found exact normalized match');
      return ipo;
    }
  }

  // Try fuzzy matching for complex cases
  const FUZZY_THRESHOLD = 0.85; // 85% similarity required
  for (const ipo of existingIPOs) {
    const existingNormalized = normalizeCompanyName(ipo.companyName);
    const similarity = fuzzyMatch(normalized, existingNormalized);

    if (similarity >= FUZZY_THRESHOLD) {
      logger.debug(
        { companyName, match: ipo.companyName, similarity },
        'Found fuzzy match'
      );
      return ipo;
    }
  }

  return null;
}

/**
 * Merge IPO data from multiple sources with priority-based conflict resolution
 * @param existingIPO - Existing IPO data (or null if new)
 * @param newData - New IPO data from scraper
 * @param source - Data source of new data
 * @returns Merged IPO data
 */
export function mergeIPOData(
  existingIPO: IPOWithSources | null,
  newData: ScrapedIPO | MoneycontrolIPO | ChittorgarhIPO,
  source: DataSource
): IPOWithSources {
  // If no existing IPO, create new entry
  if (!existingIPO) {
    const merged: IPOWithSources = {
      ...newData,
      dataSources: [source]
    };

    // Add source-specific fields
    if ('rating' in newData) {
      merged.rating = newData.rating;
      merged.listingGains = newData.listingGains;
    }
    if ('gmp' in newData) {
      merged.gmp = newData.gmp;
      merged.gmpPercentage = newData.gmpPercentage;
      merged.gmpUpdatedAt = newData.gmpUpdatedAt;
    }

    return merged;
  }

  // Merge with existing data using priority rules
  const existingPriority = Math.min(...existingIPO.dataSources.map(s => SOURCE_PRIORITY[s]));
  const newPriority = SOURCE_PRIORITY[source];

  const merged: IPOWithSources = { ...existingIPO };

  // Add source to sources list if not already present
  if (!merged.dataSources.includes(source)) {
    merged.dataSources.push(source);
  }

  // Priority-based field merging
  if (newPriority <= existingPriority) {
    // New source has higher or equal priority - use its core data
    merged.companyName = newData.companyName;
    merged.issueSize = newData.issueSize;
    merged.priceRangeMin = newData.priceRangeMin;
    merged.priceRangeMax = newData.priceRangeMax;
    // W-116/W-116b (review round 1, MINOR-1): openDate/closeDate can now be
    // absent from a higher-priority source (Moneycontrol never has them;
    // Chittorgarh's own close-date column can be empty) - an unconditional
    // assignment here would overwrite a real existing date with undefined.
    // Dead code today (mergeIPOData has no live caller into this branch with
    // a date-less newData yet), but guard it like the optional fields below
    // rather than leave the landmine.
    if (newData.openDate) merged.openDate = newData.openDate;
    if (newData.closeDate) merged.closeDate = newData.closeDate;
    merged.listingExchange = newData.listingExchange;
    merged.category = newData.category;
    merged.status = newData.status;

    // Preserve optional fields if present in new data
    if (newData.sector) merged.sector = newData.sector;
    if (newData.lotSize) merged.lotSize = newData.lotSize;
    if (newData.faceValue) merged.faceValue = newData.faceValue;
    if (newData.allotmentDate) merged.allotmentDate = newData.allotmentDate;
    if (newData.listingDate) merged.listingDate = newData.listingDate;
    if (newData.companyDescription) merged.companyDescription = newData.companyDescription;
    if (newData.registrar) merged.registrar = newData.registrar;
    if (newData.leadManagers) merged.leadManagers = newData.leadManagers;
  } else {
    // Existing source has higher priority - only supplement missing fields
    if (!merged.sector && newData.sector) merged.sector = newData.sector;
    if (!merged.lotSize && newData.lotSize) merged.lotSize = newData.lotSize;
    if (!merged.faceValue && newData.faceValue) merged.faceValue = newData.faceValue;
    if (!merged.allotmentDate && newData.allotmentDate) merged.allotmentDate = newData.allotmentDate;
    if (!merged.listingDate && newData.listingDate) merged.listingDate = newData.listingDate;
    if (!merged.companyDescription && newData.companyDescription) {
      merged.companyDescription = newData.companyDescription;
    }
    if (!merged.registrar && newData.registrar) merged.registrar = newData.registrar;
    if (!merged.leadManagers && newData.leadManagers) {
      merged.leadManagers = newData.leadManagers;
    }
  }

  // Always merge source-specific supplementary data
  if ('rating' in newData && newData.rating !== undefined) {
    merged.rating = newData.rating;
  }
  if ('listingGains' in newData && newData.listingGains !== undefined) {
    merged.listingGains = newData.listingGains;
  }
  if ('gmp' in newData && newData.gmp !== undefined) {
    merged.gmp = newData.gmp;
    merged.gmpPercentage = newData.gmpPercentage;
    merged.gmpUpdatedAt = newData.gmpUpdatedAt;
  }

  logger.debug(
    {
      companyName: merged.companyName,
      sources: merged.dataSources,
      newSource: source
    },
    'Merged IPO data from multiple sources'
  );

  return merged;
}

/**
 * Deduplicate and merge array of IPO data
 * @param ipos - Array of IPO data from different sources
 * @returns Deduplicated and merged IPO array
 */
export function deduplicateIPOs(ipos: Array<{ data: ScrapedIPO | MoneycontrolIPO | ChittorgarhIPO; source: DataSource }>): IPOWithSources[] {
  const mergedMap = new Map<string, IPOWithSources>();

  for (const { data, source } of ipos) {
    const normalized = normalizeCompanyName(data.companyName);

    // Check if company already exists in merged data
    let existing: IPOWithSources | null = null;
    for (const [key, ipo] of mergedMap.entries()) {
      if (normalizeCompanyName(ipo.companyName) === normalized) {
        existing = ipo;
        break;
      }
    }

    const merged = mergeIPOData(existing, data, source);
    mergedMap.set(normalized, merged);
  }

  return Array.from(mergedMap.values());
}
