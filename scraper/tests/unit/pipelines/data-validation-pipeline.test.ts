import { describe, it, expect, vi } from 'vitest';
import { DataValidationPipeline, PipelineFactory } from '../../../src/pipelines/data-validation-pipeline.js';
import type { DuplicateCheckResult } from '../../../src/services/duplicate-detection-service.js';
import logger from '../../../src/utils/logger.js';

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

/**
 * P3-6 (round-2 review, T-278): the same offering-type-mismatch warning
 * (InvIT/REIT written as IPO) logged 20+ times per cycle for the same 3
 * companies, because every source that touches those rows independently
 * calls the pipeline. Repeated (companyName, warning) pairs within a single
 * process lifetime (== one scrape cycle, per the PM2 scheduled-one-shot
 * contract) must log once, not once per source.
 */
describe('DataValidationPipeline — repeated-warning log dedup (P3-6)', () => {
  const smeIpoWithLowLot = {
    // Distinct name from the other describe block's fixture — module-level
    // dedup state persists for the process lifetime (that's the point being
    // tested), so reusing "Clay Craft India Limited" here would collide with
    // an earlier test's already-logged warning key.
    companyName: 'Dedup Test Fixture Ltd',
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

  function stubDuplicates(pipeline: DataValidationPipeline, result: DuplicateCheckResult) {
    (pipeline as any).duplicateService.checkForDuplicates = vi.fn().mockResolvedValue(result);
  }

  it('logs the same (company, warning) pair once, not once per source', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const pipeline = PipelineFactory.createProductionPipeline({} as any);
    stubDuplicates(pipeline, { isDuplicate: false, confidence: 'LOW' } as DuplicateCheckResult);

    await pipeline.validateAndProcess(smeIpoWithLowLot, 'NSE');
    await pipeline.validateAndProcess(smeIpoWithLowLot, 'BSE');
    await pipeline.validateAndProcess(smeIpoWithLowLot, 'CHITTORGARH');

    const matchingCalls = warnSpy.mock.calls.filter(
      (call) => (call[0] as any)?.companyName === 'Dedup Test Fixture Ltd'
    );
    expect(matchingCalls.length).toBe(1);

    warnSpy.mockRestore();
  });
});
