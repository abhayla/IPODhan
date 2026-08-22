/**
 * Automated Data Validation Pipeline
 *
 * Integrates all data quality checks into a single automated pipeline:
 * 1. Scraper validation (lot_size, offering type, etc.)
 * 2. Duplicate detection (NSE symbol, company name, etc.)
 * 3. SEBI compliance validation
 * 4. Auto-fixes for known issues
 * 5. Logging and monitoring
 *
 * Usage in scrapers:
 * ```typescript
 * import { DataValidationPipeline } from './pipelines/data-validation-pipeline';
 *
 * const pipeline = new DataValidationPipeline(db, logger);
 * const result = await pipeline.validateAndProcess(scrapedData, 'NSE');
 *
 * if (!result.shouldCreate) {
 *   console.log('Skipping IPO:', result.reason);
 *   return;
 * }
 *
 * // Safe to create IPO with validated/auto-fixed data
 * await createIPO(result.validatedData);
 * ```
 *
 * @module scraper/pipelines/data-validation-pipeline
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { validateIPOData, type IPODataToValidate, type ValidationResult } from '../utils/data-validation.js';
import { DuplicateDetectionService, type DuplicateCheckResult } from '../services/duplicate-detection-service.js';
import logger from '../utils/logger.js';

/**
 * Module-level (not per-pipeline-instance) dedup set for repeated validation
 * warnings (P3-6, T-278). `DataValidationPipeline` is re-instantiated on every
 * write (per IPO, per source), so an instance-scoped Set would never dedupe
 * anything — the SAME warning for the SAME IPO fires once per source per
 * cycle by design (each of ~6 sources independently validates the row), which
 * is what produced 20+ identical "InvIT/REIT written as IPO" log lines per
 * cycle for the same 3 companies. This process runs one scrape cycle and
 * exits (the PM2 scheduled-one-shot contract — see pm2-scheduled-one-shot-
 * scraper.md), so module-level state naturally resets to "once per cycle"
 * for free on the next cron-triggered process start.
 */
const loggedWarningKeys = new Set<string>();

export interface PipelineInput extends IPODataToValidate {
  // All fields from IPODataToValidate
}

export interface PipelineResult {
  shouldCreate: boolean;
  reason: string;
  validatedData: Record<string, any>;
  validationResult: ValidationResult;
  duplicateCheck?: DuplicateCheckResult;
  autoFixesApplied: Record<string, any>;
  warnings: string[];
}

export interface PipelineConfig {
  /** Reject IPOs with critical validation errors (default: true) */
  rejectOnCriticalErrors?: boolean;

  /** Skip duplicate detection (default: false) */
  skipDuplicateDetection?: boolean;

  /** Auto-apply fixes for known issues (default: true) */
  enableAutoFixes?: boolean;

  /** Log validation results (default: true) */
  enableLogging?: boolean;

  /** Confidence threshold for duplicate detection (default: 'MEDIUM') */
  duplicateConfidenceThreshold?: 'HIGH' | 'MEDIUM' | 'LOW';
}

const DEFAULT_CONFIG: Required<PipelineConfig> = {
  rejectOnCriticalErrors: true,
  skipDuplicateDetection: false,
  enableAutoFixes: true,
  enableLogging: true,
  duplicateConfidenceThreshold: 'MEDIUM',
};

/**
 * Data Validation Pipeline
 * Orchestrates all validation checks and auto-fixes
 */
export class DataValidationPipeline {
  private duplicateService: DuplicateDetectionService;
  private config: Required<PipelineConfig>;

  constructor(
    private db: NodePgDatabase<typeof schema>,
    config?: PipelineConfig
  ) {
    this.duplicateService = new DuplicateDetectionService(db);
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  /**
   * Main pipeline method
   * Validates data and determines if IPO should be created
   */
  async validateAndProcess(
    data: PipelineInput,
    source: string
  ): Promise<PipelineResult> {
    const warnings: string[] = [];
    let autoFixesApplied: Record<string, any> = {};

    // Step 1: Data validation
    const validationResult = validateIPOData(data, source);

    if (this.config.enableLogging) {
      this.logValidationResult(validationResult, data.companyName, source);
    }

    // Step 2: Check for critical errors
    if (this.config.rejectOnCriticalErrors && !validationResult.valid) {
      return {
        shouldCreate: false,
        reason: `Critical validation errors: ${validationResult.errors.map(e => e.message).join(', ')}`,
        validatedData: data,
        validationResult,
        autoFixesApplied: {},
        warnings: [],
      };
    }

    // Step 3: Apply auto-fixes
    if (this.config.enableAutoFixes && validationResult.autoFixes) {
      autoFixesApplied = validationResult.autoFixes;
      Object.assign(data, autoFixesApplied);

      if (this.config.enableLogging) {
        logger.info({ companyName: data.companyName, autoFixesApplied }, 'Pipeline auto-fixes applied');
      }
    }

    // Step 4: Duplicate detection
    let duplicateCheck: DuplicateCheckResult | undefined;

    if (!this.config.skipDuplicateDetection) {
      duplicateCheck = await this.duplicateService.checkForDuplicates({
        companyName: data.companyName!,
        symbol: data.symbol,
        isin: data.isin,
        openDate: data.openDate,
        closeDate: data.closeDate,
      });

      // Reject if duplicate found with sufficient confidence
      if (duplicateCheck.isDuplicate) {
        const shouldReject = this.shouldRejectDuplicate(duplicateCheck);

        if (shouldReject) {
          return {
            shouldCreate: false,
            reason: `Duplicate detected: ${duplicateCheck.matchReason}`,
            validatedData: data,
            validationResult,
            duplicateCheck,
            autoFixesApplied,
            warnings: [],
          };
        } else {
          warnings.push(`Possible duplicate (${duplicateCheck.confidence} confidence): ${duplicateCheck.matchReason}`);
        }
      }
    }

    // Step 5: Collect all warnings
    for (const warning of validationResult.warnings) {
      warnings.push(`${warning.field}: ${warning.message}`);
    }

    // Step 6: Final decision
    return {
      shouldCreate: true,
      reason: 'Validation passed',
      validatedData: data,
      validationResult,
      duplicateCheck,
      autoFixesApplied,
      warnings,
    };
  }

  /**
   * Batch process multiple IPO records
   */
  async batchValidateAndProcess(
    records: PipelineInput[],
    source: string
  ): Promise<{
    results: PipelineResult[];
    summary: {
      total: number;
      shouldCreate: number;
      rejected: number;
      autoFixed: number;
      duplicates: number;
    };
  }> {
    const results: PipelineResult[] = [];

    for (const record of records) {
      const result = await this.validateAndProcess(record, source);
      results.push(result);
    }

    const summary = {
      total: results.length,
      shouldCreate: results.filter(r => r.shouldCreate).length,
      rejected: results.filter(r => !r.shouldCreate).length,
      autoFixed: results.filter(r => Object.keys(r.autoFixesApplied).length > 0).length,
      duplicates: results.filter(r => r.duplicateCheck?.isDuplicate).length,
    };

    return { results, summary };
  }

  /**
   * Determine if duplicate should be rejected based on confidence
   */
  private shouldRejectDuplicate(duplicateCheck: DuplicateCheckResult): boolean {
    const confidenceOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const thresholdOrder = confidenceOrder[this.config.duplicateConfidenceThreshold];
    const checkOrder = confidenceOrder[duplicateCheck.confidence];

    return checkOrder >= thresholdOrder;
  }

  /**
   * Log validation result
   */
  private logValidationResult(
    result: ValidationResult,
    companyName?: string,
    source?: string
  ): void {
    if (!result.valid) {
      logger.error(
        { source, companyName, errors: result.errors.map((e) => e.message) },
        'Pipeline validation FAILED'
      );
    } else if (result.warnings.length > 0) {
      const message = result.warnings.map((w) => w.message).join(', ');
      const dedupeKey = `${companyName}::${message}`;
      if (!loggedWarningKeys.has(dedupeKey)) {
        loggedWarningKeys.add(dedupeKey);
        logger.warn({ source, companyName, warnings: result.warnings.map((w) => w.message) }, 'Pipeline validation passed with warnings');
      }
    } else {
      logger.debug({ source, companyName }, 'Pipeline validation passed');
    }

    if (result.autoFixes) {
      logger.info({ source, companyName, autoFixes: Object.keys(result.autoFixes) }, 'Pipeline auto-fixes available');
    }
  }

  /**
   * Get pipeline statistics for monitoring
   */
  getStatistics(): {
    config: PipelineConfig;
    duplicateService: typeof this.duplicateService;
  } {
    return {
      config: this.config,
      duplicateService: this.duplicateService,
    };
  }
}

/**
 * Factory function to create pre-configured pipelines for different use cases
 */
export class PipelineFactory {
  /**
   * Create pipeline for production scrapers (strict validation)
   */
  static createProductionPipeline(
    db: NodePgDatabase<typeof schema>
  ): DataValidationPipeline {
    return new DataValidationPipeline(db, {
      rejectOnCriticalErrors: true,
      // Duplicate detection is intentionally OFF here: the persister
      // (upsertIPO) is the single source of dedup+update truth — it matches an
      // existing IPO by normalized name / slug and UPDATEs it. Using a
      // symbol-exists check as a create gate rejected every already-known IPO,
      // so open IPOs could never refresh their GMP / subscription / status
      // (GitHub #3, the production zero-records bug).
      skipDuplicateDetection: true,
      enableAutoFixes: true,
      enableLogging: true,
      duplicateConfidenceThreshold: 'MEDIUM',
    });
  }

  /**
   * Create pipeline for development/testing (lenient)
   */
  static createDevelopmentPipeline(
    db: NodePgDatabase<typeof schema>
  ): DataValidationPipeline {
    return new DataValidationPipeline(db, {
      rejectOnCriticalErrors: false, // Allow errors for testing
      skipDuplicateDetection: true, // Skip duplicate detection
      enableAutoFixes: true,
      enableLogging: true,
      duplicateConfidenceThreshold: 'HIGH', // Only reject high-confidence duplicates
    });
  }

  /**
   * Create pipeline for manual data entry (auto-fix heavy)
   */
  static createManualEntryPipeline(
    db: NodePgDatabase<typeof schema>
  ): DataValidationPipeline {
    return new DataValidationPipeline(db, {
      rejectOnCriticalErrors: false, // Allow manual override
      skipDuplicateDetection: false,
      enableAutoFixes: true, // Apply all auto-fixes
      enableLogging: true,
      duplicateConfidenceThreshold: 'MEDIUM',
    });
  }

  /**
   * Create pipeline for data migration (validation only)
   */
  static createMigrationPipeline(
    db: NodePgDatabase<typeof schema>
  ): DataValidationPipeline {
    return new DataValidationPipeline(db, {
      rejectOnCriticalErrors: false, // Don't reject existing data
      skipDuplicateDetection: true, // Migration data already in DB
      enableAutoFixes: false, // Don't modify migration data
      enableLogging: true,
      duplicateConfidenceThreshold: 'HIGH',
    });
  }
}
