/**
 * Cache-Aside Pattern Utilities
 *
 * Story: 8.3 - Performance Optimization
 * Purpose: Reusable cache-aside pattern implementation for API routes
 * Pattern: Check cache → Cache miss → Fetch from DB → Populate cache → Return
 */

import { safeGet, safeSet } from './redis-client.js';
import { logger } from '../logger.js';
import { CACHE_TTL } from './warm.js';

/**
 * Cache-aside pattern with automatic JSON serialization
 *
 * @param cacheKey - Redis cache key
 * @param ttl - Time to live in seconds
 * @param fetchFn - Function to fetch data on cache miss
 * @returns Cached or freshly fetched data
 */
export async function cacheAside<T>(
  cacheKey: string,
  ttl: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  try {
    // Step 1: Check cache
    const cached = await safeGet(cacheKey);

    if (cached) {
      logger.debug({ cacheKey }, 'Cache hit');
      return JSON.parse(cached) as T;
    }

    logger.debug({ cacheKey }, 'Cache miss');

    // Step 2: Fetch from source (database, external API, etc.)
    const data = await fetchFn();

    // Step 3: Populate cache with TTL
    try {
      await safeSet(cacheKey, JSON.stringify(data), ttl);
      logger.debug({ cacheKey, ttl }, 'Cache populated');
    } catch (cacheError) {
      // Log cache write failure but don't fail the request
      logger.error({ error: cacheError, cacheKey }, 'Failed to populate cache');
    }

    // Step 4: Return data
    return data;
  } catch (error) {
    logger.error({ error, cacheKey }, 'Cache-aside operation failed');
    throw error;
  }
}

/**
 * Cache-aside for IPO list with filter-based cache keys
 *
 * @param filterHash - Hash of filter parameters for unique cache key
 * @param fetchFn - Function to fetch IPO list from repository
 * @returns Cached or freshly fetched IPO list
 */
export async function cacheAsideIPOList<T>(
  filterHash: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = `ipo:list:${filterHash}`;
  return cacheAside(cacheKey, CACHE_TTL.IPO_LIST, fetchFn);
}

/**
 * Cache-aside for IPO detail by slug
 *
 * @param slug - IPO slug
 * @param fetchFn - Function to fetch IPO detail from repository
 * @returns Cached or freshly fetched IPO detail
 */
export async function cacheAsideIPODetail<T>(
  slug: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = `ipo:detail:${slug}`;
  return cacheAside(cacheKey, CACHE_TTL.IPO_DETAIL, fetchFn);
}

/**
 * Cache-aside for subscription data by IPO slug
 *
 * @param slug - IPO slug
 * @param fetchFn - Function to fetch subscription data
 * @returns Cached or freshly fetched subscription data
 */
export async function cacheAsideSubscription<T>(
  slug: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = `ipo:subscription:${slug}`;
  return cacheAside(cacheKey, CACHE_TTL.IPO_SUBSCRIPTION, fetchFn);
}

/**
 * Cache-aside for GMP history by IPO slug
 *
 * @param slug - IPO slug
 * @param fetchFn - Function to fetch GMP history
 * @returns Cached or freshly fetched GMP history
 */
export async function cacheAsideGMP<T>(
  slug: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = `ipo:gmp:${slug}`;
  return cacheAside(cacheKey, CACHE_TTL.GMP_HISTORY, fetchFn);
}

/**
 * Cache-aside for sector list
 *
 * @param fetchFn - Function to fetch sector list
 * @returns Cached or freshly fetched sector list
 */
export async function cacheAsideSectors<T>(
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = 'sectors:list';
  return cacheAside(cacheKey, CACHE_TTL.SECTORS, fetchFn);
}

/**
 * Cache-aside for registrar list
 *
 * @param fetchFn - Function to fetch registrar list
 * @returns Cached or freshly fetched registrar list
 */
export async function cacheAsideRegistrars<T>(
  fetchFn: () => Promise<T>
): Promise<T> {
  const cacheKey = 'registrars:list';
  return cacheAside(cacheKey, CACHE_TTL.REGISTRARS, fetchFn);
}

/**
 * Generate cache key hash from filter parameters
 * Used to create unique cache keys for filtered IPO lists
 *
 * @param filters - Filter object with status, category, sector, etc.
 * @returns Hash string for cache key
 */
export function generateFilterHash(filters: Record<string, any>): string {
  // Sort keys for consistent hashing
  const sortedKeys = Object.keys(filters).sort();
  const filterString = sortedKeys
    .map((key) => `${key}:${JSON.stringify(filters[key])}`)
    .join('|');

  // Simple hash using Buffer (Node.js built-in)
  // In production, consider using crypto.createHash for better distribution
  return Buffer.from(filterString).toString('base64').substring(0, 32);
}
