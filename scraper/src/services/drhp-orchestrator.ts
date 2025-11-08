/**
 * DRHP Orchestrator Service
 * Coordinates DRHP download, extraction, and data consolidation
 *
 * Core Responsibilities:
 * 1. Orchestrate complete DRHP pipeline
 * 2. Download DRHP PDFs
 * 3. Extract financial data via Python
 * 4. Send extracted data to consolidation service
 * 5. Update document extraction status
 * 6. Handle errors and queuing
 *
 * Architecture:
 * - Coordinates DRHPDownloader, DRHPExtractor, DataConsolidationService
 * - Implements retry logic with exponential backoff
 * - Tracks extraction status in database
 * - Graceful degradation (continues if DRHP fails)
 *
 * Performance:
 * - Target: <90s end-to-end (download + extract + consolidate)
 * - Success rate: >80%
 * - Async/non-blocking operation
 */

import type { DRHPDownloaderService, DRHPDocument } from './drhp-downloader';
import type { DRHPExtractorService, DRHPExtraction } from './drhp-extractor';
import type { DataConsolidationService, ConsolidationResult } from './data-consolidation-service';
import type { ManualReviewQueueService } from './manual-review-queue';

/**
 * DRHP pipeline result
 */
export interface DRHPPipelineResult {
  success: boolean;
  ipoId: string;

  // DRHP download
  drhpDownloaded: boolean;
  drhpDocument?: DRHPDocument;

  // Extraction
  extractionAttempted: boolean;
  extractionSuccessful: boolean;
  extraction?: DRHPExtraction;

  // Consolidation
  consolidationAttempted: boolean;
  consolidationResult?: ConsolidationResult;

  // Errors
  errors: string[];

  // Performance
  totalTimeMs: number;
  downloadTimeMs?: number;
  extractionTimeMs?: number;
  consolidationTimeMs?: number;
}

/**
 * Pipeline options
 */
export interface ProcessIPOOptions {
  ipoId: string;
  companyName: string;
  isin?: string;
  skipDownload?: boolean; // Skip download if PDF already exists
  skipExtraction?: boolean; // Only download, don't extract
  forceReExtract?: boolean; // Re-extract even if already extracted
}

/**
 * DRHP Orchestrator Service
 * Main coordinator for DRHP pipeline
 */
export class DRHPOrchestratorService {
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 5000; // 5 seconds

  constructor(
    private downloader: DRHPDownloaderService,
    private extractor: DRHPExtractorService,
    private consolidationService: DataConsolidationService,
    private documentRepository: any, // DocumentRepository from web
    private manualReviewQueue: ManualReviewQueueService
  ) {
    console.log('[DRHPOrchestrator] Service initialized');
  }

  /**
   * Process new IPO through complete DRHP pipeline
   * Main entry point for scraper orchestrators
   *
   * @param options - Pipeline options
   * @returns Pipeline result with all step outcomes
   */
  async processIPO(options: ProcessIPOOptions): Promise<DRHPPipelineResult> {
    const startTime = Date.now();

    const result: DRHPPipelineResult = {
      success: false,
      ipoId: options.ipoId,
      drhpDownloaded: false,
      extractionAttempted: false,
      extractionSuccessful: false,
      consolidationAttempted: false,
      errors: [],
      totalTimeMs: 0,
    };

    console.log(`[DRHPOrchestrator] Processing IPO: ${options.companyName}`);

    try {
      // Step 1: Download DRHP
      if (!options.skipDownload) {
        result.drhpDocument = await this.downloadDRHP(options);
        result.drhpDownloaded = !!result.drhpDocument;
        result.downloadTimeMs = Date.now() - startTime;
      }

      // Step 2: Extract financial data
      if (result.drhpDocument && !options.skipExtraction) {
        const extractionStart = Date.now();
        result.extractionAttempted = true;

        const extractionResult = await this.extractDRHP(
          result.drhpDocument,
          options
        );

        if (extractionResult) {
          result.extraction = extractionResult;
          result.extractionSuccessful = true;
          result.extractionTimeMs = Date.now() - extractionStart;

          // Step 3: Consolidate extracted data
          const consolidationStart = Date.now();
          result.consolidationAttempted = true;

          result.consolidationResult = await this.consolidateData(
            options.ipoId,
            extractionResult
          );

          result.consolidationTimeMs = Date.now() - consolidationStart;

          // Update document status
          await this.updateDocumentStatus(result.drhpDocument, 'COMPLETED', {
            confidence: extractionResult.metadata.confidence_score,
          });

          result.success = true;
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DRHPOrchestrator] Pipeline error: ${errorMessage}`);
      result.errors.push(errorMessage);
    }

    result.totalTimeMs = Date.now() - startTime;

    // Log summary
    console.log(
      `[DRHPOrchestrator] Pipeline complete for ${options.companyName}: ` +
      `success=${result.success}, downloaded=${result.drhpDownloaded}, ` +
      `extracted=${result.extractionSuccessful}, time=${result.totalTimeMs}ms`
    );

    return result;
  }

  /**
   * Download DRHP PDF
   */
  private async downloadDRHP(
    options: ProcessIPOOptions
  ): Promise<DRHPDocument | null> {
    try {
      console.log(`[DRHPOrchestrator] Downloading DRHP for ${options.companyName}...`);

      const document = await this.downloader.processNewIPO(
        options.ipoId,
        options.companyName,
        options.isin
      );

      if (document) {
        console.log(`[DRHPOrchestrator] DRHP downloaded: ${document.localPath}`);
      } else {
        console.log(`[DRHPOrchestrator] No DRHP found for ${options.companyName}`);
      }

      return document;

    } catch (error) {
      console.error('[DRHPOrchestrator] Download error:', error);
      return null;
    }
  }

  /**
   * Extract data from DRHP PDF with retry logic
   */
  private async extractDRHP(
    document: DRHPDocument,
    options: ProcessIPOOptions
  ): Promise<DRHPExtraction | null> {
    // Check if already extracted (unless force re-extract)
    if (!options.forceReExtract && document.extractionStatus === 'COMPLETED') {
      console.log('[DRHPOrchestrator] DRHP already extracted, skipping');
      return null;
    }

    console.log(`[DRHPOrchestrator] Extracting data from DRHP...`);

    // Update status to IN_PROGRESS
    await this.updateDocumentStatus(document, 'IN_PROGRESS');

    let lastError: Error | null = null;

    // Retry loop
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const extraction = await this.extractor.extract({
          pdfPath: document.localPath,
          ipoId: document.ipoId,
        });

        console.log(
          `[DRHPOrchestrator] Extraction successful on attempt ${attempt} ` +
          `(confidence: ${extraction.metadata.confidence_score}%)`
        );

        return extraction;

      } catch (error) {
        lastError = error as Error;
        console.error(`[DRHPOrchestrator] Extraction attempt ${attempt} failed:`, error);

        // Update retry count
        await this.incrementDocumentRetry(document);

        // Wait before retry
        if (attempt < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY_MS * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    await this.updateDocumentStatus(document, 'FAILED', {
      error: lastError?.message || 'Unknown error',
    });

    // Queue for manual review
    await this.manualReviewQueue.addToQueue({
      ipoId: document.ipoId,
      pdfPath: document.localPath,
      reason: `Extraction failed after ${this.MAX_RETRIES} attempts: ${lastError?.message}`,
      priority: 'HIGH',
    });

    return null;
  }

  /**
   * Consolidate extracted data with existing IPO data
   */
  private async consolidateData(
    ipoId: string,
    extraction: DRHPExtraction
  ): Promise<ConsolidationResult> {
    console.log('[DRHPOrchestrator] Consolidating extracted data...');

    // Map Python extraction result to consolidation input
    const incomingData = this.mapExtractionToIPOData(extraction);

    // Call consolidation service
    const result = await this.consolidationService.consolidateIPOData({
      ipoId,
      tableName: 'ipos',
      incomingData,
      source: 'DRHP', // Critical: DRHP has high priority in field matrix
      confidence: extraction.metadata.confidence_score,
      scrapedAt: new Date(),
    });

    console.log(
      `[DRHPOrchestrator] Consolidation complete: ` +
      `${result.fieldsUpdated}/${result.fieldsProcessed} fields updated, ` +
      `${result.conflictsDetected} conflicts detected`
    );

    return result;
  }

  /**
   * Map Python extraction result to IPO database fields
   */
  private mapExtractionToIPOData(extraction: DRHPExtraction): Record<string, any> {
    const data = extraction.data;

    // Map financial fields
    const mapped: Record<string, any> = {};

    // Revenue
    if (data.revenue_fy2022 !== null) mapped.revenue_fy2022 = data.revenue_fy2022;
    if (data.revenue_fy2023 !== null) mapped.revenue_fy2023 = data.revenue_fy2023;
    if (data.revenue_fy2024 !== null) mapped.revenue_fy2024 = data.revenue_fy2024;
    if (data.revenue_fy2025 !== null) mapped.revenue_fy2025 = data.revenue_fy2025;

    // Profit
    if (data.profit_fy2022 !== null) mapped.profit_fy2022 = data.profit_fy2022;
    if (data.profit_fy2023 !== null) mapped.profit_fy2023 = data.profit_fy2023;
    if (data.profit_fy2024 !== null) mapped.profit_fy2024 = data.profit_fy2024;
    if (data.profit_fy2025 !== null) mapped.profit_fy2025 = data.profit_fy2025;

    // EBITDA
    if (data.ebitda_fy2022 !== null) mapped.ebitda_fy2022 = data.ebitda_fy2022;
    if (data.ebitda_fy2023 !== null) mapped.ebitda_fy2023 = data.ebitda_fy2023;
    if (data.ebitda_fy2024 !== null) mapped.ebitda_fy2024 = data.ebitda_fy2024;
    if (data.ebitda_fy2025 !== null) mapped.ebitda_fy2025 = data.ebitda_fy2025;

    // Other fields
    if (data.eps !== null) mapped.eps = data.eps;
    if (data.fresh_issue !== null) mapped.issueSize = data.fresh_issue; // Map to issueSize
    if (data.promoter_holding_pre !== null) mapped.promoterHoldingPre = data.promoter_holding_pre;
    if (data.promoter_holding_post !== null) mapped.promoterHoldingPost = data.promoter_holding_post;

    return mapped;
  }

  /**
   * Update document extraction status
   */
  private async updateDocumentStatus(
    document: DRHPDocument,
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'MANUAL_REVIEW',
    options?: {
      confidence?: number;
      error?: string;
    }
  ): Promise<void> {
    try {
      await this.documentRepository.update(document.id, {
        extractionStatus: status,
        extractionConfidence: options?.confidence,
        extractedAt: status === 'COMPLETED' ? new Date() : undefined,
        extractionError: options?.error,
        updatedAt: new Date(),
      });

      console.log(`[DRHPOrchestrator] Document status updated to ${status}`);
    } catch (error) {
      console.error('[DRHPOrchestrator] Error updating document status:', error);
    }
  }

  /**
   * Increment document retry count
   */
  private async incrementDocumentRetry(document: DRHPDocument): Promise<void> {
    try {
      await this.documentRepository.update(document.id, {
        retryCount: (document.extractionStatus === 'PENDING' ? 0 : document.retryCount || 0) + 1,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('[DRHPOrchestrator] Error incrementing retry count:', error);
    }
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get pipeline statistics for monitoring
   */
  async getStats(): Promise<{
    downloaderStats: any;
    extractorStats: any;
    queueStats: any;
  }> {
    return {
      downloaderStats: await this.downloader.getDownloadStats(),
      extractorStats: this.extractor.getStats(),
      queueStats: await this.manualReviewQueue.getStats(),
    };
  }

  /**
   * Batch process multiple IPOs
   * Useful for backfill operations
   */
  async batchProcessIPOs(
    ipos: Array<{
      ipoId: string;
      companyName: string;
      isin?: string;
    }>
  ): Promise<DRHPPipelineResult[]> {
    console.log(`[DRHPOrchestrator] Batch processing ${ipos.length} IPOs...`);

    const results: DRHPPipelineResult[] = [];

    for (const ipo of ipos) {
      const result = await this.processIPO({
        ipoId: ipo.ipoId,
        companyName: ipo.companyName,
        isin: ipo.isin,
      });

      results.push(result);

      // Rate limiting - pause between IPOs
      await this.sleep(2000); // 2 second pause
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[DRHPOrchestrator] Batch processing complete: ${successCount}/${ipos.length} successful`
    );

    return results;
  }
}

/**
 * Export types for external use
 */
export type {
  DRHPPipelineResult,
  ProcessIPOOptions,
};
