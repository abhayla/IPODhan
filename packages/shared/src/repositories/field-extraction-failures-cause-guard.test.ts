import { describe, it, expect, vi } from 'vitest';
import { FieldExtractionFailuresRepository } from './field-extraction-failures-repository';

/**
 * signal-ownership.md R6: a failure that cannot be classified from its own row
 * is a defect of the logger. `cause` is NOT NULL in the schema; this guard is
 * the same contract one layer up, so a blank cause fails with a message that
 * names the field and the rule instead of an opaque driver error.
 */
describe('FieldExtractionFailuresRepository.recordFailure — cause is load-bearing', () => {
  const insert = vi.fn();
  const db = { insert } as any;
  const repo = new FieldExtractionFailuresRepository(db, {} as any);

  const base = {
    ipoId: 'ipo-1',
    tableName: 'ipos',
    fieldName: 'faceValue',
    ruleId: 'face_value_equity_enum',
    rankAttempted: 'NSE' as const,
    extractedValue: '3',
  };

  it('refuses an empty cause', async () => {
    await expect(repo.recordFailure({ ...base, cause: '' })).rejects.toThrow(/cause is required/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only cause', async () => {
    await expect(repo.recordFailure({ ...base, cause: '   ' })).rejects.toThrow(/cause is required/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a null cause', async () => {
    await expect(
      repo.recordFailure({ ...base, cause: null as unknown as string })
    ).rejects.toThrow(/cause is required/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts a real cause and truncates extracted_value to 2,000 chars', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'fef-1' }]);
    const values = vi.fn().mockReturnValue({ returning });
    insert.mockReturnValue({ values });

    await repo.recordFailure({
      ...base,
      extractedValue: 'x'.repeat(5000),
      cause: '[face_value_equity_enum] face_value 3 is not one of the equity denominations {1,2,5,10}',
    });

    expect(values.mock.calls[0][0].extractedValue).toHaveLength(2000);
    expect(values.mock.calls[0][0].cause).toContain('face_value_equity_enum');
  });
});
