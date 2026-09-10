// implements: R-158
/**
 * Item 1 slice s1 (row-key prep, F-74). The backfill's key computation must
 * fold company-name variants the same way the write paths' shared row-key
 * function does (`rowKeyForName`,
 * packages/shared/src/utils/company-name-normalizer.ts) — this is the pure
 * decision function, `needsRepair`, unit-tested without a DB.
 *
 * Tier A round-2 finding (2026-09-09): the previous design minted
 * `__empty__:<row id>` for a junk name, but the write paths are
 * delete-then-insert — row ids are regenerated on every scrape, so an
 * id-derived key can never be reproduced by a re-scrape of the same name.
 * `needsRepair` now uses `rowKeyForName`, the SAME function every write path
 * uses: a junk-but-non-empty name (e.g. "----") gets a stable key derived
 * ONLY from the name; a name with no identity at all (null/empty/whitespace)
 * gets `nullKey: true` and `write: false` — the row is left untouched for a
 * human to resolve, never assigned an invented key.
 */
import { describe, it, expect } from 'vitest';
import { needsRepair } from '../../../scripts/backfill-normalized-name';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';

describe('backfill-normalized-name — needsRepair key computation (R-158, Tier A round-2)', () => {
  it('folds legal-suffix and parenthetical variants of a company name to one value', () => {
    const a = needsRepair({ currentNormalizedName: '', nameValue: 'ABC (India) Ltd', id: 'row-a' });
    const b = needsRepair({ currentNormalizedName: '', nameValue: 'ABC India Limited', id: 'row-b' });
    const c = needsRepair({ currentNormalizedName: '', nameValue: 'abc india', id: 'row-c' });
    expect(a.recomputed).toBe(b.recomputed);
    expect(b.recomputed).toBe(c.recomputed);
    // Item 12 slice B: the key SHORTENED to 'abc' because a TRAILING country
    // token is now dropped. The PROPERTY this test exists to prove is the two
    // assertions ABOVE - all three spellings fold to ONE value - and they are
    // untouched. Only the literal moved.
    expect(a.recomputed).toBe('abc');
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

  describe('the backfill and the write path agree on the SAME key (Tier A round-2 proof)', () => {
    it('a backfilled row and a re-scrape of the SAME junk name produce the IDENTICAL key', () => {
      // The backfill calls needsRepair -> rowKeyForName internally. A write
      // path (filing-persister.ts, data-persister.ts) calls rowKeyForName
      // directly on a re-scrape of the same raw name. Assert the two code
      // paths' outputs are equal — not two separately hard-coded strings.
      const rawName = '----';
      const backfillResult = needsRepair({ currentNormalizedName: '', nameValue: rawName, id: 'row-a' });
      const writePathKey = rowKeyForName(rawName);
      expect(backfillResult.recomputed).toBe(writePathKey);
      expect(backfillResult.recomputed).not.toBeNull();
    });

    it('a backfilled row and a re-scrape of a real company name produce the IDENTICAL key', () => {
      const rawName = 'ABC (India) Ltd';
      const backfillResult = needsRepair({ currentNormalizedName: '', nameValue: rawName, id: 'row-a' });
      const writePathKey = rowKeyForName(rawName);
      expect(backfillResult.recomputed).toBe(writePathKey);
      // Same shortening. The PROPERTY here is the assertion above: the
      // backfill's key equals the write path's key. That still holds.
      expect(backfillResult.recomputed).toBe('abc');
    });
  });

  describe('null-key rows (no identity at all) — Tier A round-2', () => {
    it('a whitespace-only name has no identity: nullKey true, write false, recomputed null', () => {
      const result = needsRepair({ currentNormalizedName: '', nameValue: '   ', id: 'promoter-42' });
      expect(result.nullKey).toBe(true);
      expect(result.write).toBe(false);
      expect(result.recomputed).toBeNull();
    });

    it('an empty name has no identity: nullKey true, write false', () => {
      const result = needsRepair({ currentNormalizedName: '', nameValue: '', id: 'promoter-43' });
      expect(result.nullKey).toBe(true);
      expect(result.write).toBe(false);
    });

    it('a pure-punctuation name (e.g. all hyphens) is JUNK, not null — it gets a real stable key', () => {
      const result = needsRepair({ currentNormalizedName: '', nameValue: '----', id: 'peer-7' });
      expect(result.nullKey).toBe(false);
      expect(result.recomputed).not.toBeNull();
      expect(result.recomputed).toBe(rowKeyForName('----'));
    });

    it('is never re-flagged for write once nullKey — there is nothing to write', () => {
      const result = needsRepair({
        currentNormalizedName: '',
        nameValue: '   ',
        id: 'promoter-42',
      });
      expect(result.write).toBe(false);
      expect(result.nullKey).toBe(true);
    });
  });
});
