import { describe, it, expect, vi } from 'vitest';
import { DataValidationPipeline, PipelineFactory } from '../../../src/pipelines/data-validation-pipeline.js';
import type { DuplicateCheckResult } from '../../../src/services/duplicate-detection-service.js';
import type { IPO } from '@ipodhan/shared/db/types';

/**
 * Regression coverage for two related duplicate-handling defects on the
 * production scraper pipeline:
 *
 * - GitHub #3 (production zero-records bug): the pipeline used to REJECT
 *   every already-known IPO as a "duplicate", so open IPOs could never be
 *   UPDATED (GMP / subscription / status never refreshed).
 * - GitHub #159 (this fix): the prior fix for #3 disabled duplicate
 *   detection entirely in production (`skipDuplicateDetection: true`),
 *   which meant a MEDIUM+ duplicate match had NO route back to the update
 *   path at all — `shouldCreate` was the only signal
 *   `BaseScraperOrchestrator.run()` read, so any record that would have
 *   matched was silently dropped before ever reaching `upsertIPO()`.
 *   The persister (`upsertIPO`) is the single source of dedup+update truth,
 *   so the production pipeline MUST route a resolved duplicate match
 *   through to it (`isUpdate: true`, `shouldCreate: true`) instead of
 *   rejecting OR skipping detection altogether.
 */
describe('DataValidationPipeline — duplicate handling', () => {
  // A data-quality-valid SME IPO (passes Step 1 validateIPOData and reaches Step 4).
  const validIpo = {
    companyName: 'Clay Craft India Limited',
    lotSize: 600,
    segment: 'SME' as const,
    offeringType: 'IPO' as const,
    priceRangeMin: 193,
    priceRangeMax: 203,
    issueSize: 54.24,
    symbol: 'CLAYCRAFT',
    isin: 'INE0XYZ01234',
    openDate: '2026-06-16',
    closeDate: '2026-06-18',
  };

  const existingIPO = { id: 'ipo-123', companyName: 'Clay Craft India Limited' } as IPO;

  const existingSymbolMatch: DuplicateCheckResult = {
    isDuplicate: true,
    confidence: 'HIGH',
    matchReason: 'Stock symbol "CLAYCRAFT" already exists. This company is likely already listed.',
    matchType: 'EXACT_SYMBOL',
    existingIPO,
  };

  // Stub the duplicate service so the test never touches a real database.
  // Returns the mock so callers can assert whether detection actually ran.
  function stubDuplicates(pipeline: DataValidationPipeline, result: DuplicateCheckResult) {
    const fn = vi.fn().mockResolvedValue(result);
    (pipeline as any).duplicateService.checkForDuplicates = fn;
    return fn;
  }

  it('[#159] production pipeline routes a MEDIUM+ duplicate match to update (isUpdate:true), never a silent drop', async () => {
    const pipeline = PipelineFactory.createProductionPipeline({} as any);
    const dupSpy = stubDuplicates(pipeline, existingSymbolMatch);

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    // Duplicate detection must actually run in production now (it was fully
    // skipped before — that was the #159 root cause).
    expect(dupSpy).toHaveBeenCalledTimes(1);
    // Never silently dropped.
    expect(result.shouldCreate).toBe(true);
    // Explicitly routed to update, not a coincidental pass-through.
    expect(result.isUpdate).toBe(true);
    expect(result.duplicateCheck?.existingIPO).toBe(existingIPO);
  });

  it('still rejects genuine data-quality failures (lot size below SEBI minimum)', async () => {
    const pipeline = PipelineFactory.createProductionPipeline({} as any);
    stubDuplicates(pipeline, { isDuplicate: false, confidence: 'LOW' } as DuplicateCheckResult);

    const result = await pipeline.validateAndProcess({ ...validIpo, lotSize: 1 }, 'NSE');

    expect(result.shouldCreate).toBe(false);
  });

  it('a duplicate match still rejects loudly when duplicateHandling is left at its default (reject) — legacy/manual-entry pipelines', async () => {
    const pipeline = new DataValidationPipeline({} as any, {
      skipDuplicateDetection: false,
      duplicateConfidenceThreshold: 'MEDIUM',
      // duplicateHandling intentionally omitted — defaults to 'reject'
    });
    stubDuplicates(pipeline, existingSymbolMatch);

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    expect(result.shouldCreate).toBe(false);
    // The drop reason must be loud (in the result), not silent.
    expect(result.reason).toContain('Duplicate detected');
    expect(result.isUpdate).toBeUndefined();
  });

  it('route-to-update mode still rejects a duplicate match with no resolvable existingIPO (never route without a real target row)', async () => {
    const pipeline = new DataValidationPipeline({} as any, {
      skipDuplicateDetection: false,
      duplicateConfidenceThreshold: 'MEDIUM',
      duplicateHandling: 'route-to-update',
    });
    stubDuplicates(pipeline, {
      isDuplicate: true,
      confidence: 'MEDIUM',
      matchReason: 'Company has overlapping IPO dates with existing record.',
      matchType: 'DATE_OVERLAP',
      // no existingIPO resolved
    });

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    expect(result.shouldCreate).toBe(false);
    expect(result.reason).toContain('Duplicate detected');
  });

  it('below-threshold duplicate confidence still passes through as a warning, not a route or reject', async () => {
    const pipeline = new DataValidationPipeline({} as any, {
      skipDuplicateDetection: false,
      duplicateConfidenceThreshold: 'HIGH',
      duplicateHandling: 'route-to-update',
    });
    stubDuplicates(pipeline, {
      isDuplicate: true,
      confidence: 'MEDIUM', // below the HIGH threshold configured above
      matchReason: 'Company name closely matches existing IPO.',
      matchType: 'FUZZY_NAME',
      existingIPO,
    });

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    expect(result.shouldCreate).toBe(true);
    expect(result.isUpdate).toBeFalsy();
    expect(result.warnings.some(w => w.includes('Possible duplicate'))).toBe(true);
  });
});
