/**
 * Item 3, slice S2 (#731). Unit coverage for the CLI guards and the pure
 * rank-planning logic of `repair-plan-rows-to-manifest-version.ts`. The
 * live database behaviour (real re-rank, SUPPLIED untouched, SME insert) is
 * proven in
 * `scraper/tests/integration/ipo-field-plan-repository.integration.test.ts`
 * ("S2 -- listBelowVersion / updateRanksForVersion") against the REAL
 * repository — this file never re-implements the repository, only the
 * CLI-level guards and the pure resolver-driven plan computation.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  hasFieldPlanSchema,
  planRankUpdate,
  type RankPlan,
} from '../../../scripts/repair-plan-rows-to-manifest-version.js';
import type { PlanRowBelowVersion } from '@ipodhan/shared/repositories';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

describe('parseArgs', () => {
  it('dry run is the default -- apply is false unless --apply is passed', () => {
    expect(parseArgs(['--expect-db', 'ipodhan_staging']).apply).toBe(false);
    expect(parseArgs(['--expect-db', 'ipodhan_staging', '--apply']).apply).toBe(true);
  });

  it('--expect-db is required -- missing it leaves expectDb null', () => {
    expect(parseArgs(['--apply']).expectDb).toBeNull();
  });

  it('reads --expect-db value, never swallowing a following flag as the value', () => {
    expect(parseArgs(['--expect-db', 'ipodhan_test']).expectDb).toBe('ipodhan_test');
    expect(parseArgs(['--expect-db', '--apply']).expectDb).toBeNull();
  });

  it('--allow-prod defaults false', () => {
    expect(parseArgs(['--expect-db', 'ipodhan_staging']).allowProd).toBe(false);
    expect(parseArgs(['--expect-db', 'ipodhan_staging', '--allow-prod']).allowProd).toBe(true);
  });
});

describe('hasFieldPlanSchema -- schema check, never a name check', () => {
  function mockExecute(hasTable: boolean, hasColumn: boolean) {
    let call = 0;
    return vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) return { rows: hasTable ? [{ '?column?': 1 }] : [] };
      return { rows: hasColumn ? [{ '?column?': 1 }] : [] };
    });
  }

  it('MUTATION: table present + column present -> both true', async () => {
    const execute = mockExecute(true, true);
    const result = await hasFieldPlanSchema({ execute });
    expect(result).toEqual({ hasTable: true, hasVersionColumn: true });
  });

  it('MUTATION: refuses when the table does not exist at all (prod pre-#713)', async () => {
    const execute = mockExecute(false, false);
    const result = await hasFieldPlanSchema({ execute });
    expect(result.hasTable).toBe(false);
    expect(result.hasVersionColumn).toBe(false);
    // Only ONE query is run when the table itself is absent -- the column
    // probe never fires (would be a wasted query against a table that
    // doesn't exist, and on some Postgres configurations could error).
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('MUTATION: table exists but manifest_version column is missing -> refused', async () => {
    const execute = mockExecute(true, false);
    const result = await hasFieldPlanSchema({ execute });
    expect(result.hasTable).toBe(true);
    expect(result.hasVersionColumn).toBe(false);
  });
});

describe('planRankUpdate -- pure resolver-driven plan, no database', () => {
  const manifest = loadFieldManifest();
  const currentVersion = manifest.version;

  function row(overrides: Partial<PlanRowBelowVersion> = {}): PlanRowBelowVersion {
    return {
      id: 'row-1',
      ipoId: 'ipo-1',
      tableName: 'ipo_details',
      rowKey: '',
      fieldName: 'face_value',
      rank1Source: 'DOC',
      rank2Source: 'BSE',
      rank3Source: null,
      state: 'PENDING',
      manifestVersion: 1,
      policyOrigin: 'registry:1',
      ipoSlug: 'fixture-ipo',
      ipoName: 'Fixture IPO Ltd.',
      ipoSegment: 'SME',
      ipoListingExchanges: ['NSE'],
      ...overrides,
    };
  }

  it('MUTATION: an SME_NSE row with a stale BSE rank2 is re-ranked to the current SME_NSE policy (DOC, CHITTORGARH, null)', () => {
    const plan = planRankUpdate(row(), currentVersion, manifest);
    expect(plan.afterRank1).toBe('DOC');
    expect(plan.afterRank2).toBe('CHITTORGARH');
    expect(plan.afterRank3).toBeNull();
    expect(plan.afterVersion).toBe(currentVersion);
    expect(plan.changed).toBe(true);
    expect(plan.afterPolicyOrigin).toBe(`registry:${currentVersion}`);
  });

  it('MUTATION: a MAINBOARD row already matching the current policy is unchanged (changed=false)', () => {
    const ipoType = 'MAINBOARD';
    const manifestEntry = manifest.fields['ipo_details.face_value'];
    const ranks = manifestEntry.rank[ipoType]!;
    const already = row({
      tableName: 'ipo_details',
      fieldName: 'face_value',
      rank1Source: ranks[0] ?? null,
      rank2Source: ranks[1] ?? null,
      rank3Source: ranks[2] ?? null,
      manifestVersion: currentVersion,
      ipoSegment: null,
      ipoListingExchanges: null,
    });
    const plan = planRankUpdate(already, currentVersion, manifest);
    expect(plan.changed).toBe(false);
    expect(plan.afterRank1).toBe(already.rank1Source);
    expect(plan.afterRank2).toBe(already.rank2Source);
  });

  it('MUTATION: a version bump alone (same ranks, older manifestVersion) still counts as changed', () => {
    const ipoType = 'MAINBOARD';
    const manifestEntry = manifest.fields['ipo_details.face_value'];
    const ranks = manifestEntry.rank[ipoType]!;
    const staleVersionOnly = row({
      rank1Source: ranks[0] ?? null,
      rank2Source: ranks[1] ?? null,
      rank3Source: ranks[2] ?? null,
      manifestVersion: currentVersion - 1,
      ipoSegment: null,
      ipoListingExchanges: null,
    });
    const plan = planRankUpdate(staleVersionOnly, currentVersion, manifest);
    expect(plan.changed).toBe(true);
    expect(plan.afterVersion).toBe(currentVersion);
  });

  it('does not throw for an SME_BSE row (no listingExchanges -> defaults to SME_BSE, never MAINBOARD)', () => {
    const plan = planRankUpdate(row({ ipoSegment: 'SME', ipoListingExchanges: null }), currentVersion, manifest);
    expect(plan.afterRank1).not.toBeNull();
  });
});

describe('RankPlan shape sanity (compile-time contract, exercised at runtime)', () => {
  it('a RankPlan always carries an identity, never only a count (signal-ownership R1)', () => {
    const manifest = loadFieldManifest();
    const r: PlanRowBelowVersion = {
      id: 'row-x',
      ipoId: 'ipo-x',
      tableName: 'ipo_details',
      rowKey: '',
      fieldName: 'face_value',
      rank1Source: 'DOC',
      rank2Source: 'BSE',
      rank3Source: null,
      state: 'PENDING',
      manifestVersion: 1,
      policyOrigin: 'registry:1',
      ipoSlug: 'x-ipo',
      ipoName: null,
      ipoSegment: null,
      ipoListingExchanges: null,
    };
    const plan: RankPlan = planRankUpdate(r, manifest.version, manifest);
    expect(plan.ipoSlug).toBe('x-ipo');
    expect(plan.tableName).toBe('ipo_details');
    expect(plan.fieldName).toBe('face_value');
  });
});
