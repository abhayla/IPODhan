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
  IPO_DETAIL: 1800, // 30 minutes
  SUBSCRIPTION_LATEST: 300, // 5 minutes
  GMP_LATEST: 600, // 10 minutes
  HISTORICAL_DATA: 3600, // 1 hour
  FINANCIAL_DATA: 1800, // 30 minutes
  DOCUMENTS: 3600, // 1 hour
  LISTING_PERFORMANCE: 600, // 10 minutes
} as const;

/**
 * Generate cache key for IPO by slug
 */
export function getIPOBySlugKey(slug: string): string {
  return `ipo:slug:${slug}`;
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
