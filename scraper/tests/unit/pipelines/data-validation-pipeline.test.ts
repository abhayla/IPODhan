import { describe, it, expect, vi } from 'vitest';
import { DataValidationPipeline, PipelineFactory } from '../../../src/pipelines/data-validation-pipeline.js';
import type { DuplicateCheckResult } from '../../../src/services/duplicate-detection-service.js';

/**
 * Regression coverage for the production zero-records bug (GitHub #3):
 * the production pipeline rejected every already-known IPO as a "duplicate",
 * so open IPOs could never be UPDATED (GMP / subscription / status never
 * refreshed). The persister (upsertIPO) is the single source of dedup+update,
 * so the production pipeline MUST NOT use duplicate detection as a create gate.
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

  const existingSymbolMatch: DuplicateCheckResult = {
    isDuplicate: true,
    confidence: 'HIGH',
    matchReason: 'Stock symbol "CLAYCRAFT" already exists. This company is likely already listed.',
    matchType: 'EXACT_SYMBOL',
  };

  // Stub the duplicate service so the test never touches a real database.
  function stubDuplicates(pipeline: DataValidationPipeline, result: DuplicateCheckResult) {
    (pipeline as any).duplicateService.checkForDuplicates = vi.fn().mockResolvedValue(result);
  }

  it('production pipeline does NOT reject an already-known IPO (lets the persister update it)', async () => {
    const pipeline = PipelineFactory.createProductionPipeline({} as any);
    stubDuplicates(pipeline, existingSymbolMatch);

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    // The whole point: an existing symbol must NOT block processing.
    expect(result.shouldCreate).toBe(true);
  });

  it('still rejects genuine data-quality failures (lot size below SEBI minimum)', async () => {
    const pipeline = PipelineFactory.createProductionPipeline({} as any);
    stubDuplicates(pipeline, { isDuplicate: false, confidence: 'LOW' } as DuplicateCheckResult);

    const result = await pipeline.validateAndProcess({ ...validIpo, lotSize: 1 }, 'NSE');

    expect(result.shouldCreate).toBe(false);
  });

  it('a duplicate-detecting pipeline DOES reject — proves the knob is the only difference', async () => {
    const pipeline = new DataValidationPipeline({} as any, {
      skipDuplicateDetection: false,
      duplicateConfidenceThreshold: 'MEDIUM',
    });
    stubDuplicates(pipeline, existingSymbolMatch);

    const result = await pipeline.validateAndProcess(validIpo, 'NSE');

    expect(result.shouldCreate).toBe(false);
  });
});
