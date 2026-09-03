import { describe, it, expect } from 'vitest';
import { FIELD_PRIORITY_MATRIX, getFieldRules } from '../../../src/config/field-priority-matrix.js';

/**
 * W-49 — `openDate`/`closeDate` had only snake_case (`open_date`/`close_date`)
 * entries in the matrix. `data-persister.ts` builds the `incomingData` passed to
 * `consolidateIPOData` with the camelCase keys (`openDate`/`closeDate`), so that
 * lookup fell through to `getFieldRules`'s generic DEFAULT rule — no ADMIN>NSE>BSE
 * priority order, no field-specific confidenceThreshold — silently, for every
 * IPO's open/close date resolution.
 *
 * NB: assert against FIELD_PRIORITY_MATRIX directly — getFieldRules() returns a
 * generic default for unknown keys, so it can't prove an entry is registered.
 */
describe('field priority matrix — openDate/closeDate camelCase siblings registered (W-49)', () => {
  for (const f of ['open_date', 'openDate', 'close_date', 'closeDate']) {
    it(`registers ${f} explicitly`, () => {
      expect(FIELD_PRIORITY_MATRIX[f], `${f} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
    });
  }

  it('getFieldRules(openDate) equals getFieldRules(open_date)', () => {
    expect(getFieldRules('openDate')).toEqual(getFieldRules('open_date'));
  });

  it('getFieldRules(closeDate) equals getFieldRules(close_date)', () => {
    expect(getFieldRules('closeDate')).toEqual(getFieldRules('close_date'));
  });

  it('camelCase openDate/closeDate are NOT the generic DEFAULT rule (a real matrix entry, not a fallback)', () => {
    const defaultRule = getFieldRules('__totally_unregistered_probe_field__');
    expect(getFieldRules('openDate')).not.toEqual(defaultRule);
    expect(getFieldRules('closeDate')).not.toEqual(defaultRule);
  });
});

/**
 * W-49 sweep: walk every matrix key and, for every snake_case key that has a
 * camelCase sibling ALSO registered, fail if the two entries' rules diverge.
 * A silent divergence means the resolved value depends on which spelling the
 * caller happens to use for that field on a given write path — exactly the
 * class of bug this task fixes for openDate/closeDate.
 *
 * This does NOT assert every snake_case key has a camelCase sibling (many are
 * genuinely snake_case-only call sites, e.g. `company_name`, `min_investment`)
 * — only that where BOTH spellings exist, they must agree. See the W-49 report
 * (data-consolidation-service.test.ts commit / task notes) for the full list of
 * fields registered under only one spelling and whether that spelling matches
 * the field's actual camelCase/snake_case call sites.
 */
describe('field priority matrix — snake_case/camelCase sibling pairs stay in sync (W-49 sweep)', () => {
  function toCamel(snake: string): string {
    return snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  }

  const allKeys = Object.keys(FIELD_PRIORITY_MATRIX);
  const snakeKeysWithCamelSibling = allKeys
    .filter((k) => k.includes('_'))
    .map((k) => [k, toCamel(k)] as const)
    .filter(([, camel]) => allKeys.includes(camel));

  it('found at least one snake/camel sibling pair to check (sanity — matrix has known pairs like lot_size/lotSize)', () => {
    expect(snakeKeysWithCamelSibling.length).toBeGreaterThan(0);
  });

  // openDate/closeDate are asserted equal above. The five pairs that used to
  // diverge here (pe_ratio/peRatio, debt_to_equity/debtToEquity,
  // issue_size/issueSize, listing_date/listingDate, allotment_date/
  // allotmentDate) were fixed by W-55: each snake_case duplicate was deleted
  // and merged into one canonical camelCase entry, resolved by
  // getFieldRules()'s snake->camel normaliser (see the W-55 describe block
  // below). They no longer appear in `snakeKeysWithCamelSibling` (the
  // snake_case key is gone from FIELD_PRIORITY_MATRIX), so this set is empty
  // — kept as a named type so a REGRESSION (someone re-adding a diverging
  // snake_case twin) still fails loudly instead of silently skipping.
  const knownDivergent = new Set<string>([]);

  for (const [snakeKey, camelKey] of snakeKeysWithCamelSibling) {
    if (knownDivergent.has(snakeKey)) {
      it.skip(`${snakeKey}/${camelKey} — known pre-existing divergence, not part of W-49`, () => {});
      continue;
    }
    it(`${snakeKey} and ${camelKey} have identical rules (description text may legitimately differ)`, () => {
      const { description: _camelDesc, ...camelRule } = FIELD_PRIORITY_MATRIX[camelKey];
      const { description: _snakeDesc, ...snakeRule } = FIELD_PRIORITY_MATRIX[snakeKey];
      expect(camelRule).toEqual(snakeRule);
    });
  }
});

/**
 * W-55 — five fields were registered under BOTH spellings with DIVERGING
 * rules (pe_ratio/peRatio, debt_to_equity/debtToEquity, issue_size/issueSize,
 * listing_date/listingDate, allotment_date/allotmentDate), plus two
 * consolidation keys (companyName/leadManagers) that were registered ONLY
 * under their snake_case spelling and so fell through to the DEFAULT rule.
 * Fix: one canonical camelCase entry per field (the snake_case duplicate is
 * deleted, not kept as a second rule object) and a normalising
 * getFieldRules() that resolves a snake_case lookup to it.
 */
describe('field priority matrix — W-55 canonical camelCase entries + normalising lookup', () => {
  const migratedFields: Array<[snake: string, camel: string]> = [
    ['pe_ratio', 'peRatio'],
    ['debt_to_equity', 'debtToEquity'],
    ['issue_size', 'issueSize'],
    ['listing_date', 'listingDate'],
    ['allotment_date', 'allotmentDate'],
    ['company_name', 'companyName'],
    ['lead_managers', 'leadManagers'],
  ];

  for (const [snakeKey, camelKey] of migratedFields) {
    it(`${camelKey} is registered as the sole canonical entry (${snakeKey} is NOT a separate matrix key)`, () => {
      expect(FIELD_PRIORITY_MATRIX[camelKey], `${camelKey} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
      expect(FIELD_PRIORITY_MATRIX[snakeKey], `${snakeKey} should have been deleted as a duplicate`).toBeUndefined();
    });

    it(`getFieldRules('${snakeKey}') resolves to the same object as getFieldRules('${camelKey}') via the normaliser`, () => {
      expect(getFieldRules(snakeKey)).toEqual(getFieldRules(camelKey));
    });

    it(`getFieldRules('${snakeKey}') is NOT the generic DEFAULT rule (a real matrix entry, not a fallback)`, () => {
      const defaultRule = getFieldRules('__totally_unregistered_probe_field__');
      expect(getFieldRules(snakeKey)).not.toEqual(defaultRule);
    });
  }

  // Every FIELD_PRIORITY_MATRIX key that CONTAINS an underscore and also
  // co-exists with its camelCase form must have been eliminated by the merge
  // above — i.e. no diverging snake/camel pair can exist post-fix. This is a
  // structural regression guard, not a claim that every matrix key is
  // camelCase (many fields — company_description, min_investment,
  // total_subscription, etc. — are legitimately snake_case-only call sites).
  it('no snake_case key in the matrix still has a co-registered camelCase sibling with different rules', () => {
    const toCamel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    const allKeys = Object.keys(FIELD_PRIORITY_MATRIX);
    const divergent = allKeys
      .filter((k) => k.includes('_'))
      .map((k) => [k, toCamel(k)] as const)
      .filter(([, camel]) => allKeys.includes(camel))
      .filter(([snake, camel]) => {
        const { description: _d1, ...camelRule } = FIELD_PRIORITY_MATRIX[camel];
        const { description: _d2, ...snakeRule } = FIELD_PRIORITY_MATRIX[snake];
        return JSON.stringify(camelRule) !== JSON.stringify(snakeRule);
      });
    expect(divergent, `diverging sibling pairs found: ${JSON.stringify(divergent)}`).toEqual([]);
  });
});
