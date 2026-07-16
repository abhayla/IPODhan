import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for ISS-C (production audit 2026-06-12):
 * The validation pipeline rejected every re-scrape of an existing IPO as
 * "Duplicate detected", so existing IPOs were never updated (ipos.updated_at
 * froze; statuses/dates went stale on the live site). A duplicate match
 * against the ipos table means "already tracked" — the correct route is the
 * upsert/update path, not rejection.
 */

const mockCheckForDuplicates = vi.fn();

vi.mock('../../../src/services/duplicate-detection-service.js', () => ({
  DuplicateDetectionService: vi.fn().mockImplementation(() => ({
    checkForDuplicates: mockCheckForDuplicates,
  })),
}));

import { DataValidationPipeline, PipelineFactory } from '../../../src/pipelines/data-validation-pipeline.js';

const fakeDb = {} as any;

const VALID_IPO = {
  companyName: 'Sarda Proteins Ltd',
  lotSize: 1000,
  segment: 'SME',
  offeringType: 'IPO',
  priceRangeMin: 50,
  priceRangeMax: 55,
  issueSize: '25.5',
  openDate: '2026-06-11',
  closeDate: '2026-06-24',
};

const EXISTING_MATCH = {
  isDuplicate: true,
  confidence: 'MEDIUM' as const,
  matchReason: 'Company name "Sarda Proteins Ltd" closely matches existing IPO: "SARDA PROTEINS LTD".',
  existingIPO: { id: 'ipo-123', companyName: 'SARDA PROTEINS LTD', slug: 'sarda-proteins-ltd' },
  matchType: 'FUZZY_NAME' as const,
};

beforeEach(() => {
  mockCheckForDuplicates.mockReset();
});

describe('DataValidationPipeline duplicate handling', () => {
  it('production pipeline routes existing-IPO matches to the update path instead of rejecting', async () => {
    mockCheckForDuplicates.mockResolvedValue(EXISTING_MATCH);
    const pipeline = PipelineFactory.createProductionPipeline(fakeDb);

    const result = await pipeline.validateAndProcess({ ...VALID_IPO }, 'BSE');

    expect(result.shouldCreate).toBe(true);
    expect(result.isUpdate).toBe(true);
    expect(result.duplicateCheck?.isDuplicate).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/existing IPO/i);
  });

  it('reject-mode pipeline preserves legacy rejection semantics', async () => {
    mockCheckForDuplicates.mockResolvedValue(EXISTING_MATCH);
    const pipeline = new DataValidationPipeline(fakeDb, { duplicateHandling: 'reject' });

    const result = await pipeline.validateAndProcess({ ...VALID_IPO }, 'BSE');

    expect(result.shouldCreate).toBe(false);
    expect(result.reason).toMatch(/Duplicate detected/);
  });

  it('production pipeline still rejects records with critical validation errors', async () => {
    mockCheckForDuplicates.mockResolvedValue({ isDuplicate: false, confidence: 'LOW', matchReason: 'none' });
    const pipeline = PipelineFactory.createProductionPipeline(fakeDb);

    const result = await pipeline.validateAndProcess({ ...VALID_IPO, lotSize: 1 }, 'BSE');

    expect(result.shouldCreate).toBe(false);
    expect(result.reason).toMatch(/Critical validation errors/);
  });

  it('non-duplicate valid records still pass through as creates', async () => {
    mockCheckForDuplicates.mockResolvedValue({ isDuplicate: false, confidence: 'LOW', matchReason: 'none' });
    const pipeline = PipelineFactory.createProductionPipeline(fakeDb);

    const result = await pipeline.validateAndProcess({ ...VALID_IPO }, 'NSE');

    expect(result.shouldCreate).toBe(true);
    expect(result.isUpdate).toBeFalsy();
  });
});
