// implements: R-158
/**
 * Item 1 slice s1 (row-key prep, F-74). The backfill's key computation must
 * fold company-name variants the same way the write paths' normaliser does
 * (packages/shared/src/utils/company-name-normalizer.ts,
 * normalizeCompanyNameForMatching) — this is the pure decision function,
 * `needsRepair`, unit-tested without a DB.
 *
 * Finding 6 (Tier A fix round): a row whose name normalises to '' used to
 * come back `write: false` forever (the stored '' default already equalled
 * the recomputed ''), so the empty-string sentinel survived the backfill —
 * a collision waiting to happen once slice s2 adds
 * `UNIQUE (ipo_id, normalized_name)` and two such rows share one IPO.
 * `needsRepair` now takes the row's own `id` and mints a stable, unique,
 * non-empty fallback key (`__empty__:<id>`) for that case, flagged via
 * `emptyNormalization: true`.
 */
import { describe, it, expect } from 'vitest';
import { needsRepair, EMPTY_NORMALIZATION_PREFIX } from '../../../scripts/backfill-normalized-name';

describe('backfill-normalized-name — needsRepair key computation (R-158)', () => {
  it('folds legal-suffix and parenthetical variants of a company name to one value', () => {
    const a = needsRepair({ currentNormalizedName: '', nameValue: 'ABC (India) Ltd', id: 'row-a' });
    const b = needsRepair({ currentNormalizedName: '', nameValue: 'ABC India Limited', id: 'row-b' });
    const c = needsRepair({ currentNormalizedName: '', nameValue: 'abc india', id: 'row-c' });
    expect(a.recomputed).toBe(b.recomputed);
    expect(b.recomputed).toBe(c.recomputed);
    expect(a.recomputed).toBe('abc india');
  });

  it('folds a person name regardless of case and trailing whitespace', () => {
    const a = needsRepair({ currentNormalizedName: '', nameValue: 'Sunil Sharma', id: 'row-a' });
    const b = needsRepair({ currentNormalizedName: '', nameValue: 'SUNIL SHARMA ', id: 'row-b' });
    expect(a.recomputed).toBe(b.recomputed);
    expect(a.recomputed).toBe('sunil sharma');
  });

  it('flags a row for write when the stored normalized_name diverges from the recomputed value', () => {
    const result = needsRepair({ currentNormalizedName: '', nameValue: 'Sunil Sharma', id: 'row-a' });
    expect(result.write).toBe(true);
  });

  it('is idempotent: a row already carrying the correct normalized_name is not flagged', () => {
    const result = needsRepair({
      currentNormalizedName: 'sunil sharma',
      nameValue: 'Sunil Sharma',
      id: 'row-a',
    });
    expect(result.write).toBe(false);
  });

  describe('empty-normalization rows (Finding 6)', () => {
    it('a whitespace-only name (real-shaped scrape junk) gets a stable non-empty fallback key, not the "" sentinel', () => {
      const result = needsRepair({ currentNormalizedName: '', nameValue: '   ', id: 'promoter-42' });
      expect(result.emptyNormalization).toBe(true);
      expect(result.recomputed).toBe(`${EMPTY_NORMALIZATION_PREFIX}promoter-42`);
      expect(result.recomputed).not.toBe('');
      // was previously stuck at write:false forever because '' === ''
      expect(result.write).toBe(true);
    });

    it('a pure-punctuation name (e.g. all hyphens) also folds to "" and gets the same fallback treatment', () => {
      const result = needsRepair({ currentNormalizedName: '', nameValue: '----', id: 'peer-7' });
      expect(result.emptyNormalization).toBe(true);
      expect(result.recomputed).toBe(`${EMPTY_NORMALIZATION_PREFIX}peer-7`);
    });

    it('two different empty-normalizing rows under the same IPO get DIFFERENT fallback keys (no future UNIQUE collision)', () => {
      const rowA = needsRepair({ currentNormalizedName: '', nameValue: '   ', id: 'row-a' });
      const rowB = needsRepair({ currentNormalizedName: '', nameValue: '-', id: 'row-b' });
      expect(rowA.recomputed).not.toBe(rowB.recomputed);
    });

    it('is idempotent once the fallback key has already been written', () => {
      const result = needsRepair({
        currentNormalizedName: `${EMPTY_NORMALIZATION_PREFIX}promoter-42`,
        nameValue: '   ',
        id: 'promoter-42',
      });
      expect(result.write).toBe(false);
      expect(result.emptyNormalization).toBe(true);
    });
  });
});
