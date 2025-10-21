/**
 * Cache Key Generation Utilities
 *
 * Centralized cache key generation for consistency across the application.
 * Follows the pattern: {entity}:{operation}:{identifier}
 */

import crypto from 'crypto';

/**
 * Cache TTL constants (in seconds)
 */
export const CacheTTL = {
  IPO_LIST: 900, // 15 minutes
  IPO_DETAIL: 900, // 15 minutes (Story 4.1 requirement)
  IPO_SCORE: 900, // 15 minutes (Story 4.7 requirement)
  SUBSCRIPTION_LATEST: 300, // 5 minutes
  GMP_LATEST: 600, // 10 minutes
  HISTORICAL_DATA: 3600, // 1 hour
  HISTORICAL_IPOS: 86400, // 24 hours (Story 6.1 requirement)
  FINANCIAL_DATA: 1800, // 30 minutes
  IPO_FINANCIALS: 1800, // 30 minutes (Story 4.10 requirement)
  IPO_DETAILS: 1800, // 30 minutes (Story 4.11 requirement)
  DOCUMENTS: 3600, // 1 hour
  LISTING_PERFORMANCE: 600, // 10 minutes
  BROKER_AFFILIATES: 1800, // 30 minutes (Story 5.7 requirement)
  CALENDAR: 86400, // 24 hours - calendar data doesn't change frequently
  REFERENCE: 604800, // 7 days - registrars, holidays, sectors (static data)
} as const;

/**
 * Generate cache key for IPO by slug
 */
export function getIPOBySlugKey(slug: string): string {
  return `ipo:slug:${slug}`;
}

/**
 * Generate cache key for IPO detail endpoint (with all relations)
 */
export function getIPODetailKey(slug: string): string {
  return `ipo:detail:${slug}`;
}

/**
 * Generate cache key for IPO by ID
 */
export function getIPOByIdKey(id: string): string {
  return `ipo:id:${id}`;
}

/**
 * Generate cache key for IPO list with filters
 * Uses MD5 hash of filter object to create unique key
 */
export function getIPOListKey(filters: unknown): string {
  const filterHash = crypto
    .createHash('md5')
    .update(JSON.stringify(filters))
    .digest('hex');
  return `ipo:list:${filterHash}`;
}

/**
 * Generate cache key for IPO search results
 */
export function getIPOSearchKey(query: string): string {
  const queryHash = crypto.createHash('md5').update(query).digest('hex');
  return `ipo:search:${queryHash}`;
}

/**
 * Generate cache key for fuzzy search results
 * ISS-027: Fuzzy matching for IPO lookups
 */
export function getFuzzySearchKey(
  query: string,
  limit: number,
  threshold: number
): string {
  const searchParams = `${query}:${limit}:${threshold}`;
  const queryHash = crypto.createHash('md5').update(searchParams).digest('hex');
  return `ipo:fuzzy:${queryHash}`;
}

/**
 * Generate cache key for latest subscription snapshot
 */
export function getLatestSubscriptionKey(ipoId: string): string {
  return `subscription:latest:${ipoId}`;
}

/**
 * Generate cache key for subscription history
 */
export function getSubscriptionHistoryKey(
  ipoId: string,
  days?: number
): string {
  return `subscription:history:${ipoId}:${days || 'all'}`;
}

/**
 * Generate cache key for latest GMP record
 */
export function getLatestGMPKey(ipoId: string): string {
  return `gmp:latest:${ipoId}`;
}

/**
 * Generate cache key for GMP history
 */
export function getGMPHistoryKey(ipoId: string, days?: number): string {
  return `gmp:history:${ipoId}:${days || 'all'}`;
}

/**
 * Generate cache key for financial data
 */
export function getFinancialDataKey(ipoId: string): string {
  return `financial:${ipoId}`;
}

/**
 * Generate cache key for IPO financials (enhanced - Story 4.10)
 */
export function getIpoFinancialsKey(ipoId: string): string {
  return `financials:enhanced:${ipoId}`;
}

/**
 * Generate cache key for IPO details (Story 4.11)
 */
export function getIpoDetailsKey(ipoId: string): string {
  return `details:${ipoId}`;
}

/**
 * Generate cache key for documents
 */
export function getDocumentsKey(ipoId: string): string {
  return `documents:${ipoId}`;
}

/**
 * Generate cache key for listing performance
 */
export function getListingPerformanceKey(ipoId: string): string {
  return `listing:${ipoId}`;
}

/**
 * Generate cache key for IPO score (Story 4.7)
 */
export function getIPOScoreKey(ipoId: string): string {
  return `score:${ipoId}`;
}

/**
 * Get all cache key patterns for IPO invalidation
 */
export function getIPOInvalidationKeys(ipoId: string, slug?: string): string[] {
  const keys = [
    `ipo:id:${ipoId}`,
    `ipo:list:*`,
    `ipo:search:*`,
  ];

  if (slug) {
    keys.push(`ipo:slug:${slug}`);
  }

  return keys;
}

/**
 * Get all cache key patterns for subscription invalidation
 */
export function getSubscriptionInvalidationKeys(ipoId: string): string[] {
  return [
    `subscription:latest:${ipoId}`,
    `subscription:history:${ipoId}:*`,
  ];
}

/**
 * Get all cache key patterns for GMP invalidation
 */
export function getGMPInvalidationKeys(ipoId: string): string[] {
  return [
    `gmp:latest:${ipoId}`,
    `gmp:history:${ipoId}:*`,
  ];
}

/**
 * Get all cache key patterns for IPO score invalidation (Story 4.7)
 */
export function getIPOScoreInvalidationKeys(ipoId: string): string[] {
  return [
    `score:${ipoId}`,
    `ipo:detail:*`, // Invalidate detail pages that include score
  ];
}

/**
 * Generate cache key for historical IPOs with filters
 * Pattern: ipos:history:{year}:{sector}:{performance}:{sort}:{sortOrder}:{page}:{limit}
 */
export function getHistoricalIPOsKey(filters: {
  year?: string;
  sector?: string;
  performance?: string;
  sort?: string;
  sortOrder?: string;
  page?: number;
  limit?: number;
}): string {
  const {
    year = 'All',
    sector = 'All',
    performance = 'All',
    sort = 'listing_date',
    sortOrder = 'desc',
    page = 1,
    limit = 20,
  } = filters;

  return `ipos:history:${year}:${sector}:${performance}:${sort}:${sortOrder}:${page}:${limit}`;
}

/**
 * Get all cache key patterns for historical IPO invalidation
 * Should be called when scraper updates IPO data
 */
export function getHistoricalIPOInvalidationKeys(): string[] {
  return ['ipos:history:*'];
}

/**
 * Generate cache key for calendar data by category
 */
export function getCalendarKey(category: string): string {
  return `calendar:${category.toLowerCase()}:all`;
}

/**
 * Generate cache key for reference data (registrars, market holidays, sectors)
 */
export function getReferenceKey(type: string): string {
  return `reference:${type}`;
}

/**
 * Generate cache key for peer companies by IPO ID
 */
export function getPeerCompaniesKey(ipoId: string): string {
  return `peers:${ipoId}`;
}

/**
 * Get all cache key patterns for calendar invalidation
 */
export function getCalendarInvalidationKeys(): string[] {
  return ['calendar:*'];
}

/**
 * Get all cache key patterns for peer companies invalidation
 */
export function getPeerCompaniesInvalidationKeys(ipoId: string): string[] {
  return [`peers:${ipoId}`];
}
