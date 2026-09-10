/**
 * Item 21 slice 2b — `redis.del` matches key names LITERALLY. Handing it a glob
 * deletes a key nobody creates and returns 0.
 *
 * Two admin write paths did exactly that (#538):
 *
 *   web/app/api/admin/ipos/route.ts:270        await redis.del('ipo:list:*');
 *   web/app/api/admin/ipos/[id]/route.ts:299   await redis.del('ipo:list:*');
 *
 * The real keys are `ipo:list:<filterHash>` — one per filter combination,
 * written by `getIPOListKey` and read by `IPORepository.findAll()`. None of them
 * is named `ipo:list:*`, so every list cache survived an admin edit and served
 * the stale row for its full `CacheTTL.IPO_LIST = 900` seconds: the detail page
 * updated at once, and every list, calendar and listings page kept the old
 * number for up to fifteen more minutes, with no error and a `del` that
 * "succeeded".
 *
 * The FIRST test here is the class guard and it is deliberately a source scan,
 * not a behaviour test: it is the only shape that catches the NEXT call site,
 * including one added to a route that does not exist yet. The rest drive the
 * real invalidation helper.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getIPOInvalidationKeys, getIPOListKey } from '@/lib/cache/cache-keys';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';

const ADMIN_API_DIR = join(__dirname, '../../../../app/api/admin');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('the class: no glob is ever handed to a literal-match delete', () => {
  it('finds admin route files at all - a zero-file scan cannot fail', () => {
    expect(sourceFiles(ADMIN_API_DIR).length).toBeGreaterThan(5);
  });

  it('no admin route passes a string containing * to redis.del', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(ADMIN_API_DIR)) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const re = /redis\.del\(\s*['"`]([^'"`]*)['"`]\s*\)/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m[1].includes('*')) offenders.push(`${f.split(/[\/]/).slice(-3).join('/')}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** A fake Redis that behaves like the real one: DEL matches names literally. */
function fakeRedis(initial: string[]) {
  const store = new Set(initial);
  return {
    store,
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    keys: vi.fn(async (pattern: string) => {
      // Only the glob shape these fixtures use: ONE trailing or embedded '*'.
      // Written as prefix/suffix rather than a built regex because the point of
      // this file is that a pattern is not a key name - a fake that itself
      // mangles patterns would prove nothing.
      const star = pattern.indexOf('*');
      if (star === -1) return [...store].filter((k) => k === pattern);
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      return [...store].filter(
        (k) => k.length >= prefix.length + suffix.length && k.startsWith(prefix) && k.endsWith(suffix)
      );
    }),
  };
}

describe('invalidateIPOCaches actually clears the list caches', () => {
  const listKeyA = getIPOListKey({ segment: ['MAINBOARD'], page: 1 });
  const listKeyB = getIPOListKey({ segment: ['SME'], status: ['OPEN'] });

  it('the fixture keys are real ipo:list:<hash> keys, not invented ones', () => {
    // Guards the test itself: if getIPOListKey changed shape, the assertions
    // below would be checking something that no longer exists.
    expect(listKeyA).toMatch(/^ipo:list:.+/);
    expect(listKeyA).not.toBe(listKeyB);
  });

  it('clears every ipo:list:<hash> key - the bug this slice fixes', async () => {
    const redis = fakeRedis([listKeyA, listKeyB, 'ipo:id:abc', 'unrelated:key']);
    await invalidateIPOCaches(redis as never, 'abc', 'acme-ltd');
    expect(redis.store.has(listKeyA)).toBe(false);
    expect(redis.store.has(listKeyB)).toBe(false);
  });

  it('does NOT delete keys outside the IPO namespace', async () => {
    const redis = fakeRedis([listKeyA, 'unrelated:key', 'documents:xyz']);
    await invalidateIPOCaches(redis as never, 'abc', 'acme-ltd');
    expect(redis.store.has('unrelated:key')).toBe(true);
    expect(redis.store.has('documents:xyz')).toBe(true);
  });

  it('clears the exact-name keys too, not only the patterns', async () => {
    const redis = fakeRedis(['ipo:id:abc', 'ipo:slug:acme-ltd', listKeyA]);
    await invalidateIPOCaches(redis as never, 'abc', 'acme-ltd');
    expect(redis.store.size).toBe(0);
  });

  it('a mutation: the old glob-to-del behaviour would leave the list keys behind', async () => {
    // Reproduces the defect exactly, so the test proves the fix rather than
    // merely passing alongside it.
    const redis = fakeRedis([listKeyA, listKeyB]);
    await redis.del('ipo:list:*');
    expect(redis.store.has(listKeyA)).toBe(true);
    expect(redis.store.has(listKeyB)).toBe(true);
  });

  it('is not fatal when redis throws - an admin edit still succeeds', async () => {
    const redis = { del: vi.fn(async () => { throw new Error('down'); }),
                    keys: vi.fn(async () => { throw new Error('down'); }) };
    await expect(invalidateIPOCaches(redis as never, 'abc', 'acme-ltd')).resolves.not.toThrow();
  });

  it('works without a slug - the create path has no previous slug to clear', async () => {
    const redis = fakeRedis([listKeyA]);
    await invalidateIPOCaches(redis as never, 'abc');
    expect(redis.store.has(listKeyA)).toBe(false);
  });

  it('uses the shared pattern list rather than a second hand-typed copy', () => {
    const patterns = getIPOInvalidationKeys('abc', 'acme-ltd');
    expect(patterns).toContain('ipo:list:*');
    expect(patterns).toContain('ipo:search:*');
  });
});
