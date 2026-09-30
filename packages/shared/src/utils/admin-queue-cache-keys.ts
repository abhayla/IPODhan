/**
 * The admin queue's cached keys (OD-136): its JS-side setup data and its whole-queue counts. One
 * definition for both writers of the queue: the web admin save (web/lib/cache/cache-keys.ts
 * re-exports these) and the scraper's plan repository, which drops them when a walk answer clears
 * an OD-142 "source no longer first" item, so the queue never shows a cleared item for the cache TTL.
 */
export const ADMIN_QUEUE_SETUP_KEY = 'admin:queue:setup';
export const ADMIN_QUEUE_COUNTS_KEY = 'admin:queue:counts';
export const ADMIN_QUEUE_CACHE_KEYS: readonly string[] = [ADMIN_QUEUE_SETUP_KEY, ADMIN_QUEUE_COUNTS_KEY];
