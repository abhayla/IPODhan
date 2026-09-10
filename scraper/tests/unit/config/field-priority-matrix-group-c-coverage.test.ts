import { describe, it, expect } from 'vitest';
import {
  FIELD_PRIORITY_MATRIX,
  getFieldRules,
  getSourcePriority,
} from '../../../src/config/field-priority-matrix.js';
import manifest from '../../../config/field-manifest.json' with { type: 'json' };

/**
 * Item 3 slice 2 — the Group-C fields, sized by MEASUREMENT rather than by the
 * card's list of sixteen.
 *
 * Measured read-only over `field_sources` on BOTH `ipodhan` and
 * `ipodhan_staging` (`default_transaction_read_only=on` asserted per
 * connection, zero writes), then joined against `getFieldRules()`:
 *
 *  - Consolidation writes camelCase almost universally: 74 of 75 distinct
 *    (table, field) pairs on production carry no underscore. The lone
 *    exception, `ipo_valuation.PRICE_BAND_AD`, is a document-extraction label
 *    and not a column at all.
 *
 *  - Only THREE of the manifest's ten fields have ever been consolidated:
 *    `issueSize` (295 prod rows, already has an entry), `freshIssue` (8 prod /
 *    10 staging) and `ofsIssue` (4 / 5). Both of the latter are written by
 *    DRHP alone and both fall through to DEFAULT_RULES today.
 *
 *  - The other SEVEN have never been consolidated on either database, and
 *    `subscriptions` / `listing_performance` do not appear among consolidated
 *    tables at all despite holding 27,930 and 242 production rows. They are
 *    written by their own writers. A matrix entry for them would be dead
 *    config that READS AS COVERAGE — the exact class item 3 exists to remove.
 */

const DEFAULT_SOURCES = [
  'ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK',
];

/** The manifest says `DOC`; the matrix calls the same source `DRHP`. */
const MANIFEST_SOURCE_TO_MATRIX: Record<string, string> = { DOC: 'DRHP' };

describe('Group-C fields that real consolidation actually writes', () => {
  // freshIssue and ofsIssue are the ONLY manifest fields with live traffic and
  // no matrix entry. This is the whole defect, measured.
  for (const field of ['freshIssue', 'ofsIssue'] as const) {
    it(`${field} has its own entry and no longer falls through to DEFAULT_RULES`, () => {
      expect(Object.prototype.hasOwnProperty.call(FIELD_PRIORITY_MATRIX, field)).toBe(true);
      expect(getFieldRules(field).sources).not.toEqual(DEFAULT_SOURCES);
    });

    it(`${field} ranks its sources exactly as the manifest does`, () => {
      const row = (manifest as any).fields[`ipo_details.${field === 'freshIssue' ? 'fresh_issue' : 'ofs_issue'}`];
      expect(row, 'the manifest must carry this field').toBeTruthy();
      const expected = row.rank.MAINBOARD.map(
        (s: string) => MANIFEST_SOURCE_TO_MATRIX[s] ?? s
      );
      // ADMIN is a manual override that outranks every source everywhere and is
      // deliberately not carried in the manifest.
      expect(getFieldRules(field).sources).toEqual(['ADMIN', ...expected]);
    });

    it(`${field} rejects a source the manifest does not list`, () => {
      // Under DEFAULT_RULES, NSE ranked third and would have been accepted.
      expect(getSourcePriority(field, 'NSE')).toBe(-1);
      expect(getSourcePriority(field, 'DRHP')).toBeGreaterThan(-1);
    });
  }
});

describe('Group-C fields consolidation has NEVER written stay absent', () => {
  // Measured ABSENT from field_sources on both ipodhan and ipodhan_staging.
  // Each carries the reason it is not a matrix row, so a future reader does not
  // mistake the gap for an oversight and "fix" it.
  const NEVER_CONSOLIDATED: ReadonlyArray<readonly [string, string]> = [
    ['totalSubscription',  'subscriptions is written by its own writer, never through consolidation (27,930 prod rows, 0 field_sources rows)'],
    ['retailSubscription', 'same writer as totalSubscription'],
    ['qibSubscription',    'same writer as totalSubscription'],
    ['niiSubscription',    'same writer as totalSubscription'],
    ['listingPrice',       'listing_performance is written by its own writer (242 prod rows, 0 field_sources rows)'],
    ['revenue',            'financial_statements.revenue has never been consolidated under this name on either database'],
    ['minInvestment',      'never consolidated on either database; the snake_case min_investment entry is a genuine snake-only call site (W-49 names it)'],
  ];

  for (const [field, why] of NEVER_CONSOLIDATED) {
    it(`${field} has no camelCase matrix entry — ${why}`, () => {
      expect(Object.prototype.hasOwnProperty.call(FIELD_PRIORITY_MATRIX, field)).toBe(false);
    });
  }
});

describe('snake_case keys that are the ONLY entry for a live write path', () => {
  /**
   * The guard that would have stopped slice 3-S1.
   *
   * These seven keys carry 686 consolidated `ipo_financials` rows on staging.
   * `getFieldRules` camel-normalises each to a name the matrix does NOT have,
   * so the snake_case entry is the one that answers. Deleting them — which
   * 3-S1 as carded does — silently drops nine real financial fields to
   * DEFAULT_RULES.
   */
  const SNAKE_ONLY_LIVE = [
    'profit_fy1', 'profit_fy2', 'profit_fy3',
    'revenue_fy1', 'revenue_fy2', 'revenue_fy3',
    'roe_percentage',
  ] as const;

  const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

  for (const key of SNAKE_ONLY_LIVE) {
    it(`${key} keeps its entry — it is the only one serving a real write path`, () => {
      expect(
        Object.prototype.hasOwnProperty.call(FIELD_PRIORITY_MATRIX, key),
        `${key} carries live consolidated rows and has no camelCase sibling; deleting it drops the field to DEFAULT_RULES`
      ).toBe(true);
      // The premise of the guard: there is genuinely no camelCase sibling, so
      // the snake entry cannot be removed as "redundant".
      expect(Object.prototype.hasOwnProperty.call(FIELD_PRIORITY_MATRIX, toCamel(key))).toBe(false);
      expect(getFieldRules(key).sources).not.toEqual(DEFAULT_SOURCES);
    });
  }
});
