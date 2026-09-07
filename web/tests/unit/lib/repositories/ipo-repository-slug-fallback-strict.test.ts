/**
 * Unit tests for #350: findBySlugWithFallback must not resolve an unknown
 * slug to an unrelated IPO via loose fuzzy matching.
 *
 * Real evidence (2026-09-07, prod f9b67d0a): GET /api/ipos/karamtara-engineering-ltd
 * (no such row on prod at the time) matched 'Sumax Engineering Ltd.' purely
 * because both company names share the word "Engineering". Measured Fuse.js
 * score for that pair (companyName+slug weighted 0.7/0.3, real strings) is
 * 0.4401 (56% similarity) -- see PR body for the script. A genuine one-typo
 * near-match ('karamtara-engineerin-ltd' -> 'Karamtara Engineering Ltd.')
 * scores 0.1485 (85% similarity). The fix must reject the former and accept
 * matches at least as tight as the latter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type Redis from 'ioredis';

type Row = Record<string, unknown>;

/**
 * Builds a mock `db.select()` chain. Each call to `.select()` consumes the
 * next `{ rows }` step in order (matching the real call sequence emitted by
 * findBySlugWithFallback: exact match -> redirect live-guard -> redirect
 * join -> [redirect target exact match + its 12-query fan-out, if any] ->
 * all-IPOs fetch for normalized/fuzzy matching). Any call beyond the
 * supplied steps defaults to an empty result, which is exactly what the
 * unrelated related-table fan-out queries (financials, documents, ...)
 * need for a test that only asserts the resolved IPO.
 */
function buildMockDb(steps: Array<{ rows: Row[] }>) {
  let i = 0;
  const select = vi.fn(() => {
    const step = steps[i++] ?? { rows: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(step.rows));
    chain.then = (resolve: (v: Row[]) => void) => resolve(step.rows);
    return chain;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { select } as any;
}

function buildMockRedis(): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('IPORepository.findBySlugWithFallback — #350 strict fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT resolve karamtara-engineering-ltd to Sumax Engineering (shared-token false match, #350)', async () => {
    const allIPOs: Row[] = [
      { id: 'ipo-sumax', companyName: 'Sumax Engineering Ltd.', slug: 'sumax-engineering-ltd' },
    ];
    const db = buildMockDb([
      { rows: [] }, // 1. exact match on 'karamtara-engineering-ltd'
      { rows: [] }, // 2. redirect live-guard
      { rows: [] }, // 3. redirect table join
      { rows: allIPOs }, // 4. all-IPOs fetch (normalized name + fuzzy)
    ]);
    const repo = new IPORepository(db, buildMockRedis());

    const result = await repo.findBySlugWithFallback('karamtara-engineering-ltd');

    expect(result).toBeNull();
  });

  it('resolves a genuinely renamed IPO via the slug-redirect table', async () => {
    const targetRow: Row = {
      id: 'ipo-renamed',
      slug: 'company-current-slug',
      companyName: 'Renamed Company Ltd.',
      status: 'OPEN',
    };
    const db = buildMockDb([
      { rows: [] }, // 1. exact match on 'company-old-slug'
      { rows: [] }, // 2. redirect live-guard (old slug not live)
      { rows: [{ currentSlug: 'company-current-slug' }] }, // 3. redirect join finds a mapping
      { rows: [targetRow] }, // 4. findBySlug('company-current-slug') exact match hit
      // 5..16: the resolved IPO's related-table fan-out — default to [] (fine, unchecked)
    ]);
    const repo = new IPORepository(db, buildMockRedis());

    const result = await repo.findBySlugWithFallback('company-old-slug');

    expect(result).not.toBeNull();
    expect(result?.slug).toBe('company-current-slug');
    expect(result?.companyName).toBe('Renamed Company Ltd.');
  });

  it('resolves a one-character-typo slug to the real IPO via the strict similarity floor', async () => {
    const allIPOs: Row[] = [
      { id: 'ipo-karamtara', companyName: 'Karamtara Engineering Ltd.', slug: 'karamtara-engineering-ltd' },
      { id: 'ipo-sumax', companyName: 'Sumax Engineering Ltd.', slug: 'sumax-engineering-ltd' },
    ];
    const db = buildMockDb([
      { rows: [] }, // 1. exact match on the typo'd slug fails
      { rows: [] }, // 2. redirect live-guard
      { rows: [] }, // 3. redirect table join
      { rows: allIPOs }, // 4. all-IPOs fetch (normalized name fails -> fuzzy)
      { rows: [allIPOs[0]] }, // 5. findBySlug('karamtara-engineering-ltd') exact match hit
    ]);
    const repo = new IPORepository(db, buildMockRedis());

    const result = await repo.findBySlugWithFallback('karamtara-engineerin-ltd');

    expect(result).not.toBeNull();
    expect(result?.slug).toBe('karamtara-engineering-ltd');
  });

  it('returns null for a nonsense slug with no plausible match', async () => {
    const allIPOs: Row[] = [
      { id: 'ipo-a', companyName: 'Alpha Textiles Ltd.', slug: 'alpha-textiles-ltd' },
      { id: 'ipo-b', companyName: 'Beta Pharma Ltd.', slug: 'beta-pharma-ltd' },
    ];
    const db = buildMockDb([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: allIPOs },
    ]);
    const repo = new IPORepository(db, buildMockRedis());

    const result = await repo.findBySlugWithFallback('zzz-not-a-real-ipo');

    expect(result).toBeNull();
  });
});
