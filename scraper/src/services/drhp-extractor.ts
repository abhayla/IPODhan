/**
 * DRHP Extractor Service
 * Python-TypeScript bridge for financial data extraction from DRHP PDFs
 *
 * Core Responsibilities:
 * 1. Spawn Python process safely
 * 2. Pass PDF path to extraction script
 * 3. Capture and parse JSON output
 * 4. Timeout protection (30 seconds)
 * 5. Error handling and retry logic
 * 6. Queue failed extractions for manual review
 *
 * Architecture:
 * - Uses child_process.spawn for non-blocking execution
 * - Timeout protection prevents hanging
 * - Structured error logging
 * - Confidence score validation
 * - Automatic queuing of low-confidence extractions
 *
 * Performance:
 * - Target: <30s per extraction
 * - Success rate: >90%
 * - Confidence threshold: 75%
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * Extraction result from Python script
 */
export interface DRHPExtraction {
  // Financial data
  data: {
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
    promoter_holding_pre: number | null;
    promoter_holding_post: number | null;
  };

  // Metadata
  metadata: {
    extraction_time: number;
    pl_page: number | null;
    tables_found: number;
    confidence_score: number;
    issues: string[];
    unit: string;
  };

  // Error (if any)
  error?: string;
}

/**
 * Extraction options
 */
export interface ExtractOptions {
  pdfPath: string;
  ipoId: string;
  timeout?: number; // milliseconds
  pythonPath?: string; // path to Python executable
  scriptPath?: string; // path to extraction script
}

/**
 * Extraction statistics
 */
interface ExtractionStats {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  averageConfidence: number;
  averageTimeMs: number;
}

/**
 * DRHP Extractor Service
 * Bridge between TypeScript and Python extraction script
 */
export class DRHPExtractorService {
  private stats: ExtractionStats = {
    totalAttempts: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    averageConfidence: 0,
    averageTimeMs: 0,
  };

  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly CONFIDENCE_THRESHOLD = 75; // Minimum confidence for auto-acceptance
  private readonly PYTHON_SCRIPT_PATH: string;

  constructor(
    private manualReviewQueue: any // ManualReviewQueueService
  ) {
    // Path to Python extraction script (CLI wrapper)
    this.PYTHON_SCRIPT_PATH = path.join(
      __dirname,
      '../../../pdf-parser-test/cli_extractor.py'
    );
  }

  /**
   * Extract financial data from DRHP PDF
   * Main entry point
   *
   * @param options - Extraction options
   * @returns Extraction result with data and metadata
   * @throws Error if extraction fails critically
   */
  async extract(options: ExtractOptions): Promise<DRHPExtraction> {
    const startTime = Date.now();
    this.stats.totalAttempts++;

    console.log(`[DRHPExtractor] Starting extraction: ${path.basename(options.pdfPath)}`);

    try {
      // Validate inputs
      this.validateOptions(options);

      // Spawn Python process with timeout
      const result = await this.spawnPythonExtractor(options);

      // Validate extraction quality
      await this.validateExtraction(result, options);

      // Update stats
      this.stats.successCount++;
      this.updateAverageStats(result.metadata.confidence_score, Date.now() - startTime);

      console.log(
        `[DRHPExtractor] Extraction successful (${Math.round(result.metadata.extraction_time * 1000)}ms, ` +
        `confidence: ${result.metadata.confidence_score}%)`
      );

      return result;

    } catch (error) {
      this.stats.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DRHPExtractor] Extraction failed: ${errorMessage}`);

      // Queue for manual review
      await this.queueForManualReview(options.pdfPath, options.ipoId, errorMessage);

      throw error;
    }
  }

  /**
   * Spawn Python extraction process
   * Core Python-TypeScript bridge logic
   */
  private async spawnPythonExtractor(options: ExtractOptions): Promise<DRHPExtraction> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || this.DEFAULT_TIMEOUT;
      const pythonPath = options.pythonPath || 'python';
      const scriptPath = options.scriptPath || this.PYTHON_SCRIPT_PATH;

      // Prepare arguments
      const args = [scriptPath, options.pdfPath];

      console.log(`[DRHPExtractor] Spawning Python: ${pythonPath} ${args.join(' ')}`);

      // Spawn Python process
      const pythonProcess: ChildProcess = spawn(pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, capture stdout and stderr
      });

      let stdoutData = '';
      let stderrData = '';
      let timedOut = false;

      // Timeout protection
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.stats.timeoutCount++;

        console.error(`[DRHPExtractor] Process timeout after ${timeout}ms`);

        // Kill Python process
        if (pythonProcess.pid) {
          try {
            process.kill(pythonProcess.pid, 'SIGTERM');
          } catch (error) {
            console.error('[DRHPExtractor] Error killing process:', error);
          }
        }

        reject(new Error(`DRHP extraction timeout after ${timeout}ms`));
      }, timeout);

      // Capture stdout
      if (pythonProcess.stdout) {
        pythonProcess.stdout.on('data', (data: Buffer) => {
          stdoutData += data.toString();
        });
      }

      // Capture stderr
      if (pythonProcess.stderr) {
        pythonProcess.stderr.on('data', (data: Buffer) => {
          stderrData += data.toString();
        });
      }

      // Handle process completion
      pythonProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          return; // Already rejected
        }

        // Check exit code
        if (code !== 0) {
          const errorMsg = `Python process exited with code ${code}`;
          console.error(`[DRHPExtractor] ${errorMsg}`);
          console.error(`[DRHPExtractor] stderr: ${stderrData}`);
          reject(new Error(`${errorMsg}: ${stderrData}`));
          return;
        }

        // Parse JSON output
        try {
          const result = JSON.parse(stdoutData);

          // Validate structure
          if (!result.data || !result.metadata) {
            throw new Error('Invalid extraction result structure');
          }

          resolve(result as DRHPExtraction);

        } catch (parseError) {
          console.error('[DRHPExtractor] JSON parse error:', parseError);
          console.error('[DRHPExtractor] stdout:', stdoutData.substring(0, 500));
          reject(new Error(`Invalid JSON from extractor: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });

      // Handle process errors
      pythonProcess.on('error', (error: Error) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          return; // Already rejected
        }

        console.error('[DRHPExtractor] Process error:', error);
        reject(new Error(`Python process error: ${error.message}`));
      });
    });
  }

  /**
   * Validate extraction options
   */
  private validateOptions(options: ExtractOptions): void {
    if (!options.pdfPath) {
      throw new Error('PDF path is required');
    }

    if (!options.ipoId) {
      throw new Error('IPO ID is required');
    }

    // Check if Python script exists
    const fs = require('fs');
    if (!fs.existsSync(this.PYTHON_SCRIPT_PATH)) {
      throw new Error(`Python script not found: ${this.PYTHON_SCRIPT_PATH}`);
    }

    // Check if PDF exists
    if (!fs.existsSync(options.pdfPath)) {
      throw new Error(`PDF file not found: ${options.pdfPath}`);
    }
  }

  /**
   * Validate extraction quality
   * Queue for manual review if confidence is low
   */
  private async validateExtraction(
    result: DRHPExtraction,
    options: ExtractOptions
  ): Promise<void> {
    const confidence = result.metadata.confidence_score;

    // Check if confidence is below threshold
    if (confidence < this.CONFIDENCE_THRESHOLD) {
      console.warn(
        `[DRHPExtractor] Low confidence (${confidence}%), queuing for manual review`
      );

      await this.queueForManualReview(
        options.pdfPath,
        options.ipoId,
        `Low confidence extraction: ${confidence}%`,
        result
      );

      // Still return the result, but log the warning
      // Admin can review and approve/reject later
    }

    // Check if extraction returned any data
    const dataFields = Object.values(result.data).filter((val) => val !== null);
    if (dataFields.length === 0) {
      console.warn('[DRHPExtractor] Extraction returned no data fields');

      await this.queueForManualReview(
        options.pdfPath,
        options.ipoId,
        'No data extracted from DRHP',
        result
      );
    }
  }

  /**
   * Queue extraction for manual review
   */
  private async queueForManualReview(
    pdfPath: string,
    ipoId: string,
    reason: string,
    extractionResult?: DRHPExtraction
  ): Promise<void> {
    try {
      await this.manualReviewQueue.addToQueue({
        ipoId,
        pdfPath,
        reason,
        extractionResult: extractionResult || null,
        queuedAt: new Date(),
        priority: reason.includes('timeout') ? 'HIGH' : 'MEDIUM',
      });

      console.log(`[DRHPExtractor] Added to manual review queue: ${reason}`);
    } catch (error) {
      console.error('[DRHPExtractor] Failed to queue for manual review:', error);
      // Don't fail the extraction if queuing fails
    }
  }

  /**
   * Update running average statistics
   */
  private updateAverageStats(confidence: number, timeMs: number): void {
    const n = this.stats.successCount;

    // Update average confidence
    this.stats.averageConfidence =
      (this.stats.averageConfidence * (n - 1) + confidence) / n;

    // Update average time
    this.stats.averageTimeMs =
      (this.stats.averageTimeMs * (n - 1) + timeMs) / n;
  }

  /**
   * Get extraction statistics for monitoring
   */
  getStats(): ExtractionStats {
    return {
      ...this.stats,
      averageConfidence: Math.round(this.stats.averageConfidence * 10) / 10,
      averageTimeMs: Math.round(this.stats.averageTimeMs),
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      averageConfidence: 0,
      averageTimeMs: 0,
    };
  }

  /**
   * Test Python environment
   * Useful for health checks and debugging
   */
  async testPythonEnvironment(pythonPath?: string): Promise<{
    pythonVersion: string;
    scriptExists: boolean;
    dependenciesInstalled: boolean;
  }> {
    const python = pythonPath || 'python';

    try {
      // Test Python version
      const versionResult = await new Promise<string>((resolve, reject) => {
        const proc = spawn(python, ['--version']);
        let output = '';

        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve(output.trim());
          } else {
            reject(new Error('Python not found'));
          }
        });
      });

      // Check script exists
      const fs = require('fs');
      const scriptExists = fs.existsSync(this.PYTHON_SCRIPT_PATH);

      // Test dependencies (pdfplumber)
      let dependenciesInstalled = false;
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(python, ['-c', 'import pdfplumber']);
          proc.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error('pdfplumber not installed'));
            }
          });
        });
        dependenciesInstalled = true;
      } catch {
        dependenciesInstalled = false;
      }

      return {
        pythonVersion: versionResult,
        scriptExists,
        dependenciesInstalled,
      };

    } catch (error) {
      throw new Error(
        `Python environment test failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Export types for external use
 */
export type { ExtractOptions, ExtractionStats };
