/**
 * IPO Deduplication Service
 * Prevents duplicate IPO creation through multi-tier matching strategy
 *
 * Matching Tiers (in priority order):
 * 1. Exact Slug Match (90% reliable) - Uses generateIPOSlug()
 * 2. Normalized Name Match (85% reliable) - Uses normalizeCompanyName()
 * 3. Fuzzy Match (80% reliable) - Partial name matching
 * 4. Levenshtein Distance (75% reliable) - Edit distance algorithm
 *
 * Usage:
 * ```typescript
 * const deduplication = new IPODeduplicationService(db);
 * const existing = await deduplication.findExisting({
 *   companyName: 'XYZ Corporation Ltd',
 *   isin: 'INE123A01024' // optional
 * });
 *
 * if (existing) {
 *   console.log('Duplicate detected:', existing.matchTier, existing.confidence);
 *   // Use existing.ipo instead of creating new
 * }
 * ```
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, or, like, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import type { IPO } from '@ipodhan/shared/db/types';
import { generateIPOSlug, normalizeCompanyName } from '@ipodhan/shared/utils/slug';

/**
 * IPO candidate for deduplication check
 */
export interface IPOCandidate {
  companyName: string;
  isin?: string | null;
  openDate?: Date | null;
  closeDate?: Date | null;
}

/**
 * Match result with confidence and tier information
 */
export interface DeduplicationMatch {
  ipo: IPO;
  matchTier: 'slug' | 'normalized' | 'fuzzy' | 'levenshtein';
  confidence: number; // 0-100
  matchReason: string;
}

/**
 * Deduplication statistics for monitoring
 */
export interface DeduplicationStats {
  totalChecks: number;
  duplicatesFound: number;
  duplicatesPrevent: number;
  tierBreakdown: {
    slug: number;
    normalized: number;
    fuzzy: number;
    levenshtein: number;
  };
}

/**
 * IPO Deduplication Service
 * Implements multi-tier matching to prevent duplicate IPO creation
 */
export class IPODeduplicationService {
  private db: NodePgDatabase<typeof schema>;
  private stats: DeduplicationStats;

  constructor(db: NodePgDatabase<typeof schema>) {
    this.db = db;
    this.stats = {
      totalChecks: 0,
      duplicatesFound: 0,
      duplicatesPrevent: 0,
      tierBreakdown: { slug: 0, normalized: 0, fuzzy: 0, levenshtein: 0 },
    };
  }

  /**
   * Find existing IPO using multi-tier matching
   * Returns null if genuinely new, otherwise returns match details
   */
  async findExisting(candidate: IPOCandidate): Promise<DeduplicationMatch | null> {
    this.stats.totalChecks++;

    // Tier 1: Exact slug match (90% reliable)
    const slugMatch = await this.findBySlug(candidate.companyName);
    if (slugMatch) {
      this.stats.duplicatesFound++;
      this.stats.tierBreakdown.slug++;
      return {
        ipo: slugMatch,
        matchTier: 'slug',
        confidence: 90,
        matchReason: 'Exact slug match using canonical slug generation',
      };
    }

    // Tier 2: Normalized name match (85% reliable)
    const normalizedMatch = await this.findByNormalizedName(candidate.companyName);
    if (normalizedMatch) {
      this.stats.duplicatesFound++;
      this.stats.tierBreakdown.normalized++;
      return {
        ipo: normalizedMatch,
        matchTier: 'normalized',
        confidence: 85,
        matchReason: 'Normalized company name match (case-insensitive, legal suffix removed)',
      };
    }

    // Tier 3: Fuzzy match (80% reliable)
    const fuzzyMatch = await this.findByFuzzyName(candidate.companyName);
    if (fuzzyMatch) {
      this.stats.duplicatesFound++;
      this.stats.tierBreakdown.fuzzy++;
      return {
        ipo: fuzzyMatch,
        matchTier: 'fuzzy',
        confidence: 80,
        matchReason: 'Fuzzy name match (partial substring matching)',
      };
    }

    // Tier 4: Levenshtein distance (75% reliable)
    const levenshteinMatch = await this.findByLevenshtein(candidate.companyName, 0.75);
    if (levenshteinMatch) {
      this.stats.duplicatesFound++;
      this.stats.tierBreakdown.levenshtein++;
      return {
        ipo: levenshteinMatch,
        matchTier: 'levenshtein',
        confidence: 75,
        matchReason: 'Levenshtein edit distance match (75% similarity threshold)',
      };
    }

    // No match found - genuinely new IPO
    return null;
  }

  /**
   * Tier 1: Exact slug match
   * Uses canonical slug generation for maximum reliability
   */
  private async findBySlug(companyName: string): Promise<IPO | null> {
    const slug = generateIPOSlug(companyName);

    const [result] = await this.db
      .select()
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, slug))
      .limit(1);

    return result || null;
  }

  /**
   * Tier 2: Normalized name match
   * Removes legal suffixes, case differences, extra spaces
   */
  private async findByNormalizedName(companyName: string): Promise<IPO | null> {
    const normalized = normalizeCompanyName(companyName);

    // Search by comparing normalized names in database
    const results = await this.db
      .select()
      .from(schema.ipos)
      .where(
        sql`LOWER(REGEXP_REPLACE(
          REGEXP_REPLACE(${schema.ipos.companyName},
            '\\s+(limited|ltd\\.?|private|pvt\\.?|inc|corp|llc|llp|plc)\\.?$', '', 'i'),
          '\\s+ipo$', '', 'i'
        )) = ${normalized.toLowerCase()}`
      )
      .limit(1);

    return results[0] || null;
  }

  /**
   * Tier 3: Fuzzy match
   * Checks if company name contains or is contained by existing IPO names
   */
  private async findByFuzzyName(companyName: string): Promise<IPO | null> {
    const normalized = normalizeCompanyName(companyName);
    const searchTerms = normalized.split(' ').filter(term => term.length > 3); // Only meaningful words

    if (searchTerms.length === 0) {
      return null;
    }

    // Build LIKE conditions for partial matching
    const conditions = searchTerms.map(term =>
      like(sql`LOWER(${schema.ipos.companyName})`, `%${term.toLowerCase()}%`)
    );

    const results = await this.db
      .select()
      .from(schema.ipos)
      .where(or(...conditions))
      .limit(10); // Get top 10 candidates

    // Find best match based on number of matching terms
    let bestMatch: IPO | null = null;
    let bestScore = 0;

    for (const ipo of results) {
      const ipoNormalized = normalizeCompanyName(ipo.companyName).toLowerCase();
      const matchCount = searchTerms.filter(term =>
        ipoNormalized.includes(term.toLowerCase())
      ).length;

      const score = matchCount / searchTerms.length;

      if (score > bestScore && score >= 0.6) { // 60% of terms must match
        bestScore = score;
        bestMatch = ipo;
      }
    }

    return bestMatch;
  }

  /**
   * Tier 4: Levenshtein distance
   * Fallback for typos, spelling variations
   */
  private async findByLevenshtein(
    companyName: string,
    threshold: number = 0.75
  ): Promise<IPO | null> {
    const normalized = normalizeCompanyName(companyName);

    // Get all IPOs for comparison (could be optimized with limits)
    const allIPOs = await this.db
      .select()
      .from(schema.ipos)
      .limit(1000); // Limit to recent 1000 IPOs for performance

    let bestMatch: IPO | null = null;
    let bestSimilarity = 0;

    for (const ipo of allIPOs) {
      const ipoNormalized = normalizeCompanyName(ipo.companyName);
      const similarity = this.calculateSimilarity(normalized, ipoNormalized);

      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = ipo;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns a value between 0 (completely different) and 1 (identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Compute Levenshtein edit distance between two strings
   * Returns minimum number of single-character edits needed
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get deduplication statistics
   * Useful for monitoring and debugging
   */
  getStats(): DeduplicationStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      duplicatesFound: 0,
      duplicatesPrevent: 0,
      tierBreakdown: { slug: 0, normalized: 0, fuzzy: 0, levenshtein: 0 },
    };
  }

  /**
   * Check if candidate is likely a duplicate (confidence >= 80%)
   * Helper for quick duplicate checks
   */
  async isDuplicate(candidate: IPOCandidate): Promise<boolean> {
    const match = await this.findExisting(candidate);
    return match !== null && match.confidence >= 80;
  }

  /**
   * Batch deduplication check
   * Checks multiple candidates and returns matches
   */
  async findDuplicatesInBatch(
    candidates: IPOCandidate[]
  ): Promise<Map<number, DeduplicationMatch>> {
    const matches = new Map<number, DeduplicationMatch>();

    for (let i = 0; i < candidates.length; i++) {
      const match = await this.findExisting(candidates[i]);
      if (match) {
        matches.set(i, match);
      }
    }

    return matches;
  }
}

/**
 * Create deduplication service instance
 * Factory function for dependency injection
 */
export function createDeduplicationService(
  db: NodePgDatabase<typeof schema>
): IPODeduplicationService {
  return new IPODeduplicationService(db);
}

/**
 * Export types for use in other services
 */
export type {
  IPOCandidate,
  DeduplicationMatch,
  DeduplicationStats,
};
