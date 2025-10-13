/**
 * Prospectus Documents Scraper
 *
 * Scrapes IPO prospectus document metadata from NSE and BSE
 *
 * Sources:
 * - NSE: https://www.nseindia.com/market-data/upcoming-ipo
 * - BSE: https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx
 *
 * Features:
 * - Scrapes document metadata (DRHP, RHP, Prospectus, Addendum)
 * - Validates document URLs before storing
 * - Fuzzy matches documents to existing IPOs (85% similarity threshold)
 * - Handles deduplication across exchanges
 * - Stores with proper upsert logic
 *
 * Story: 7.9 - Prospectus Documents Scraper Implementation
 */

import { BaseScraper, type ScraperResult } from '../base-scraper';
import { cleanText, parseDate } from '../utils/parser';
import { db } from '@/lib/db';
import { documents, ipos } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { distance } from 'fastest-levenshtein';
import { z } from 'zod';

// ==================== INTERFACES ====================

export interface ProspectusDocument {
  ipoName: string;
  documentType: 'DRHP' | 'RHP' | 'PROSPECTUS' | 'ADDENDUM';
  title: string;
  url: string;
  fileSize: number | null;
  uploadedAt: Date | null;
  exchange: 'NSE' | 'BSE';
}

export interface MatchedDocument extends ProspectusDocument {
  ipoId: string | null;
  matchScore: number;
}

interface ValidationResult {
  valid: boolean;
  fileSize?: number;
  error?: string;
}

// ==================== ZOD VALIDATION ====================

const ProspectusDocumentSchema = z.object({
  ipoName: z.string().min(1),
  documentType: z.enum(['DRHP', 'RHP', 'PROSPECTUS', 'ADDENDUM']),
  title: z.string().min(1),
  url: z.string().url(),
  fileSize: z.number().positive().nullable(),
  uploadedAt: z.date().nullable(),
  exchange: z.enum(['NSE', 'BSE']),
});

// ==================== SCRAPER CLASS ====================

export class ProspectusScraper extends BaseScraper<MatchedDocument[]> {
  constructor() {
    super({
      name: 'ProspectusScraper',
      baseUrl: 'https://www.nseindia.com',
      rateLimit: 1, // 1 request per second
      timeout: 30000,
      retries: 3,
    });
  }

  /**
   * Main scrape method - orchestrates entire scraping workflow
   * AC: 11, 12
   */
  async scrape(): Promise<ScraperResult<MatchedDocument[]>> {
    const startTime = Date.now();

    try {
      this.logStart('Starting prospectus documents scraper');

      // Step 1: Scrape both sources in parallel (AC: 1, 2, 3)
      this.log('Scraping NSE and BSE in parallel...');
      const [nseDocuments, bseDocuments] = await Promise.all([
        this.scrapeNSE(),
        this.scrapeBSE(),
      ]);

      this.log(`NSE: ${nseDocuments.length} documents, BSE: ${bseDocuments.length} documents`);

      // Step 2: Merge and deduplicate
      const allDocuments = this.mergeDocuments(nseDocuments, bseDocuments);
      this.log(`Total documents after merge: ${allDocuments.length}`);

      // Step 3: Validate all documents (AC: 4, 5, 9)
      this.log('Validating document URLs...');
      const validatedDocuments = await this.validateDocuments(allDocuments);
      this.log(`Validated ${validatedDocuments.length}/${allDocuments.length} documents`);

      // Step 4: Match to IPOs (AC: 6)
      this.log('Matching documents to IPOs...');
      const matchedDocuments = await this.matchAllDocuments(validatedDocuments);
      const matchedCount = matchedDocuments.filter((d) => d.ipoId).length;
      this.log(`Matched ${matchedCount}/${matchedDocuments.length} documents to IPOs`);

      // Step 5: Store in database (AC: 7, 8)
      this.log('Storing documents in database...');
      await this.storeDocuments(matchedDocuments);

      const duration = Date.now() - startTime;
      this.logComplete(matchedDocuments.length);
      this.log(`Total execution time: ${(duration / 1000).toFixed(2)}s`);

      return this.createSuccessResult(matchedDocuments);
    } catch (error) {
      this.logError(error as Error);
      return this.createErrorResult(error as Error);
    }
  }

  // ==================== NSE SCRAPING (AC: 1, 3) ====================

  /**
   * Scrape prospectus documents from NSE
   * URL: https://www.nseindia.com/market-data/upcoming-ipo
   */
  private async scrapeNSE(): Promise<ProspectusDocument[]> {
    try {
      const url = 'https://www.nseindia.com/market-data/upcoming-ipo';
      const $ = await this.fetchHTML(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const documents: ProspectusDocument[] = [];

      // NSE typically has a table with IPO listings
      // Each row contains company name and document links
      $('table tr').each((_, row) => {
        try {
          const $row = $(row);

          // Skip header rows
          if ($row.find('th').length > 0) return;

          // Extract company name from first column
          const ipoName = cleanText($row.find('td').eq(0).text());
          if (!ipoName) return;

          // Look for document links in remaining columns
          $row.find('a').each((_, link) => {
            const $link = $(link);
            const linkText = cleanText($link.text()).toUpperCase();
            const href = $link.attr('href');

            if (!href) return;

            // Determine document type from link text
            let documentType: ProspectusDocument['documentType'] | null = null;
            if (linkText.includes('DRHP')) documentType = 'DRHP';
            else if (linkText.includes('RHP')) documentType = 'RHP';
            else if (linkText.includes('PROSPECTUS')) documentType = 'PROSPECTUS';
            else if (linkText.includes('ADDENDUM')) documentType = 'ADDENDUM';

            if (!documentType) return;

            // Convert relative URLs to absolute
            const absoluteUrl = href.startsWith('http')
              ? href
              : href.startsWith('/')
              ? `https://www.nseindia.com${href}`
              : `https://www.nseindia.com/${href}`;

            // Validate with Zod schema
            const document = this.validateDocument({
              ipoName,
              documentType,
              title: `${ipoName} - ${documentType}`,
              url: absoluteUrl,
              fileSize: null,
              uploadedAt: null,
              exchange: 'NSE',
            });

            if (document) {
              documents.push(document);
            }
          });
        } catch (error) {
          this.logError(`Failed to parse NSE row: ${error}`);
        }
      });

      return documents;
    } catch (error) {
      this.logError(`NSE scraping failed: ${error}`);
      return [];
    }
  }

  // ==================== BSE SCRAPING (AC: 2, 3) ====================

  /**
   * Scrape prospectus documents from BSE
   * URL: https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx
   */
  private async scrapeBSE(): Promise<ProspectusDocument[]> {
    try {
      const url = 'https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx';
      const $ = await this.fetchHTML(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const documents: ProspectusDocument[] = [];

      // BSE has a table with IPO listings
      $('table tr').each((_, row) => {
        try {
          const $row = $(row);

          // Skip header rows
          if ($row.find('th').length > 0) return;

          // Extract company name
          const ipoName = cleanText($row.find('td').eq(0).text());
          if (!ipoName) return;

          // Look for document links
          $row.find('a').each((_, link) => {
            const $link = $(link);
            const linkText = cleanText($link.text()).toUpperCase();
            const href = $link.attr('href');

            if (!href) return;

            // Determine document type
            let documentType: ProspectusDocument['documentType'] | null = null;
            if (linkText.includes('DRHP') || href.includes('DRHP')) documentType = 'DRHP';
            else if (linkText.includes('RHP') || href.includes('RHP')) documentType = 'RHP';
            else if (linkText.includes('PROSPECTUS') || href.includes('PROSPECTUS'))
              documentType = 'PROSPECTUS';
            else if (linkText.includes('ADDENDUM') || href.includes('ADDENDUM'))
              documentType = 'ADDENDUM';

            if (!documentType) return;

            // Convert relative URLs to absolute
            const absoluteUrl = href.startsWith('http')
              ? href
              : href.startsWith('/')
              ? `https://www.bseindia.com${href}`
              : `https://www.bseindia.com/${href}`;

            // Validate with Zod schema
            const document = this.validateDocument({
              ipoName,
              documentType,
              title: `${ipoName} - ${documentType}`,
              url: absoluteUrl,
              fileSize: null,
              uploadedAt: null,
              exchange: 'BSE',
            });

            if (document) {
              documents.push(document);
            }
          });
        } catch (error) {
          this.logError(`Failed to parse BSE row: ${error}`);
        }
      });

      return documents;
    } catch (error) {
      this.logError(`BSE scraping failed: ${error}`);
      return [];
    }
  }

  // ==================== VALIDATION (AC: 4, 5, 9, 10) ====================

  /**
   * Validate document with Zod schema
   * AC: 10
   */
  private validateDocument(doc: unknown): ProspectusDocument | null {
    const result = ProspectusDocumentSchema.safeParse(doc);
    if (!result.success) {
      this.logError(`Validation failed: ${JSON.stringify(result.error.errors)}`);
      return null;
    }
    return result.data;
  }

  /**
   * Validate document URL using HTTP HEAD request
   * AC: 4, 5
   */
  private async validateDocumentUrl(url: string): Promise<ValidationResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'IPODhan/1.0' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { valid: false, error: `HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/pdf')) {
        return { valid: false, error: 'Not a PDF' };
      }

      const contentLength = response.headers.get('content-length');
      const fileSize = contentLength ? parseInt(contentLength) : undefined;

      return { valid: true, fileSize };
    } catch (error: any) {
      return { valid: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Validate with retry logic
   * AC: 9
   */
  private async validateWithRetry(url: string, maxRetries = 2): Promise<ValidationResult> {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      this.log(`Validating URL (attempt ${attempt}/${maxRetries + 1}): ${url}`);

      const result = await this.validateDocumentUrl(url);

      if (result.valid) {
        return result;
      }

      // If this wasn't the last attempt, wait before retrying
      if (attempt < maxRetries + 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second delay
      }
    }

    return { valid: false, error: 'Max retries exceeded' };
  }

  /**
   * Batch validate documents
   * Process in parallel batches of 5
   */
  private async validateDocuments(docs: ProspectusDocument[]): Promise<ProspectusDocument[]> {
    const validatedDocs: ProspectusDocument[] = [];
    const batchSize = 5;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (doc) => {
          const validation = await this.validateWithRetry(doc.url);
          if (validation.valid) {
            return { ...doc, fileSize: validation.fileSize || null };
          }
          this.logError(`Invalid document URL: ${doc.url} - ${validation.error}`);
          return null;
        })
      );

      validatedDocs.push(...results.filter((doc): doc is ProspectusDocument => doc !== null));
    }

    return validatedDocs;
  }

  // ==================== FUZZY MATCHING (AC: 6) ====================

  /**
   * Normalize company name for matching
   */
  private normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(limited|ltd|inc|pvt|private|corporation|corp)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns similarity score 0-100
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const normalized1 = this.normalizeCompanyName(str1);
    const normalized2 = this.normalizeCompanyName(str2);

    const dist = distance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    if (maxLength === 0) return 0;

    return ((maxLength - dist) / maxLength) * 100;
  }

  /**
   * Match document to existing IPO using fuzzy matching
   * AC: 6 - 85% similarity threshold
   */
  private async matchDocumentToIPO(doc: ProspectusDocument): Promise<{
    ipoId: string | null;
    score: number;
  }> {
    try {
      // Query IPOs with status UPCOMING or OPEN
      const allIPOs = await db
        .select()
        .from(ipos)
        .where(sql`${ipos.status} IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED')`);

      let bestMatch: { ipoId: string; score: number } | null = null;

      for (const ipo of allIPOs) {
        const similarity = this.calculateSimilarity(doc.ipoName, ipo.companyName);

        if (similarity >= 85 && (!bestMatch || similarity > bestMatch.score)) {
          bestMatch = { ipoId: ipo.id, score: similarity };
        }
      }

      if (bestMatch) {
        this.log(`Matched "${doc.ipoName}" to IPO (${bestMatch.score.toFixed(1)}% similarity)`);
        return bestMatch;
      }

      this.log(`No match found for "${doc.ipoName}" (best score below 85% threshold)`);
      return { ipoId: null, score: 0 };
    } catch (error) {
      this.logError(`Failed to match IPO: ${error}`);
      return { ipoId: null, score: 0 };
    }
  }

  /**
   * Match all documents to IPOs
   */
  private async matchAllDocuments(docs: ProspectusDocument[]): Promise<MatchedDocument[]> {
    const matchedDocs: MatchedDocument[] = [];

    for (const doc of docs) {
      const match = await this.matchDocumentToIPO(doc);
      matchedDocs.push({
        ...doc,
        ipoId: match.ipoId,
        matchScore: match.score,
      });
    }

    return matchedDocs;
  }

  // ==================== DATABASE STORAGE (AC: 7, 8) ====================

  /**
   * Store documents in database with upsert logic
   * AC: 7, 8
   */
  private async storeDocuments(docs: MatchedDocument[]): Promise<void> {
    let storedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of docs) {
      // Skip documents without matched IPO
      if (!doc.ipoId) {
        skippedCount++;
        continue;
      }

      try {
        // Use upsert with conflict on URL
        const result = await db
          .insert(documents)
          .values({
            ipoId: doc.ipoId,
            type: doc.documentType,
            title: doc.title,
            url: doc.url,
            fileSize: doc.fileSize ? BigInt(doc.fileSize) : null,
            uploadedAt: doc.uploadedAt || new Date(),
            exchange: doc.exchange,
          })
          .onConflictDoUpdate({
            target: documents.url,
            set: {
              type: sql`EXCLUDED.type`,
              title: sql`EXCLUDED.title`,
              fileSize: sql`EXCLUDED.file_size`,
              uploadedAt: sql`EXCLUDED.uploaded_at`,
              exchange: sql`EXCLUDED.exchange`,
              updatedAt: sql`NOW()`,
            },
          });

        storedCount++;
      } catch (error: any) {
        if (error.message?.includes('duplicate key')) {
          updatedCount++;
        } else {
          this.logError(`Failed to store document: ${doc.url} - ${error}`);
        }
      }
    }

    this.log(
      `Storage complete: ${storedCount} stored, ${updatedCount} updated, ${skippedCount} skipped (no IPO match)`
    );
  }

  // ==================== UTILITIES ====================

  /**
   * Merge and deduplicate documents from both exchanges
   */
  private mergeDocuments(
    nseDocuments: ProspectusDocument[],
    bseDocuments: ProspectusDocument[]
  ): ProspectusDocument[] {
    const documentMap = new Map<string, ProspectusDocument>();

    // Add NSE documents
    for (const doc of nseDocuments) {
      documentMap.set(doc.url, doc);
    }

    // Add BSE documents (if duplicate URL, prefer NSE)
    for (const doc of bseDocuments) {
      if (!documentMap.has(doc.url)) {
        documentMap.set(doc.url, doc);
      }
    }

    return Array.from(documentMap.values());
  }

  /**
   * Helper for structured logging
   */
  private log(message: string, data?: any): void {
    if (data) {
      console.log(`[${this.config.name}] ${message}`, data);
    } else {
      console.log(`[${this.config.name}] ${message}`);
    }
  }
}

// Export singleton instance
export const prospectusScraper = new ProspectusScraper();
