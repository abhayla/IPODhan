/**
 * T-403 Tier-A review (items 1 and 5) — direct coverage for the prefix-name
 * matching primitives that `resolveIpoRow` tier 3b (W-108) relies on but
 * that previously had no direct test:
 *
 *   - `isWordBoundaryPrefixMatch` / `classifyPrefixBoundary` (item 1, HIGH):
 *     the pure boundary classifier — punctuation vs whitespace vs no
 *     relationship at all.
 *   - `findByNormalizedNamePrefix` (item 5, LOW): the 200-row LIKE
 *     pre-filter and the 5-candidate cap must DECLINE (return []) on
 *     overflow rather than silently truncating, since a silent truncation
 *     can turn "two candidates, decline (ambiguous)" into "one candidate,
 *     accept".
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape),
 * matching the pattern in `subscription-repository.test.ts` — no Postgres.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository, isWordBoundaryPrefixMatch, classifyPrefixBoundary } from './ipo-repository';

describe('classifyPrefixBoundary / isWordBoundaryPrefixMatch (W-108 tier 3b boundary classifier)', () => {
  it('matches at a punctuation boundary — "rays of belief" is a prefix of the hyphenated suffix variant', () => {
    expect(
      isWordBoundaryPrefixMatch('rays of belief', 'rays of belief- for profit social enterprise')
    ).toBe(true);
    expect(
      classifyPrefixBoundary('rays of belief', 'rays of belief- for profit social enterprise')
    ).toBe('punctuation');
  });

  it('does NOT match mid-word — "ray" is not a prefix of "rays of belief" at any boundary', () => {
    expect(isWordBoundaryPrefixMatch('ray', 'rays of belief')).toBe(false);
    expect(classifyPrefixBoundary('ray', 'rays of belief')).toBeNull();
  });

  it('does NOT match when the names diverge — "rays of belief" vs "rays of hope"', () => {
    expect(isWordBoundaryPrefixMatch('rays of belief', 'rays of hope')).toBe(false);
    expect(classifyPrefixBoundary('rays of belief', 'rays of hope')).toBeNull();
  });

  it('exact-equal names match', () => {
    expect(isWordBoundaryPrefixMatch('rays of belief', 'rays of belief')).toBe(true);
    expect(classifyPrefixBoundary('rays of belief', 'rays of belief')).toBe('exact');
  });

  // T-403 item 2: a WHITESPACE-separated extension ("Rays of Belief Limited
  // Holdings" reads as a different legal entity, not the same company under
  // a longer name) is deliberately NOT a punctuation/exact boundary match —
  // isWordBoundaryPrefixMatch is the single-corroborating-key-eligible
  // signal, and whitespace extensions no longer qualify for it.
  it('(item 2) does NOT match at a bare whitespace boundary — "rays of belief" vs "rays of belief limited holdings"', () => {
    expect(isWordBoundaryPrefixMatch('rays of belief', 'rays of belief limited holdings')).toBe(false);
    expect(classifyPrefixBoundary('rays of belief', 'rays of belief limited holdings')).toBe('whitespace');
  });

  it('handles empty strings safely', () => {
    expect(isWordBoundaryPrefixMatch('', 'rays of belief')).toBe(false);
    expect(isWordBoundaryPrefixMatch('rays of belief', '')).toBe(false);
    expect(classifyPrefixBoundary('', '')).toBeNull();
  });
});

function makeDb(selectResult: any[]) {
  const db: any = {
    select: vi.fn(() => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(selectResult),
      };
      return chain;
    }),
  };
  return db;
}

function makeRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  } as any;
}

function makeCandidate(id: string, companyName: string): any {
  return { id, companyName, slug: id, openDate: null, priceRangeMin: null, segment: null };
}

describe('IPORepository.findByNormalizedNamePrefix (item 5 — overflow declines, never truncates)', () => {
  it('declines (returns []) when the 200-row LIKE pre-filter overflows to 201 rows', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => makeCandidate(`row-${i}`, `Rays of Belief ${i}`));
    const repo = new IPORepository(makeDb(rows), makeRedis());

    const result = await repo.findByNormalizedNamePrefix('rays of belief');

    expect(result).toEqual([]);
  });

  it('returns up to 5 matching candidates when 5 or fewer prefix-boundary rows exist', async () => {
    const rows = [
      makeCandidate('row-1', 'Rays of Belief Limited- Branch A'),
      makeCandidate('row-2', 'Rays of Belief Limited- Branch B'),
    ];
    const repo = new IPORepository(makeDb(rows), makeRedis());

    const result = await repo.findByNormalizedNamePrefix('rays of belief');

    expect(result.map((r) => r.id)).toEqual(['row-1', 'row-2']);
  });

  it('declines (returns []) rather than truncating to 5 when a 6th prefix-boundary candidate exists', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      makeCandidate(`row-${i}`, `Rays of Belief Limited- Branch ${i}`)
    );
    const repo = new IPORepository(makeDb(rows), makeRedis());

    const result = await repo.findByNormalizedNamePrefix('rays of belief');

    expect(result).toEqual([]);
  });
});
