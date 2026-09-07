/**
 * #350 round 2 (T-485): pins /api/search's live Fuse.js threshold so the
 * two similarity scales (this route's raw Fuse `threshold`, lower=stricter,
 * vs findBySlugWithFallback's SLUG_FALLBACK_MIN_SIMILARITY, higher=stricter)
 * can never be coupled again the way they were in round 1 — raising the
 * slug-fallback floor (0.6 -> 0.85) silently loosened this route's live
 * search-bar threshold because both read the same FUZZY_MATCH_CONFIG value.
 *
 * Two checks, both load-bearing:
 * 1. The route still wires Fuse's `threshold` from
 *    SEARCH_CONFIG.fuzzyMatch.similarityThreshold (not some other/new key) —
 *    a source-text assertion, since the route module itself needs a live DB
 *    connection to import.
 * 2. That config value is still 0.6, the prior production value.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SEARCH_CONFIG, SLUG_FALLBACK_MIN_SIMILARITY } from '@/lib/config/search';

describe('#350 round 2 — /api/search Fuse threshold pin', () => {
  it('wires Fuse threshold from SEARCH_CONFIG.fuzzyMatch.similarityThreshold', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'app/api/search/route.ts'),
      'utf-8'
    );

    expect(routeSource).toMatch(
      /threshold:\s*SEARCH_CONFIG\.fuzzyMatch\.similarityThreshold/
    );
  });

  it('SEARCH_CONFIG.fuzzyMatch.similarityThreshold is still 0.6 (the prior production value)', () => {
    expect(SEARCH_CONFIG.fuzzyMatch.similarityThreshold).toBe(0.6);
  });

  it('SLUG_FALLBACK_MIN_SIMILARITY is a distinct constant from the search-route threshold (never re-coupled)', () => {
    expect(SLUG_FALLBACK_MIN_SIMILARITY).not.toBe(SEARCH_CONFIG.fuzzyMatch.similarityThreshold);
    expect(SLUG_FALLBACK_MIN_SIMILARITY).toBe(0.85);
  });
});
