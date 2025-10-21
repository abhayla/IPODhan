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
   * Minimum similarity score required for a match (0.0 to 1.0)
   * Higher values = stricter matching (more similar required)
   * Lower values = looser matching (less similar accepted)
   *
   * Examples:
   * - 0.8 = Very strict (80%+ similarity required)
   * - 0.6 = Balanced (60%+ similarity required) - DEFAULT
   * - 0.4 = Loose (40%+ similarity required)
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
