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
  /**
   * True when this record matched an existing IPO and was routed through to
   * the update path rather than rejected or silently dropped (#159).
   */
  isUpdate?: boolean;
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

  /**
   * What to do with a record that matches an existing IPO row (#159):
   * - 'reject' (default) — refuse the record entirely (manual-entry / migration pipelines)
   * - 'route-to-update' — pass the record through (`shouldCreate: true`,
   *   `isUpdate: true`) so it flows into `upsertIPO()`'s existing
   *   field-protection + consolidation path and updates the matched row.
   *   Requires the duplicate check to have resolved an `existingIPO`; a
   *   match with no resolvable row still rejects even under this mode.
   */
  duplicateHandling?: 'reject' | 'route-to-update';
}

const DEFAULT_CONFIG: Required<PipelineConfig> = {
  rejectOnCriticalErrors: true,
  skipDuplicateDetection: false,
  enableAutoFixes: true,
  enableLogging: true,
  duplicateConfidenceThreshold: 'MEDIUM',
  duplicateHandling: 'reject',
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
        console.log(`[Pipeline] Auto-fixes applied for ${data.companyName}:`, autoFixesApplied);
      }
    }

    // Step 4: Duplicate detection
    let duplicateCheck: DuplicateCheckResult | undefined;
    let isUpdate = false;

    if (!this.config.skipDuplicateDetection) {
      duplicateCheck = await this.duplicateService.checkForDuplicates({
        companyName: data.companyName!,
        symbol: data.symbol,
        isin: data.isin,
        openDate: data.openDate,
        closeDate: data.closeDate,
      });

      if (duplicateCheck.isDuplicate) {
        const shouldRoute = this.shouldRejectDuplicate(duplicateCheck);

        if (
          shouldRoute &&
          this.config.duplicateHandling === 'route-to-update' &&
          duplicateCheck.existingIPO
        ) {
          // Match against the ipos table = this record is already tracked.
          // Route it through to the update path instead of rejecting or
          // silently dropping it (#159) — upsertIPO's field-protection +
          // consolidation logic decides what actually changes.
          isUpdate = true;
          warnings.push(
            `Matches existing IPO "${duplicateCheck.existingIPO.companyName}" (${duplicateCheck.confidence} confidence) — routing to update path`
          );
        } else if (shouldRoute) {
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
      reason: isUpdate ? 'Validation passed (existing IPO — routed to update)' : 'Validation passed',
      validatedData: data,
      validationResult,
      duplicateCheck,
      autoFixesApplied,
      warnings,
      isUpdate,
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
    const prefix = `[Pipeline][${source}]`;

    if (!result.valid) {
      console.error(
        `${prefix} ❌ Validation FAILED for ${companyName}:`,
        result.errors.map(e => e.message).join(', ')
      );
    } else if (result.warnings.length > 0) {
      console.warn(
        `${prefix} ⚠️  Validation passed with warnings for ${companyName}:`,
        result.warnings.map(w => w.message).join(', ')
      );
    } else {
      console.log(`${prefix} ✅ Validation passed for ${companyName}`);
    }

    if (result.autoFixes) {
      console.log(
        `${prefix} 🔧 Auto-fixes available:`,
        Object.keys(result.autoFixes).join(', ')
      );
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
      // Duplicate detection runs, but a match ROUTES to update instead of
      // rejecting (duplicateHandling below) — the persister (upsertIPO)
      // remains the single source of dedup+update truth, matching an
      // existing IPO by normalized name / slug and UPDATEing it. Using a
      // symbol-exists check as a hard create-reject gate rejected every
      // already-known IPO (GitHub #3, the production zero-records bug);
      // skipping detection entirely to dodge that instead silently dropped
      // every MEDIUM+ duplicate match with no route to update at all
      // (GitHub #159 — GMP/subscription/status froze on re-scrape).
      skipDuplicateDetection: false,
      enableAutoFixes: true,
      enableLogging: true,
      duplicateConfidenceThreshold: 'MEDIUM',
      duplicateHandling: 'route-to-update',
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
