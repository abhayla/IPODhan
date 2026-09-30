/**
 * §9.2 item 23: an IPO invalidation (hide, unhide, any admin write) must clear every reader cache
 * that can hold the row — including the 24 h history list, the listings pages, the fuzzy slug
 * fallback — and the scraper's lock cache, so a hidden row stops receiving writes at once.
 */
import { describe, it, expect } from 'vitest';
import { getIPOInvalidationKeys } from '@/lib/cache/cache-keys';
import { invalidateIPOCaches, type CacheDeleter } from '@/lib/cache/ipo-cache-invalidation';

function fakeRedis(keys: string[]): CacheDeleter & { left: Set<string> } {
  const left = new Set(keys);
  const escape = (s: string) => s.replace(/[.+?^$(){}|[\]\\]/g, (c) => '\\' + c);
  const glob = (p: string) => new RegExp('^' + p.split('*').map(escape).join('.*') + '$');
  return {
    left,
    async del(...ks: string[]) {
      ks.forEach((k) => left.delete(k));
      return ks.length;
    },
    async keys(pattern: string) {
      return [...left].filter((k) => glob(pattern).test(k));
    },
  };
}

describe('IPO invalidation covers every reader cache holding IPO rows', () => {
  it('names the history, listings, fuzzy and scraper-lock keys', () => {
    const keys = getIPOInvalidationKeys('ipo-1', 'acme-ltd');
    expect(keys).toEqual(
      expect.arrayContaining(['ipos:history:*', 'ipo:listings:*', 'ipo:fuzzy:*', 'protection:ipo_locked:ipo-1'])
    );
  });

  it('deletes those keys from a real-shaped key space and leaves unrelated keys', async () => {
    const redis = fakeRedis([
      'ipos:history:2026:all:all:listingDate:desc:1:20',
      'ipo:listings:MAINBOARD:2026:1',
      'ipo:fuzzy:9f3a',
      'protection:ipo_locked:ipo-1',
      'protection:ipo_locked:ipo-2',
      'registrar:42',
    ]);
    await invalidateIPOCaches(redis, 'ipo-1', 'acme-ltd');
    expect([...redis.left].sort()).toEqual(['protection:ipo_locked:ipo-2', 'registrar:42']);
  });
});
