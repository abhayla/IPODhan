/**
 * Duplicate Detection Service
 *
 * Prevents creating duplicate IPO records by checking against:
 * 1. Company name (fuzzy matching)
 * 2. NSE symbol (exact match)
 * 3. BSE code (exact match)
 * 4. ISIN (exact match)
 * 5. Date overlap (same company, overlapping dates)
 *
 * Discovered Issue (Phase 2): VIP Industries was added as IPO despite
 * being listed since 1968. This service prevents such errors.
 *
 * Usage:
 * ```typescript
 * const duplicateService = new DuplicateDetectionService(db);
 * const result = await duplicateService.checkForDuplicates({
 *   companyName: 'VIP Industries Ltd',
 *   nseSymbol: 'VIPIND'
 * });
 *
 * if (result.isDuplicate) {
 *   console.error('Duplicate detected:', result.matchReason);
 *   // Skip creating this IPO
 * }
 * ```
 *
 * @module scraper/services/duplicate-detection-service
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, or, and, like, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import type { IPO } from '@ipodhan/shared/db/types';
import { normalizeCompanyName } from '@ipodhan/shared/utils/slug';

export interface DuplicateCheckInput {
  companyName: string;
  symbol?: string | null;  // NSE/BSE stock symbol
  isin?: string | null;
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchReason: string;
  existingIPO?: IPO;
  matchType?: 'EXACT_SYMBOL' | 'EXACT_ISIN' | 'FUZZY_NAME' | 'DATE_OVERLAP';
}

/**
 * Duplicate Detection Service
 * Checks for existing IPO records before creating new ones
 */
export class DuplicateDetectionService {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Check if an IPO already exists in the database
   * Performs multiple checks with different confidence levels
   */
  async checkForDuplicates(
    input: DuplicateCheckInput
  ): Promise<DuplicateCheckResult> {
    // Check 1: Exact stock symbol match (HIGHEST confidence)
    if (input.symbol) {
      const symbolMatch = await this.checkSymbol(input.symbol);
      if (symbolMatch) {
        return {
          isDuplicate: true,
          confidence: 'HIGH',
          matchReason: `Stock symbol "${input.symbol}" already exists. This company is likely already listed.`,
          existingIPO: symbolMatch,
          matchType: 'EXACT_SYMBOL',
        };
      }
    }

    // Check 2: Exact ISIN match (HIGH confidence)
    if (input.isin) {
      const isinMatch = await this.checkISIN(input.isin);
      if (isinMatch) {
        return {
          isDuplicate: true,
          confidence: 'HIGH',
          matchReason: `ISIN "${input.isin}" already exists. Duplicate IPO record.`,
          existingIPO: isinMatch,
          matchType: 'EXACT_ISIN',
        };
      }
    }

    // Check 3: Fuzzy company name match (MEDIUM confidence)
    const nameMatch = await this.checkCompanyName(input.companyName);
    if (nameMatch) {
      return {
        isDuplicate: true,
        confidence: 'MEDIUM',
        matchReason: `Company name "${input.companyName}" closely matches existing IPO: "${nameMatch.companyName}".`,
        existingIPO: nameMatch,
        matchType: 'FUZZY_NAME',
      };
    }

    // Check 5: Date overlap (MEDIUM confidence)
    if (input.openDate && input.closeDate) {
      const dateMatch = await this.checkDateOverlap(
        input.companyName,
        input.openDate,
        input.closeDate
      );
      if (dateMatch) {
        return {
          isDuplicate: true,
          confidence: 'MEDIUM',
          matchReason: `Company "${input.companyName}" has overlapping IPO dates with existing record.`,
          existingIPO: dateMatch,
          matchType: 'DATE_OVERLAP',
        };
      }
    }

    // No duplicates found
    return {
      isDuplicate: false,
      confidence: 'LOW',
      matchReason: 'No duplicates detected. Safe to create.',
    };
  }

  /**
   * Check if stock symbol exists
   */
  private async checkSymbol(symbol: string): Promise<IPO | null> {
    const results = await this.db
      .select()
      .from(schema.ipos)
      .where(eq(schema.ipos.symbol, symbol))
      .limit(1);

    return results[0] || null;
  }

  /**
   * Check if ISIN exists
   */
  private async checkISIN(isin: string): Promise<IPO | null> {
    const results = await this.db
      .select()
      .from(schema.ipos)
      .where(eq(schema.ipos.isin, isin))
      .limit(1);

    return results[0] || null;
  }

  /**
   * Check for similar company names (fuzzy matching)
   * Uses normalized company name comparison
   */
  private async checkCompanyName(companyName: string): Promise<IPO | null> {
    const normalized = normalizeCompanyName(companyName);

    // Get all IPOs with similar names (rough filter)
    const candidates = await this.db
      .select()
      .from(schema.ipos)
      .where(
        or(
          like(schema.ipos.companyName, `%${companyName.substring(0, 10)}%`),
          like(schema.ipos.slug, `%${normalized.substring(0, 15)}%`)
        )
      )
      .limit(20);

    // Calculate similarity scores
    for (const candidate of candidates) {
      const candidateNormalized = normalizeCompanyName(candidate.companyName);
      const similarity = this.calculateSimilarity(normalized, candidateNormalized);

      // If > 85% similar, consider it a duplicate
      if (similarity > 0.85) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Check for date overlap with same company
   */
  private async checkDateOverlap(
    companyName: string,
    openDate: Date | string,
    closeDate: Date | string
  ): Promise<IPO | null> {
    const normalized = normalizeCompanyName(companyName);
    const open = new Date(openDate);
    const close = new Date(closeDate);

    // Find IPOs with similar names
    const candidates = await this.db
      .select()
      .from(schema.ipos)
      .where(like(schema.ipos.companyName, `%${companyName.substring(0, 10)}%`))
      .limit(10);

    // Check for date overlap
    for (const candidate of candidates) {
      const candidateNormalized = normalizeCompanyName(candidate.companyName);
      const nameSimilarity = this.calculateSimilarity(normalized, candidateNormalized);

      // If names are similar (> 80%) AND dates overlap
      if (nameSimilarity > 0.8) {
        if (candidate.openDate && candidate.closeDate) {
          const candidateOpen = new Date(candidate.openDate);
          const candidateClose = new Date(candidate.closeDate);

          // Check for overlap: (open <= candidateClose) AND (close >= candidateOpen)
          if (open <= candidateClose && close >= candidateOpen) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate Levenshtein distance similarity (0-1)
   * Returns 1.0 for identical strings, 0.0 for completely different
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
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
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

    return matrix[str1.length][str2.length];
  }

  /**
   * Batch check multiple IPOs for duplicates
   * Returns array of results
   */
  async batchCheckDuplicates(
    inputs: DuplicateCheckInput[]
  ): Promise<DuplicateCheckResult[]> {
    const results: DuplicateCheckResult[] = [];

    for (const input of inputs) {
      const result = await this.checkForDuplicates(input);
      results.push(result);
    }

    return results;
  }

  /**
   * Get statistics on duplicate detection results
   */
  getDuplicateStatistics(results: DuplicateCheckResult[]): {
    totalChecked: number;
    duplicatesFound: number;
    byConfidence: {
      HIGH: number;
      MEDIUM: number;
      LOW: number;
    };
    byMatchType: {
      EXACT_SYMBOL?: number;
      EXACT_ISIN?: number;
      FUZZY_NAME?: number;
      DATE_OVERLAP?: number;
    };
  } {
    const duplicates = results.filter(r => r.isDuplicate);

    const byConfidence = {
      HIGH: duplicates.filter(r => r.confidence === 'HIGH').length,
      MEDIUM: duplicates.filter(r => r.confidence === 'MEDIUM').length,
      LOW: duplicates.filter(r => r.confidence === 'LOW').length,
    };

    const byMatchType: Record<string, number> = {};
    for (const dup of duplicates) {
      if (dup.matchType) {
        byMatchType[dup.matchType] = (byMatchType[dup.matchType] || 0) + 1;
      }
    }

    return {
      totalChecked: results.length,
      duplicatesFound: duplicates.length,
      byConfidence,
      byMatchType,
    };
  }
}
