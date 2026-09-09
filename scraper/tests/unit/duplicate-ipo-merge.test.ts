/**
 * Unit tests for the pure duplicate-IPO-merge helpers
 * (packages/shared/src/utils/duplicate-ipo-merge.ts), which back
 * `IPORepository.mergeDuplicateInto` and the F-55 repair class
 * (`scraper/scripts/repair-merge-duplicate-ipo.ts`).
 *
 * These are unit-tier on purpose: child-table discovery/ordering and
 * eligibility checks are computed from data already fetched — no DB, no
 * Redis. The DB-touching parts (fetching real information_schema FK rows,
 * writing the merge) are exercised by the integration test in this same
 * directory's sibling (`duplicate-ipo-merge.integration.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import {
  foldCompanyName,
  columnToCamelCase,
  discoverDescendants,
  reverseDependencyOrder,
  planDescendantTables,
  planCarryFields,
  checkMergeEligibility,
  REPOINT_TABLES,
  CARRY_IF_ABSENT_COLUMNS,
  type FkEdge,
} from '@ipodhan/shared/utils/duplicate-ipo-merge';

describe('foldCompanyName', () => {
  it('folds "Company" and "Co." to the same string (the F-55 gap)', () => {
    expect(foldCompanyName('Asset Reconstruction Company (India) Limited')).toBe(
      foldCompanyName('Asset Reconstruction Co. (India) Ltd')
    );
  });

  it('strips corporate-form words and punctuation', () => {
    expect(foldCompanyName('The XYZ Corporation Pvt. Ltd.')).toBe('xyz');
  });

  it('treats null/undefined as empty', () => {
    expect(foldCompanyName(null)).toBe('');
    expect(foldCompanyName(undefined)).toBe('');
  });

  it('does NOT fold two genuinely different company names to the same string', () => {
    expect(foldCompanyName('Alpha Industries Limited')).not.toBe(foldCompanyName('Beta Industries Limited'));
  });
});

describe('columnToCamelCase', () => {
  it('converts snake_case DB columns to the camelCase field_sources.field_name', () => {
    expect(columnToCamelCase('bse_ipo_no')).toBe('bseIpoNo');
    expect(columnToCamelCase('listing_date')).toBe('listingDate');
    expect(columnToCamelCase('cin')).toBe('cin');
  });
});

describe('discoverDescendants / reverseDependencyOrder', () => {
  const fks: FkEdge[] = [
    { child: 'subscriptions', col: 'ipo_id', parent: 'ipos' },
    { child: 'gmp_records', col: 'ipo_id', parent: 'ipos' },
    { child: 'documents', col: 'ipo_id', parent: 'ipos' },
    { child: 'document_fetch_state', col: 'document_id', parent: 'documents' }, // grandchild
    { child: 'ipo_details', col: 'ipo_id', parent: 'ipos' },
    { child: 'ipo_scores', col: 'ipo_id', parent: 'ipos' },
    { child: 'score_history', col: 'score_id', parent: 'ipo_scores' }, // grandchild
    { child: 'brlm_track_record', col: 'source_ipo_id', parent: 'ipos' }, // non-standard FK column name
  ];

  it('discovers every table reachable from ipos, including grandchildren', () => {
    const reach = discoverDescendants(fks);
    expect([...reach.keys()].sort()).toEqual(
      [
        'subscriptions',
        'gmp_records',
        'documents',
        'document_fetch_state',
        'ipo_details',
        'ipo_scores',
        'score_history',
        'brlm_track_record',
      ].sort()
    );
    // A grandchild table's FK column is recorded correctly, not assumed to be ipo_id.
    expect(reach.get('document_fetch_state')).toEqual({ col: 'document_id', parent: 'documents' });
    expect(reach.get('brlm_track_record')).toEqual({ col: 'source_ipo_id', parent: 'ipos' });
  });

  it('never treats a self-referencing FK as its own child', () => {
    const selfRefFks: FkEdge[] = [
      { child: 'ipos', col: 'parent_ipo_id', parent: 'ipos' },
      { child: 'subscriptions', col: 'ipo_id', parent: 'ipos' },
    ];
    const reach = discoverDescendants(selfRefFks);
    expect(reach.has('ipos')).toBe(false);
    expect(reach.has('subscriptions')).toBe(true);
  });

  it('orders a grandchild BEFORE its parent (reverse-dependency order)', () => {
    const reach = discoverDescendants(fks);
    const order = reverseDependencyOrder(reach, fks);
    expect(order.indexOf('document_fetch_state')).toBeLessThan(order.indexOf('documents'));
    expect(order.indexOf('score_history')).toBeLessThan(order.indexOf('ipo_scores'));
  });

  it('planDescendantTables splits direct (parent === ipos) from all descendants', () => {
    const { reach, order, direct } = planDescendantTables(fks);
    expect(reach.size).toBe(8);
    expect(order.length).toBe(8);
    expect(direct.sort()).toEqual(
      ['subscriptions', 'gmp_records', 'documents', 'ipo_details', 'ipo_scores', 'brlm_track_record'].sort()
    );
    expect(direct).not.toContain('document_fetch_state');
    expect(direct).not.toContain('score_history');
  });
});

describe('REPOINT_TABLES', () => {
  it('classifies person-created tables as repoint, not delete', () => {
    expect(REPOINT_TABLES.has('user_watchlist')).toBe(true);
    expect(REPOINT_TABLES.has('affiliate_clicks')).toBe(true);
    expect(REPOINT_TABLES.has('brlm_track_record')).toBe(true);
    expect(REPOINT_TABLES.has('subscriptions')).toBe(false);
    expect(REPOINT_TABLES.has('gmp_records')).toBe(false);
  });
});

describe('planCarryFields', () => {
  it('carries a column ONLY when the survivor is absent and the dropped row has a value', () => {
    const patch = planCarryFields(
      [
        { column: 'cin', keepValue: null, dropValue: 'U12345', dropProvenance: { fieldName: 'cin', source: 'NSE', confidence: 90 } },
        { column: 'symbol', keepValue: 'EXISTING', dropValue: 'OTHER', dropProvenance: undefined },
        { column: 'isin', keepValue: null, dropValue: null, dropProvenance: undefined },
      ],
      'drop-id-1'
    );
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ column: 'cin', value: 'U12345', source: 'NSE', confidence: 90 });
    expect(patch[0].note).toContain('drop-id-1');
  });

  it('defaults to ADMIN/100 when the dropped row has no provenance for the field', () => {
    const patch = planCarryFields(
      [{ column: 'sector', keepValue: undefined, dropValue: 'Finance', dropProvenance: undefined }],
      'drop-id-2'
    );
    expect(patch[0]).toMatchObject({ source: 'ADMIN', confidence: 100 });
  });

  it('carries every eligible column in CARRY_IF_ABSENT_COLUMNS, not a truncated subset', () => {
    const inputs = CARRY_IF_ABSENT_COLUMNS.map((column) => ({
      column,
      keepValue: null,
      dropValue: 'x',
      dropProvenance: undefined,
    }));
    const patch = planCarryFields(inputs, 'drop-id-3');
    expect(patch).toHaveLength(CARRY_IF_ABSENT_COLUMNS.length);
  });
});

describe('checkMergeEligibility', () => {
  const base = {
    keepOpenDate: '2026-09-09',
    dropOpenDate: '2026-09-09',
    keepCompanyName: 'Asset Reconstruction Company (India) Limited',
    dropCompanyName: 'Asset Reconstruction Co. (India) Ltd',
    forceDifferentName: false,
    identifiers: [],
  };

  it('is eligible when open dates match and names fold to the same string', () => {
    expect(checkMergeEligibility(base)).toEqual({ eligible: true });
  });

  it('refuses when open dates differ (two different offers)', () => {
    const result = checkMergeEligibility({ ...base, dropOpenDate: '2026-09-10' });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/open on different dates/);
  });

  it('refuses when names do not fold to the same string, unless forced', () => {
    const differentNames = { ...base, dropCompanyName: 'Totally Different Company Limited' };
    const refused = checkMergeEligibility(differentNames);
    expect(refused.eligible).toBe(false);

    const forced = checkMergeEligibility({ ...differentNames, forceDifferentName: true });
    expect(forced.eligible).toBe(true);
  });

  it('refuses when a strong identifier disagrees between the two rows', () => {
    const result = checkMergeEligibility({
      ...base,
      identifiers: [{ column: 'cin', keepValue: 'U11111', dropValue: 'U22222' }],
    });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/cin disagrees/);
  });

  it('does NOT refuse when an identifier is present on only one side (normal duplicate shape)', () => {
    const result = checkMergeEligibility({
      ...base,
      identifiers: [{ column: 'cin', keepValue: null, dropValue: 'U22222' }],
    });
    expect(result.eligible).toBe(true);
  });

  it('does NOT refuse when identifiers agree', () => {
    const result = checkMergeEligibility({
      ...base,
      identifiers: [{ column: 'cin', keepValue: 'U11111', dropValue: 'U11111' }],
    });
    expect(result.eligible).toBe(true);
  });
});
