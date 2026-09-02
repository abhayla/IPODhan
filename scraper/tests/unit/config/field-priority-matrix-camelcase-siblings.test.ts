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

  // openDate/closeDate are asserted equal above; this table lists every OTHER
  // known sibling pair and whether its rules currently agree. Pairs marked
  // `false` are pre-existing, out-of-scope-for-W-49 divergences (reported,
  // not fixed here) — flipping one to `true` without fixing the matrix will
  // fail this test on purpose.
  const knownDivergent = new Set([
    'pe_ratio', // vs peRatio - different sources/threshold/validation
    'debt_to_equity', // vs debtToEquity - different threshold/validation
    'issue_size', // vs issueSize - different sources order/threshold
    'listing_date', // vs listingDate - camelCase adds DRHP
    'allotment_date', // vs allotmentDate - camelCase adds DRHP
  ]);

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
