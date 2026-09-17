/**
 * Item 3, slice S2 (#731). Unit coverage for the CLI guards and the pure
 * rank-planning logic of `repair-plan-rows-to-manifest-version.ts`. The
 * live database behaviour (real re-rank, SUPPLIED untouched, SME insert) is
 * proven in
 * `scraper/tests/integration/ipo-field-plan-repository.integration.test.ts`
 * ("S2 -- listBelowVersion / updateRanksForVersion") against the REAL
 * repository — this file never re-implements the repository, only the
 * CLI-level guards and the pure resolver-driven plan computation.
 *
 * CRITICAL-1 fix (independent Tier A review): `describe('run -- CLI guards,
 * mutation-tested')` below drives the real `run()` -- the function `main()`
 * now delegates to -- through an injected fake db/repo. Every guard
 * mutation named in the review (dry-run `if (!cli.apply)`, the
 * `--expect-db` comparison + required-check, the schema-check refusal) is
 * asserted to make a specific test red when deleted; run each mutation by
 * hand in a scratch copy to confirm (see the PR body for the five captured
 * RED lines).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  hasFieldPlanSchema,
  planRankUpdate,
  computeMissingRowsForIpo,
  isInsertEligible,
  run,
  type RankPlan,
  type RunDeps,
  type Cli,
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

  it('--no-insert defaults false (CRITICAL-2: rank-only mode)', () => {
    expect(parseArgs(['--expect-db', 'ipodhan_staging']).noInsert).toBe(false);
    expect(parseArgs(['--expect-db', 'ipodhan_staging', '--no-insert']).noInsert).toBe(true);
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
      ipoStatus: 'OPEN',
      ipoListingDate: null,
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
      ipoStatus: 'OPEN',
      ipoListingDate: null,
    };
    const plan: RankPlan = planRankUpdate(r, manifest.version, manifest);
    expect(plan.ipoSlug).toBe('x-ipo');
    expect(plan.tableName).toBe('ipo_details');
    expect(plan.fieldName).toBe('face_value');
  });
});

describe('isInsertEligible -- CRITICAL-2, reuses isInLiveWindow, never re-implements it', () => {
  it('UPCOMING/OPEN/CLOSED are eligible', () => {
    expect(isInsertEligible('UPCOMING', null)).toBe(true);
    expect(isInsertEligible('OPEN', null)).toBe(true);
    expect(isInsertEligible('CLOSED', null)).toBe(true);
  });

  it('LISTED within the live window is eligible; LISTED long past it is not', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    const recentlyListed = new Date('2026-09-10T00:00:00Z');
    const longAgoListed = new Date('2026-01-01T00:00:00Z');
    expect(isInsertEligible('LISTED', recentlyListed, now)).toBe(true);
    expect(isInsertEligible('LISTED', longAgoListed, now)).toBe(false);
  });

  it('WITHDRAWN / POSTPONED are never insert-eligible', () => {
    expect(isInsertEligible('WITHDRAWN', null)).toBe(false);
    expect(isInsertEligible('POSTPONED', null)).toBe(false);
  });
});

describe('computeMissingRowsForIpo -- MAJOR-5, key shape must match the build side exactly', () => {
  const manifest = loadFieldManifest();

  it('a field already present at rowKey "" is never re-planned', () => {
    const existingKeys = new Set(['ipo_details::::face_value']);
    const missing = computeMissingRowsForIpo('ipo-1', 'slug-1', 'MAINBOARD', existingKeys, manifest);
    expect(missing.some((m) => m.tableName === 'ipo_details' && m.fieldName === 'face_value')).toBe(false);
  });

  it('MUTATION (MAJOR-5 regression guard): a row that only exists under a NON-empty row_key is still treated as missing at rowKey "" -- the tool never mistakes a child-table sibling for coverage of its own key', () => {
    // Simulates the pre-fix bug: existingKeys built with the REAL row_key
    // ("row-abc") would never satisfy a lookup key hardcoded to "" -- so the
    // tool would (before the fix) re-plan a field at '' that already has
    // coverage under a different row_key, creating a duplicate the
    // ON_CONFLICT target (ipo_id, table_name, row_key, field_name) cannot
    // catch (row_key differs). This test locks in that computeMissingRowsForIpo
    // returns a row for that field key -- the row that SHOULD have been
    // withheld once the tool is correctly given the existing row's key.
    const existingKeys = new Set(['ipo_details::row-abc::face_value']);
    const missing = computeMissingRowsForIpo('ipo-1', 'slug-1', 'MAINBOARD', existingKeys, manifest);
    // At rowKey '' this field key ('ipo_details::::face_value') is NOT in the
    // set built from the real row_key -- computeMissingRowsForIpo correctly
    // reports it as missing at '' (a real gap at rowKey ''), proving the
    // lookup key matches the build key exactly (both use the literal '').
    expect(missing.some((m) => m.tableName === 'ipo_details' && m.fieldName === 'face_value')).toBe(true);
  });
});

describe('run -- CLI guards, mutation-tested (CRITICAL-1)', () => {
  const manifest = loadFieldManifest();

  function baseCli(overrides: Partial<Cli> = {}): Cli {
    return { apply: false, allowProd: false, expectDb: 'ipodhan_test', noInsert: false, ...overrides };
  }

  // A drizzle `sql\`...\`` template does not stringify usefully via String()
  // (`[object Object]`) -- its literal text lives in `.queryChunks[].value`.
  function sqlText(q: unknown): string {
    const chunks = (q as { queryChunks?: { value?: unknown[] }[] })?.queryChunks ?? [];
    return chunks.map((c) => (Array.isArray(c?.value) ? c.value.join('') : '')).join(' ');
  }

  function fakeDb(currentDatabase: string, schema: { hasTable: boolean; hasColumn: boolean } = { hasTable: true, hasColumn: true }) {
    return {
      execute: vi.fn().mockImplementation(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('current_database')) return { rows: [{ name: currentDatabase }] };
        if (text.includes('information_schema.tables')) return { rows: schema.hasTable ? [{ x: 1 }] : [] };
        if (text.includes('information_schema.columns')) return { rows: schema.hasColumn ? [{ x: 1 }] : [] };
        return { rows: [] };
      }),
    };
  }

  const noRepo = {
    listBelowVersion: vi.fn(async () => {
      throw new Error('listBelowVersion must never be called when a guard refuses first');
    }),
    updateRanksForVersion: vi.fn(async () => {
      throw new Error('updateRanksForVersion must never be called on a guard refusal or dry run');
    }),
    upsertGeneratedRows: vi.fn(async () => {
      throw new Error('upsertGeneratedRows must never be called on a guard refusal or dry run');
    }),
  };

  function baseDeps(overrides: Partial<RunDeps> = {}): RunDeps {
    return {
      cli: baseCli(),
      dbLike: fakeDb('ipodhan_test') as never,
      repo: noRepo as never,
      loadManifest: () => manifest,
      readExistingKeysForIpo: vi.fn(async () => []),
      logger: { log: () => {}, error: () => {} },
      ...overrides,
    };
  }

  it('MUTATION D2.1: no --expect-db refuses, exit non-zero, nothing read or written', async () => {
    const deps = baseDeps({ cli: baseCli({ expectDb: null }) });
    const result = await run(deps);
    expect(result.exitCode).not.toBe(0);
    expect(result.refusedAt).toBe('no-expect-db');
    expect(result.wrote).toBe(false);
    expect((deps.dbLike as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
    expect(noRepo.listBelowVersion).not.toHaveBeenCalled();
  });

  it('MUTATION D2.2: --expect-db naming a different database than current_database() refuses BEFORE any read or write', async () => {
    const deps = baseDeps({
      cli: baseCli({ expectDb: 'ipodhan_staging' }),
      dbLike: fakeDb('ipodhan_test') as never,
    });
    const result = await run(deps);
    expect(result.exitCode).not.toBe(0);
    expect(result.refusedAt).toBe('db-mismatch');
    expect(result.wrote).toBe(false);
    expect(noRepo.listBelowVersion).not.toHaveBeenCalled();
  });

  it('MUTATION D2.3: schema check failing (no ipo_field_plan table) refuses', async () => {
    const deps = baseDeps({ dbLike: fakeDb('ipodhan_test', { hasTable: false, hasColumn: false }) as never });
    const result = await run(deps);
    expect(result.exitCode).not.toBe(0);
    expect(result.refusedAt).toBe('schema-check');
    expect(noRepo.listBelowVersion).not.toHaveBeenCalled();
  });

  it('MUTATION D2.4: schema check failing (table present, manifest_version column missing) refuses', async () => {
    const deps = baseDeps({ dbLike: fakeDb('ipodhan_test', { hasTable: true, hasColumn: false }) as never });
    const result = await run(deps);
    expect(result.exitCode).not.toBe(0);
    expect(result.refusedAt).toBe('schema-check');
  });

  it('MUTATION D2.5: prod database without --allow-prod refuses (via openRepairDb)', async () => {
    const listBelowVersion = vi.fn(async () => [] as PlanRowBelowVersion[]);
    const deps = baseDeps({
      cli: baseCli({ expectDb: 'ipodhan', apply: true, allowProd: false }),
      dbLike: fakeDb('ipodhan') as never,
      repo: { ...noRepo, listBelowVersion } as never,
    });
    const result = await run(deps);
    expect(result.exitCode).not.toBe(0);
    expect(result.refusedAt).toBe('prod-guard');
    expect(result.wrote).toBe(false);
  });

  function stalePendingRow(overrides: Partial<PlanRowBelowVersion> = {}): PlanRowBelowVersion {
    return {
      id: 'row-1',
      ipoId: 'ipo-1',
      tableName: 'ipo_details',
      rowKey: '',
      fieldName: 'face_value',
      rank1Source: 'STALE',
      rank2Source: null,
      rank3Source: null,
      state: 'PENDING',
      manifestVersion: manifest.version - 1,
      policyOrigin: 'registry:1',
      ipoSlug: 'fixture-ipo',
      ipoName: 'Fixture IPO Ltd.',
      ipoSegment: 'MAINBOARD',
      ipoListingExchanges: ['NSE'],
      ipoStatus: 'OPEN',
      ipoListingDate: null,
      ...overrides,
    };
  }

  it('MUTATION D2.6: dry run (no --apply) writes nothing -- assert the WRITE METHODS were never called, not just the printed text', async () => {
    const updateRanksForVersion = vi.fn(async () => ({ updated: 1 }));
    const upsertGeneratedRows = vi.fn(async () => ({ inserted: 1 }));
    const deps = baseDeps({
      cli: baseCli({ apply: false }),
      repo: {
        listBelowVersion: vi.fn(async () => [stalePendingRow()]),
        updateRanksForVersion,
        upsertGeneratedRows,
      } as never,
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(result.wrote).toBe(false);
    expect(updateRanksForVersion).not.toHaveBeenCalled();
    expect(upsertGeneratedRows).not.toHaveBeenCalled();
  });

  it('--apply actually calls the write methods (contrast case for D2.6)', async () => {
    const updateRanksForVersion = vi.fn(async () => ({ updated: 1 }));
    const upsertGeneratedRows = vi.fn(async () => ({ inserted: 0 }));
    const deps = baseDeps({
      cli: baseCli({ apply: true }),
      repo: {
        listBelowVersion: vi.fn(async () => [stalePendingRow()]),
        updateRanksForVersion,
        upsertGeneratedRows,
      } as never,
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(result.wrote).toBe(true);
    expect(updateRanksForVersion).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL-2: an out-of-window IPO (LISTED long ago) with a stale row gets its ranks fixed and NO rows inserted for it', async () => {
    const oldListed = stalePendingRow({
      ipoId: 'ipo-old',
      ipoStatus: 'LISTED',
      ipoListingDate: new Date('2020-01-01T00:00:00Z'),
    });
    const updateRanksForVersion = vi.fn(async () => ({ updated: 1 }));
    const upsertGeneratedRows = vi.fn(async () => ({ inserted: 0 }));
    const readExistingKeysForIpo = vi.fn(async () => []);
    const deps = baseDeps({
      cli: baseCli({ apply: true }),
      repo: { listBelowVersion: vi.fn(async () => [oldListed]), updateRanksForVersion, upsertGeneratedRows } as never,
      readExistingKeysForIpo,
      now: new Date('2026-09-18T00:00:00Z'),
    });
    const result = await run(deps);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.skippedOutOfWindowIpoCount).toBe(1);
    expect(result.eligibleIpoCount).toBe(0);
    // The insert phase for an out-of-window IPO never even probes existing
    // keys -- it is excluded before the missing-row computation runs.
    expect(readExistingKeysForIpo).not.toHaveBeenCalled();
  });

  it('--no-insert: an eligible IPO with a stale row is rank-fixed but nothing is inserted, even though it would otherwise be eligible', async () => {
    const eligible = stalePendingRow({ ipoStatus: 'OPEN' });
    const updateRanksForVersion = vi.fn(async () => ({ updated: 1 }));
    const upsertGeneratedRows = vi.fn(async () => ({ inserted: 0 }));
    const deps = baseDeps({
      cli: baseCli({ apply: true, noInsert: true }),
      repo: { listBelowVersion: vi.fn(async () => [eligible]), updateRanksForVersion, upsertGeneratedRows } as never,
    });
    const result = await run(deps);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(upsertGeneratedRows).not.toHaveBeenCalled();
  });
});
