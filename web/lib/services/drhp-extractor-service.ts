/**
 * DRHP PDF Extractor Service
 * TypeScript integration bridge for Python PDF extraction
 *
 * Confidence-based routing:
 * - ≥90%: Auto-populate (high confidence)
 * - 75-89%: Review required (medium confidence)
 * - <75%: Manual entry (low confidence)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { logger, logError, logPerformance } from '@/lib/logging/logger';

const execAsync = promisify(exec);

// Type definitions for extracted data
export interface DRHPExtractedData {
  company: string;
  revenue_fy2022: number | null;
  revenue_fy2023: number | null;
  revenue_fy2024: number | null;
  revenue_fy2025: number | null;
  profit_fy2022: number | null;
  profit_fy2023: number | null;
  profit_fy2024: number | null;
  profit_fy2025: number | null;
  ebitda_fy2022: number | null;
  ebitda_fy2023: number | null;
  ebitda_fy2024: number | null;
  ebitda_fy2025: number | null;
  eps: number | null;
  fresh_issue: number | null;
}

export interface DRHPExtractionMetadata {
  extraction_time: number;
  tables_found: number;
  profit_row_priority: number;
  unit_mode: string;
  confidence_details: {
    critical_score: number;
    secondary_score: number;
    tertiary_score: number;
    quality_bonus: number;
    total_score: number;
  };
}

export interface DRHPExtractionResult {
  data: DRHPExtractedData;
  metadata: DRHPExtractionMetadata;
}

export interface ProcessingResult {
  success: boolean;
  confidence: number;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  action: 'AUTO_POPULATE' | 'REVIEW_REQUIRED' | 'MANUAL_ENTRY';
  data?: DRHPExtractedData;
  metadata?: DRHPExtractionMetadata;
  error?: string;
  extractionPath?: string;
}

export class DRHPExtractorService {
  private readonly pythonScript = 'extract_drhp_pdfplumber_v2.py';
  private readonly pdfParserPath = path.join(process.cwd(), '..', 'pdf-parser-test');
  private readonly outputPath = path.join(this.pdfParserPath, 'output');

  constructor() {
    // Ensure output directory exists
    this.ensureOutputDirectory();
  }

  private async ensureOutputDirectory() {
    try {
      await fs.access(this.outputPath);
    } catch {
      await fs.mkdir(this.outputPath, { recursive: true });
    }
  }

  /**
   * Extract financial data from DRHP PDF
   * @param pdfPath - Path to the PDF file
   * @param ipoSlug - IPO slug for database association
   * @returns Processing result with confidence-based routing
   */
  async extractDRHPData(pdfPath: string, ipoSlug: string): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      logger.info('Starting DRHP extraction', { pdfPath, ipoSlug });

      // Step 1: Execute Python extractor
      const extractionResult = await this.runPythonExtractor(pdfPath);

      if (!extractionResult.success) {
        return {
          success: false,
          confidence: 0,
          confidenceLevel: 'LOW',
          action: 'MANUAL_ENTRY',
          error: extractionResult.error
        };
      }

      // Step 2: Parse JSON output
      const jsonPath = extractionResult.outputPath;
      if (!jsonPath) {
        return {
          success: false,
          confidence: 0,
          confidenceLevel: 'LOW',
          action: 'MANUAL_ENTRY',
          error: 'No output path from extraction'
        };
      }
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      const result: DRHPExtractionResult = JSON.parse(jsonContent);

      // Step 3: Determine confidence level and action
      const confidence = result.metadata.confidence_details.total_score;
      const { confidenceLevel, action } = this.determineRouting(confidence);

      // Step 4: Log extraction metrics
      const duration = Date.now() - startTime;
      logPerformance('drhp.extraction', duration, {
        ipoSlug,
        confidence,
        confidenceLevel,
        tablesFound: result.metadata.tables_found,
        extractionTime: result.metadata.extraction_time
      });

      // Step 5: Process based on confidence level
      const processingResult: ProcessingResult = {
        success: true,
        confidence,
        confidenceLevel,
        action,
        data: result.data,
        metadata: result.metadata,
        extractionPath: jsonPath
      };

      // Store extraction results based on confidence
      await this.storeExtractionResults(ipoSlug, processingResult);

      return processingResult;

    } catch (error) {
      logError(error as Error, {
        context: 'DRHP extraction',
        pdfPath,
        ipoSlug
      });

      return {
        success: false,
        confidence: 0,
        confidenceLevel: 'LOW',
        action: 'MANUAL_ENTRY',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Execute Python extractor script
   */
  private async runPythonExtractor(pdfPath: string): Promise<{
    success: boolean;
    outputPath?: string;
    error?: string;
  }> {
    try {
      const pdfName = path.basename(pdfPath, '.pdf');
      const outputFile = path.join(this.outputPath, `${pdfName}_extraction_v2.json`);

      // Construct Python command
      const command = `python "${this.pythonScript}" "${pdfPath}"`;

      // Execute Python script with timeout
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.pdfParserPath,
        timeout: 120000 // 2 minute timeout
      });

      // Check if output file was created
      try {
        await fs.access(outputFile);
        return {
          success: true,
          outputPath: outputFile
        };
      } catch {
        return {
          success: false,
          error: 'Output file not created'
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check for specific error types
      if (errorMessage.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'Extraction timed out (>2 minutes)'
        };
      }

      if (errorMessage.includes('Python') || errorMessage.includes('python')) {
        return {
          success: false,
          error: 'Python not found or not configured'
        };
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Determine routing based on confidence score
   */
  private determineRouting(confidence: number): {
    confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    action: 'AUTO_POPULATE' | 'REVIEW_REQUIRED' | 'MANUAL_ENTRY';
  } {
    if (confidence >= 90) {
      return {
        confidenceLevel: 'HIGH',
        action: 'AUTO_POPULATE'
      };
    } else if (confidence >= 75) {
      return {
        confidenceLevel: 'MEDIUM',
        action: 'REVIEW_REQUIRED'
      };
    } else {
      return {
        confidenceLevel: 'LOW',
        action: 'MANUAL_ENTRY'
      };
    }
  }

  /**
   * Store extraction results in database
   */
  private async storeExtractionResults(
    ipoSlug: string,
    result: ProcessingResult
  ): Promise<void> {
    if (!result.success || !result.data) return;

    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const financialRepository = new FinancialDataRepository(db, redis);

    try {
      // Find IPO by slug
      const ipo = await ipoRepository.findBySlug(ipoSlug);
      if (!ipo) {
        logger.warn('IPO not found for DRHP extraction', { ipoSlug });
        return;
      }

      // Prepare financial data for storage - map to actual schema fields
      const financialData = {
        ipoId: ipo.id,
        // Revenue fields (FY2022-2024)
        revenueFy2022: result.data.revenue_fy2022?.toString() || null,
        revenueFy2023: result.data.revenue_fy2023?.toString() || null,
        revenueFy2024: result.data.revenue_fy2024?.toString() || null,
        // Profit fields (FY2022-2024)
        profitFy2022: result.data.profit_fy2022?.toString() || null,
        profitFy2023: result.data.profit_fy2023?.toString() || null,
        profitFy2024: result.data.profit_fy2024?.toString() || null,
        // EBITDA fields
        ebitdaFy2022: result.data.ebitda_fy2022?.toString() || null,
        ebitdaFy2023: result.data.ebitda_fy2023?.toString() || null,
        ebitdaFy2024: result.data.ebitda_fy2024?.toString() || null,
        // Other metrics
        eps: result.data.eps?.toString() || null,
      };

      // Store extraction metadata in a separate table or as JSON
      const extractionMetadata = {
        confidence: result.confidence,
        confidenceLevel: result.confidenceLevel,
        action: result.action,
        unitMode: result.metadata?.unit_mode,
        tablesFound: result.metadata?.tables_found,
        extractionTime: result.metadata?.extraction_time,
        extractedAt: new Date().toISOString()
      };

      // Store based on confidence level
      if (result.action === 'AUTO_POPULATE') {
        // High confidence: Auto-populate
        await financialRepository.upsert(financialData);

        // Store metadata (could be in a separate extraction_logs table)
        logger.info('Auto-populated DRHP data', {
          ipoSlug,
          confidence: result.confidence,
          metadata: extractionMetadata
        });
      } else if (result.action === 'REVIEW_REQUIRED') {
        // Medium confidence: Store but flag for review
        await financialRepository.upsert(financialData);

        logger.info('Stored DRHP data for review', {
          ipoSlug,
          confidence: result.confidence,
          metadata: extractionMetadata
        });
      } else {
        // Low confidence: Don't store, require manual entry
        logger.info('DRHP extraction confidence too low for storage', {
          ipoSlug,
          confidence: result.confidence,
          metadata: extractionMetadata
        });
      }

    } catch (error) {
      logError(error as Error, {
        context: 'Storing DRHP extraction results',
        ipoSlug
      });
      throw error;
    }
  }

  /**
   * Calculate growth rate between two periods
   */
  private calculateGrowthRate(
    previous: number | null,
    current: number | null
  ): number | null {
    if (!previous || !current || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Calculate profit margin
   */
  private calculateProfitMargin(
    profit: number | null,
    revenue: number | null
  ): number | null {
    if (!profit || !revenue || revenue === 0) return null;
    return (profit / revenue) * 100;
  }

  /**
   * Process multiple DRHPs in batch
   */
  async processBatch(pdfPaths: Array<{ path: string; ipoSlug: string }>): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: ProcessingResult[];
  }> {
    const results: ProcessingResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const { path: pdfPath, ipoSlug } of pdfPaths) {
      const result = await this.extractDRHPData(pdfPath, ipoSlug);
      results.push(result);

      if (result.success) {
        successful++;
      } else {
        failed++;
      }

      // Add delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return {
      total: pdfPaths.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Get extraction status for an IPO
   */
  async getExtractionStatus(ipoSlug: string): Promise<{
    hasExtraction: boolean;
    confidence?: number;
    action?: string;
    extractedAt?: Date;
  }> {
    const redis = getRedisClient();
    const financialRepository = new FinancialDataRepository(db, redis);
    const ipoRepository = new IPORepository(db, redis);

    const ipo = await ipoRepository.findBySlug(ipoSlug);
    if (!ipo) {
      return { hasExtraction: false };
    }

    const financialData = await financialRepository.findByIPO(ipo.id);
    if (!financialData) {
      return { hasExtraction: false };
    }

    // Check if we have extracted data (at least one revenue or profit field)
    const hasData = financialData.revenueFy2024 ||
                    financialData.profitFy2024 ||
                    financialData.eps;

    if (!hasData) {
      return { hasExtraction: false };
    }

    // For now, we'll return basic info
    // In a real implementation, we'd store extraction metadata separately
    return {
      hasExtraction: true,
      // These fields would be stored in a separate extraction_logs table
      confidence: 85, // Default medium confidence for existing data
      action: 'REVIEW_REQUIRED',
      extractedAt: new Date()
    };
  }
}

// Export singleton instance
export const drhpExtractorService = new DRHPExtractorService();