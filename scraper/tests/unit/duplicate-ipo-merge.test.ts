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
  buildProvenanceMap,
  verifyMergeReadback,
  REPOINT_TABLES,
  CARRY_IF_ABSENT_COLUMNS,
  type FkEdge,
  type CarryFieldPatch,
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

  it('OD-69: refuses when open dates differ by one day, whatever the names fold to', () => {
    const result = checkMergeEligibility({ ...base, keepOpenDate: '2026-07-26', dropOpenDate: '2026-07-27' });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/OD-69/);
    expect((result as { reason: string }).reason).toMatch(/1 day\(s\) apart/);
  });

  it('OD-69: refuses the real look-alike spread (Himalayan Solar 2026-09-25 vs Himalaya Nutravedics 2026-09-22), even forced', () => {
    const result = checkMergeEligibility({ ...base, keepOpenDate: '2026-09-25', dropOpenDate: '2026-09-22', forceDifferentName: true });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/3 day\(s\) apart/);
  });

  it('OD-69: refuses differing CIN even when forceDifferentName is set and names fold alike', () => {
    const result = checkMergeEligibility({
      ...base,
      forceDifferentName: true,
      identifiers: [{ column: 'cin', keepValue: 'U11111DL2017PLC000001', dropValue: 'U22222DL2017PLC000002' }],
    });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/cin disagrees/);
  });

  it('OD-69: an identifier that differs only in case/whitespace is the same identifier (no false refusal)', () => {
    const result = checkMergeEligibility({
      ...base,
      identifiers: [{ column: 'symbol', keepValue: 'momsbelief ', dropValue: 'MOMSBELIEF' }],
    });
    expect(result.eligible).toBe(true);
  });

  it('refuses when only one side has a readable open_date', () => {
    const result = checkMergeEligibility({ ...base, dropOpenDate: null });
    expect(result.eligible).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/cannot compare open dates/);
  });

  it('is eligible (falls through to other checks) when NEITHER side has an open_date', () => {
    const result = checkMergeEligibility({ ...base, keepOpenDate: null, dropOpenDate: null });
    expect(result).toEqual({ eligible: true });
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

  // Tier A finding on #672: cube-highways-trust (issue_size 0, symbol NULL) vs
  // cube-highways-trust-cube-highways-trust-invit (issue_size Rs 5,000cr) had nothing to refuse
  // it under the 3-day date tolerance — neither the date check, the name fold, nor the identifier
  // loop (which only fires when BOTH sides carry a value) catches a one-sided-absent identifier.
  describe('issue_size agreement (Tier A finding on #672)', () => {
    it('refuses when both sides carry a non-zero issue_size that differs by more than 1%, naming both values', () => {
      const result = checkMergeEligibility({
        ...base,
        keepIssueSize: '0',
        dropIssueSize: '50000000000',
      });
      // 0 reads as ABSENT, so this pair alone must NOT refuse — the real two-sided-disagreement
      // case is the next assertion.
      expect(result.eligible).toBe(true);

      const disagreeing = checkMergeEligibility({
        ...base,
        keepIssueSize: '1000000000',
        dropIssueSize: '2000000000',
      });
      expect(disagreeing.eligible).toBe(false);
      expect((disagreeing as { reason: string }).reason).toMatch(/issue_size disagrees/);
      expect((disagreeing as { reason: string }).reason).toMatch(/1000000000/);
      expect((disagreeing as { reason: string }).reason).toMatch(/2000000000/);
    });

    it('is eligible when one side is 0 (0 reads as ABSENT, nothing to disagree about)', () => {
      const result = checkMergeEligibility({
        ...base,
        keepIssueSize: '0',
        dropIssueSize: '50000000000',
      });
      expect(result).toEqual({ eligible: true });
    });

    it('is eligible when one side is NULL (absent)', () => {
      const result = checkMergeEligibility({
        ...base,
        keepIssueSize: null,
        dropIssueSize: '50000000000',
      });
      expect(result).toEqual({ eligible: true });
    });

    it('is eligible when both sides carry the same (or near-identical, within 1%) issue_size', () => {
      const exact = checkMergeEligibility({
        ...base,
        keepIssueSize: '1000000000',
        dropIssueSize: '1000000000',
      });
      expect(exact).toEqual({ eligible: true });

      const withinTolerance = checkMergeEligibility({
        ...base,
        keepIssueSize: '1000000000',
        dropIssueSize: '1005000000', // 0.5% apart
      });
      expect(withinTolerance).toEqual({ eligible: true });
    });

    it('is eligible when issue_size differs but --set-issue-size + --issue-size-note were given (acknowledged correction)', () => {
      const result = checkMergeEligibility({
        ...base,
        keepIssueSize: '1000000000',
        dropIssueSize: '2000000000',
        issueSizeCorrectionAcknowledged: true,
      });
      expect(result).toEqual({ eligible: true });
    });
  });

  // #679 (OD-94): offering_type, close_date and listing_date were never compared. The staging pair
  // cube-highways-trust (IPO, 2026-07-19/07-26/07-29) vs cube-highways-trust-cube-highways-trust-invit
  // (INVITS, 2026-07-22/07-24/08-03) was accepted in both directions.
  describe('offering type and close/listing dates (#679, OD-94)', () => {
    const dhanwelRelaunch = { sameShares: true, sameBand: true, sameSymbol: true, sameCin: false, olderPostponed: true };
    const reasonOf = (r: ReturnType<typeof checkMergeEligibility>) => (r as { reason?: string }).reason ?? '';

    it('refuses the real Cube Highways pair in both directions, naming offering_type and both values', () => {
      const cubeIpo = { openDate: '2026-07-19', closeDate: '2026-07-26', listingDate: '2026-07-29', offeringType: 'IPO' };
      const cubeInvit = { openDate: '2026-07-22', closeDate: '2026-07-24', listingDate: '2026-08-03', offeringType: 'INVITS' };
      for (const [k, d] of [[cubeIpo, cubeInvit], [cubeInvit, cubeIpo]] as const) {
        const result = checkMergeEligibility({
          ...base,
          forceDifferentName: true,
          keepOpenDate: k.openDate, dropOpenDate: d.openDate,
          keepCloseDate: k.closeDate, dropCloseDate: d.closeDate,
          keepListingDate: k.listingDate, dropListingDate: d.listingDate,
          keepOfferingType: k.offeringType, dropOfferingType: d.offeringType,
        });
        expect(result.eligible).toBe(false);
        expect(reasonOf(result)).toMatch(/^offering_type disagrees \((IPO vs INVITS|INVITS vs IPO)\)/);
      }
    });

    it('refuses a differing offering_type on the same open date, even as an OD-86 relaunch', () => {
      const result = checkMergeEligibility({
        ...base,
        keepOfferingType: 'IPO', dropOfferingType: 'OFS',
        relaunch: dhanwelRelaunch,
      });
      expect(reasonOf(result)).toMatch(/^offering_type disagrees \(IPO vs OFS\)/);
    });

    it('refuses a differing close_date on the same open date, naming both values', () => {
      const result = checkMergeEligibility({ ...base, keepCloseDate: '2026-09-11', dropCloseDate: '2026-09-12' });
      expect(result.eligible).toBe(false);
      expect(reasonOf(result)).toMatch(/^close_date disagrees \(2026-09-11 vs 2026-09-12\)/);
    });

    it('refuses a differing listing_date on the same open date, naming both values', () => {
      const result = checkMergeEligibility({ ...base, keepListingDate: '2026-09-16', dropListingDate: '2026-09-17' });
      expect(result.eligible).toBe(false);
      expect(reasonOf(result)).toMatch(/^listing_date disagrees \(2026-09-16 vs 2026-09-17\)/);
    });

    it('accepts when one side is empty (absent is not a disagreement) and when the values agree', () => {
      expect(checkMergeEligibility({
        ...base,
        keepOfferingType: 'IPO', dropOfferingType: null,
        keepCloseDate: '2026-09-11', dropCloseDate: null,
        keepListingDate: null, dropListingDate: '2026-09-16',
      })).toEqual({ eligible: true });
      // Rays of Belief shape: same offering, same dates, one row just the -o suffixed page.
      expect(checkMergeEligibility({
        ...base,
        keepOfferingType: 'IPO', dropOfferingType: 'ipo',
        keepCloseDate: '2026-09-11', dropCloseDate: new Date('2026-09-11T00:00:00Z'),
        keepListingDate: '2026-09-16', dropListingDate: '2026-09-16',
      })).toEqual({ eligible: true });
    });

    it('OD-86: a Dhanwel-shaped relaunch with moved close and listing dates is still accepted', () => {
      const result = checkMergeEligibility({
        ...base,
        keepCompanyName: 'Dhanwel Hybrid Seeds Limited', dropCompanyName: 'Dhanwel Hybrid Seeds Ltd',
        keepOpenDate: '2026-08-19', dropOpenDate: '2026-06-23',
        keepCloseDate: '2026-08-21', dropCloseDate: '2026-06-23',
        keepListingDate: '2026-08-26', dropListingDate: '2026-06-26',
        keepOfferingType: 'IPO', dropOfferingType: 'IPO',
        relaunch: dhanwelRelaunch,
      });
      expect(result).toEqual({ eligible: true });
    });

    it('without the relaunch evidence the same moved close date is refused', () => {
      const result = checkMergeEligibility({
        ...base,
        keepCloseDate: '2026-08-21', dropCloseDate: '2026-06-23',
        relaunch: { ...dhanwelRelaunch, olderPostponed: false },
      });
      expect(reasonOf(result)).toMatch(/^close_date disagrees/);
    });
  });
});

describe('buildProvenanceMap (MAJOR-1, PR #433 review)', () => {
  const keepId = 'keep-uuid';
  const dropId = 'drop-uuid';

  it('a keep-side row never becomes the drop provenance for a field', () => {
    // The exact shape of the regression: a query that (by mistake) fetched field_sources rows
    // for BOTH ids, with the keep-side row for `listingDate` appearing AFTER the drop-side row —
    // a naive `new Map(rows.map(...))` would let the later (keep) entry win.
    const rows = [
      { ipoId: dropId, fieldName: 'listingDate', source: 'CHITTORGARH', confidence: 70 },
      { ipoId: keepId, fieldName: 'listingDate', source: 'ADMIN', confidence: 100 },
    ];
    const dropProv = buildProvenanceMap(rows, dropId);
    expect(dropProv.get('listingDate')).toEqual({ ipoId: dropId, fieldName: 'listingDate', source: 'CHITTORGARH', confidence: 70 });
  });

  it('excludes every row not matching the requested ipoId', () => {
    const rows = [
      { ipoId: keepId, fieldName: 'cin', source: 'NSE', confidence: 90 },
      { ipoId: 'some-other-ipo', fieldName: 'cin', source: 'BSE', confidence: 80 },
    ];
    const keepProv = buildProvenanceMap(rows, keepId);
    expect(keepProv.size).toBe(1);
    expect(keepProv.get('cin')?.source).toBe('NSE');
  });

  it('returns an empty map when no row matches the requested ipoId', () => {
    const rows = [{ ipoId: keepId, fieldName: 'cin', source: 'NSE', confidence: 90 }];
    expect(buildProvenanceMap(rows, dropId).size).toBe(0);
  });
});

describe('verifyMergeReadback (MAJOR-2, PR #433 review)', () => {
  const keepId = 'keep-uuid';
  const patch: CarryFieldPatch[] = [
    { column: 'listing_date', value: '2026-09-20', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    { column: 'cin', value: 'U11111MH2020PLC123456', source: 'ADMIN', confidence: 100, note: 'carried' },
  ];

  it('passes every check on a clean post-apply state (real row shape: snake_case keys)', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { listing_date: '2026-09-20', cin: 'U11111MH2020PLC123456' },
      patch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(checks.find((c) => c.name === 'dropped row deleted')?.pass).toBe(true);
  });

  it('fails "dropped row deleted" when the dropped row is still present', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 1,
      survivor: { listingDate: '2026-09-20', cin: 'U11111MH2020PLC123456' },
      patch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'dropped row deleted');
    expect(check?.pass).toBe(false);
    expect(check?.detail).toMatch(/expected 0/);
  });

  it('fails "survivor present" when the survivor row is missing', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: undefined,
      patch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    expect(checks.find((c) => c.name === 'survivor present')?.pass).toBe(false);
  });

  it('fails a carried-field check when the survivor does not actually carry the patched value', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { listing_date: null, cin: 'U11111MH2020PLC123456' },
      patch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field listing_date');
    expect(check?.pass).toBe(false);
  });

  it('fails "slug redirect present" when the redirect row is missing', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { listing_date: '2026-09-20', cin: 'U11111MH2020PLC123456' },
      patch,
      redirectExists: false,
      sameDaySiblingSlugs: [],
      keepId,
    });
    expect(checks.find((c) => c.name === 'slug redirect present')?.pass).toBe(false);
  });

  it('same-day siblings is informational only — never fails the readback', () => {
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { listing_date: '2026-09-20', cin: 'U11111MH2020PLC123456' },
      patch,
      redirectExists: true,
      sameDaySiblingSlugs: ['some-other-ipo-slug'],
      keepId,
    });
    const check = checks.find((c) => c.name === 'same-day siblings (informational)');
    expect(check?.pass).toBe(true);
    expect(check?.detail).toMatch(/some-other-ipo-slug/);
  });

  // DEFECT 1 (2026-09-16 staging dedupe repair): survivor rows come from
  // `db.execute(sql\`select * from ipos ...\`)` in repair-merge-duplicate-ipo.ts,
  // whose row keys are the RAW SNAKE_CASE column names Postgres returns — never
  // camelCase. A survivor object built with camelCase keys (as every other test
  // in this file used) hides the bug; this test uses the real shape.
  it('reads a snake_case survivor row correctly for a multi-word carried column (real row shape)', () => {
    const snakeCasePatch: CarryFieldPatch[] = [
      { column: 'allotment_date', value: '2026-09-20', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { allotment_date: '2026-09-20' },
      patch: snakeCasePatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field allotment_date');
    expect(check?.pass).toBe(true);
  });

  it('still fails a snake_case survivor when the carried value is genuinely missing (positive control)', () => {
    const snakeCasePatch: CarryFieldPatch[] = [
      { column: 'allotment_date', value: '2026-09-20', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { allotment_date: null },
      patch: snakeCasePatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field allotment_date');
    expect(check?.pass).toBe(false);
  });

  // #976, OD-59: agreement is judged on the MEANING of a value, never its
  // text — "10", "10.00" and "₹10" are one value. Real pair from the
  // 2026-09-24 staging Rays of Belief merge: numeric(18,2) issue_size reads
  // back with its column scale ("1250000000.00"), which is not a text match
  // against the carried "1250000000" even though it is the same number.
  it('#976: a numeric field carried as "1250000000" PASSES against a scale-formatted readback "1250000000.00"', () => {
    const numericPatch: CarryFieldPatch[] = [
      { column: 'issue_size', value: '1250000000', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { issue_size: '1250000000.00' },
      patch: numericPatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field issue_size');
    expect(check?.pass).toBe(true);
  });

  it('#976: a numeric field carried as "1250000000" still FAILS against a genuinely different readback "1250000001.00"', () => {
    const numericPatch: CarryFieldPatch[] = [
      { column: 'issue_size', value: '1250000000', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { issue_size: '1250000001.00' },
      patch: numericPatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field issue_size');
    expect(check?.pass).toBe(false);
  });

  it('#976: a date field carried as an ISO calendar day PASSES against a Date-object readback of the same UTC instant', () => {
    const datePatch: CarryFieldPatch[] = [
      { column: 'listing_date', value: '2026-09-04', source: 'CHITTORGARH', confidence: 70, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { listing_date: new Date('2026-09-04T00:00:00Z') },
      patch: datePatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field listing_date');
    expect(check?.pass).toBe(true);
  });

  it('#976: a real string mismatch still fails (not everything becomes equal)', () => {
    const stringPatch: CarryFieldPatch[] = [
      { column: 'cin', value: 'U11111MH2020PLC123456', source: 'ADMIN', confidence: 100, note: 'carried' },
    ];
    const checks = verifyMergeReadback({
      dropRowCount: 0,
      survivor: { cin: 'U99999MH2020PLC999999' },
      patch: stringPatch,
      redirectExists: true,
      sameDaySiblingSlugs: [],
      keepId,
    });
    const check = checks.find((c) => c.name === 'carried field cin');
    expect(check?.pass).toBe(false);
  });
});
