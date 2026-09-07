/**
 * Search Configuration
 * ISS-027: Fuzzy matching and search fallback settings
 *
 * Centralized configuration for fuzzy matching, fallback behavior,
 * and search suggestions across the application.
 */

/**
 * Fuzzy Matching Configuration
 */
export const FUZZY_MATCH_CONFIG = {
  /**
   * Enable fuzzy matching for slug lookups
   * When true, failed exact slug matches will fallback to fuzzy search
   */
  enabled: true,

  /**
   * #350 round 2 (T-485): this value is passed DIRECTLY as Fuse.js's own
   * `threshold` option by web/app/api/search/route.ts:170 — Fuse's native
   * scale, where LOWER is STRICTER (0 = exact match, 1 = matches anything).
   * It is NOT a "similarity" fraction despite the field name. Do NOT raise
   * this to make search results stricter — that LOOSENS the live search bar.
   * findBySlugWithFallback's own strict floor lives in a SEPARATE constant
   * (SLUG_FALLBACK_MIN_SIMILARITY below) on the opposite scale (higher =
   * stricter) precisely so the two call sites can never be coupled again —
   * sharing this value previously caused raising the slug-fallback floor to
   * silently loosen /api/search's live threshold (round 1 defect, T-485).
   *
   * 0.6 is /api/search's long-standing production value — unchanged by #350.
   */
  similarityThreshold: 0.6,

  /**
   * Maximum number of fuzzy search results to return
   */
  maxResults: 10,

  /**
   * Field weights for fuzzy matching
   * Higher weight = more important in matching
   */
  fieldWeights: {
    companyName: 0.7, // 70% weight
    slug: 0.3, // 30% weight
  },
} as const;

/**
 * #350 round 2 (T-485): the minimum SIMILARITY (0.0 to 1.0, HIGHER is
 * STRICTER — the opposite scale from FUZZY_MATCH_CONFIG.similarityThreshold
 * above, which is a raw Fuse `threshold` where lower is stricter) required
 * for IPORepository.findBySlugWithFallback's fuzzy step to accept a match.
 * Deliberately its OWN constant, consumed ONLY by findBySlugWithFallback —
 * never share this with /api/search's Fuse `threshold` again; that coupling
 * is exactly what caused round 1's defect (raising the slug-fallback floor
 * silently loosened the live search bar).
 *
 * Evidence (#350): the false-match pair 'karamtara-engineering-ltd' /
 * 'Sumax Engineering Ltd.' scores 0.4401 (56% similarity) — must be
 * rejected. A genuine one-character-typo pair scores 0.1485 (85%
 * similarity) — must pass. 0.85 sits strictly between the two, with >2x
 * margin on the passing side.
 */
export const SLUG_FALLBACK_MIN_SIMILARITY = 0.85;

/**
 * Fallback Configuration
 */
export const FALLBACK_CONFIG = {
  /**
   * Enable fallback to fuzzy matching when exact match fails
   */
  enabled: true,

  /**
   * Cache fuzzy match results
   */
  cacheResults: true,

  /**
   * Cache TTL for fuzzy results (seconds)
   */
  cacheTTL: 300, // 5 minutes
} as const;

/**
 * Suggestions Configuration
 */
export const SUGGESTIONS_CONFIG = {
  /**
   * Enable search suggestions on 404 responses
   */
  enabled: true,

  /**
   * Maximum number of suggestions to return
   */
  maxSuggestions: 5,

  /**
   * Minimum similarity score for suggestions (0.0 to 1.0)
   * Lower than fuzzy match threshold to provide more alternatives
   */
  minSimilarity: 0.3,
} as const;

/**
 * Combined search configuration
 */
export const SEARCH_CONFIG = {
  fuzzyMatch: FUZZY_MATCH_CONFIG,
  fallback: FALLBACK_CONFIG,
  suggestions: SUGGESTIONS_CONFIG,
} as const;

/**
 * Type-safe access to configuration values
 */
export type SearchConfig = typeof SEARCH_CONFIG;
export type FuzzyMatchConfig = typeof FUZZY_MATCH_CONFIG;
export type FallbackConfig = typeof FALLBACK_CONFIG;
export type SuggestionsConfig = typeof SUGGESTIONS_CONFIG;
