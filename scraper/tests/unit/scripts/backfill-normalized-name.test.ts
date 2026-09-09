// implements: R-158
/**
 * Item 1 slice s1 (row-key prep, F-74). The backfill's key computation must
 * fold company-name variants the same way the write paths' normaliser does
 * (packages/shared/src/utils/company-name-normalizer.ts,
 * normalizeCompanyNameForMatching) — this is the pure decision function,
 * `needsRepair`, unit-tested without a DB.
 */
import { describe, it, expect } from 'vitest';
import { needsRepair } from '../../../scripts/backfill-normalized-name';

describe('backfill-normalized-name — needsRepair key computation (R-158)', () => {
  it('folds legal-suffix and parenthetical variants of a company name to one value', () => {
    const a = needsRepair({ currentNormalizedName: '', nameValue: 'ABC (India) Ltd' });
    const b = needsRepair({ currentNormalizedName: '', nameValue: 'ABC India Limited' });
    const c = needsRepair({ currentNormalizedName: '', nameValue: 'abc india' });
    expect(a.recomputed).toBe(b.recomputed);
    expect(b.recomputed).toBe(c.recomputed);
    expect(a.recomputed).toBe('abc india');
  });

  it('folds a person name regardless of case and trailing whitespace', () => {
    const a = needsRepair({ currentNormalizedName: '', nameValue: 'Sunil Sharma' });
    const b = needsRepair({ currentNormalizedName: '', nameValue: 'SUNIL SHARMA ' });
    expect(a.recomputed).toBe(b.recomputed);
    expect(a.recomputed).toBe('sunil sharma');
  });

  it('flags a row for write when the stored normalized_name diverges from the recomputed value', () => {
    const result = needsRepair({ currentNormalizedName: '', nameValue: 'Sunil Sharma' });
    expect(result.write).toBe(true);
  });

  it('is idempotent: a row already carrying the correct normalized_name is not flagged', () => {
    const result = needsRepair({ currentNormalizedName: 'sunil sharma', nameValue: 'Sunil Sharma' });
    expect(result.write).toBe(false);
  });
});
