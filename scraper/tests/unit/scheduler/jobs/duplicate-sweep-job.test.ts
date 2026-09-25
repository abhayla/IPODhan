/**
 * T-293F — proves the post-insert duplicate-sweep job computes the right
 * plan for a planted duplicate pair, using the real IC Electricals names
 * from the live-prod recreation the T-293C checker found (finding #5:
 * "IC Electricals Company Ltd" / "IC Electricals Co.Ltd." — two live rows
 * for one company).
 *
 * #1003 (Tier A review of #1001, 2026-09-24): `runDuplicateSweepJob({
 * dryRun: false })` used to APPLY the plan itself with raw SQL — no
 * `checkMergeEligibility` gate and no `ipo_merge_log` row, so a merge it
 * made could not be undone. That apply branch is removed; `dryRun: false`
 * now throws instead of writing. This file's "converges" case (below) is
 * rewritten to assert the REFUSAL, not a raw-SQL write — the plan/report
 * behaviour (dry-run, default) is unchanged and still asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// merge-duplicate-ipos.ts (imported by duplicate-sweep-job.ts for the pure
// clustering helpers) itself imports normalizeCompanyNameForMatching from
// data-persister.js — pulling in the full data-persister module graph. Mock
// its transitive dependencies the same way data-persister's own unit tests
// do, so import succeeds without a real DB/Redis connection.
vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', () => ({
  FieldSourcesRepository: vi.fn(),
  DataConflictsRepository: vi.fn(),
  RegistrarRepository: vi.fn(),
}));

vi.mock('../../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: { ENABLE_DATA_CONSOLIDATION: false, ENABLE_SOURCE_TRACKING: false },
  shouldUseFeature: () => false,
}));

vi.mock('../../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn(),
}));

const executeMock = vi.fn().mockResolvedValue({ rows: [{ n: 0 }] });
const insertValuesMock = vi.fn();
const onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);

const KEEPER = {
  id: 'ic-electricals-keeper-id',
  companyName: 'IC Electricals Company Ltd',
  slug: 'ic-electricals-company-ltd',
  issueSize: '5000',
  lotSize: 1200,
  priceRangeMax: 150,
  registrar: 'Bigshare Services Pvt. Ltd.',
  createdAt: new Date('2026-08-01T00:00:00Z'),
};
const LOSER = {
  id: 'ic-electricals-loser-id',
  companyName: 'IC Electricals Co.Ltd.',
  slug: 'ic-electricals-co-ltd',
  issueSize: null,
  lotSize: null,
  priceRangeMax: null,
  registrar: null,
  createdAt: new Date('2026-08-23T06:30:38Z'),
};
const UNRELATED = {
  id: 'cocoa-traders-id',
  companyName: 'Cocoa Traders Ltd',
  slug: 'cocoa-traders-ltd',
  issueSize: '1000',
  lotSize: 800,
  priceRangeMax: 90,
  registrar: 'KFin Technologies Ltd.',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

let selectRows: any[] = [];

vi.mock('@ipodhan/shared/db', () => ({
  db: {
    select: () => ({ from: () => Promise.resolve(selectRows) }),
    execute: (...args: any[]) => executeMock(...args),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        execute: (...args: any[]) => executeMock(...args),
        insert: () => ({
          values: (...args: any[]) => {
            insertValuesMock(...args);
            return { onConflictDoNothing: (...cArgs: any[]) => onConflictDoNothingMock(...cArgs) };
          },
        }),
      };
      await cb(tx);
    },
  },
}));

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: {},
  ipoSlugRedirects: { oldSlug: 'oldSlug' },
  ipoDemandGraph: {},
}));

const { runDuplicateSweepJob } = await import('../../../../src/scheduler/jobs/duplicate-sweep-job.js');

describe('runDuplicateSweepJob (T-293F — proves convergence, not just wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [{ n: 0 }] });
    onConflictDoNothingMock.mockResolvedValue(undefined);
    selectRows = [KEEPER, LOSER, UNRELATED];
  });

  it('#1003: dryRun:false is refused before any write — the ungated raw-SQL apply path is gone', async () => {
    await expect(runDuplicateSweepJob({ dryRun: false })).rejects.toThrow(/#1003/);

    // No row was read, no write was attempted — the refusal happens before the plan is even built.
    expect(insertValuesMock).not.toHaveBeenCalled();
    const deleteCall = executeMock.mock.calls.find(([q]) => JSON.stringify(q).includes('DELETE FROM ipos'));
    expect(deleteCall).toBeUndefined();

    // MUTATION CHECK: restoring the old raw-SQL apply branch (no throw on
    // `dryRun: false`) makes the `rejects.toThrow` assertion above fail —
    // the promise resolves instead of rejecting.
  });

  it('(c) still computes the right plan for a planted duplicate pair (real IC Electricals names) in dry-run', async () => {
    const result = await runDuplicateSweepJob({ dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.dupClusters).toHaveLength(1);
    const cluster = result.dupClusters[0];
    expect(cluster.keepId).toBe(KEEPER.id);
    expect(cluster.deleteIds).toEqual([LOSER.id]);

    // The unrelated row (Cocoa Traders — a negative-fold case per the
    // normalizer's own tests) must never appear in the plan.
    expect(cluster.deleteIds).not.toContain(UNRELATED.id);
    expect(insertValuesMock).not.toHaveBeenCalled();
    const deleteCall = executeMock.mock.calls.find(([q]) => JSON.stringify(q).includes('DELETE FROM ipos'));
    expect(deleteCall).toBeUndefined();
  });

  it('dry-run (default) computes the same plan but performs no writes', async () => {
    const result = await runDuplicateSweepJob();

    expect(result.applied).toBe(false);
    expect(result.dupClusters).toHaveLength(1);
    expect(result.dupClusters[0].keepId).toBe(KEEPER.id);
    expect(insertValuesMock).not.toHaveBeenCalled();
    const deleteCall = executeMock.mock.calls.find(([q]) => JSON.stringify(q).includes('DELETE FROM ipos'));
    expect(deleteCall).toBeUndefined();
  });
});
