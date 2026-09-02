/**
 * S-01 — ipo_pipeline_steps repository tests.
 *
 * Covers the upsert transition rules the ledger's usefulness depends on:
 * attempts counting (a FAILED step, and a RUNNING -> DONE completion),
 * error clearing on DONE, last_run_at only on terminal statuses, and an
 * idempotent initForIpo that creates exactly one row per catalogue step.
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape) so
 * these stay unit tests -- no Postgres, no Redis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpoPipelineStepsRepository } from './ipo-pipeline-steps-repository';
import { PIPELINE_STEPS } from '../pipeline/step-catalogue';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

/** Captures what the repository asked the db to write. */
interface DbCalls {
  insertValues: any[];
  conflictSets: any[];
  selectResults: any[][];
}

function makeDb(selectResults: any[][] = [[]], returning: any = { id: 'row-1' }) {
  const calls: DbCalls = { insertValues: [], conflictSets: [], selectResults };
  let selectIdx = 0;

  const selectChain = () => {
    const result = selectResults[Math.min(selectIdx++, selectResults.length - 1)] ?? [];
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };

  const db: any = {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => {
      const chain: any = {
        values: (v: any) => {
          calls.insertValues.push(v);
          return chain;
        },
        onConflictDoUpdate: (cfg: any) => {
          calls.conflictSets.push(cfg.set);
          return chain;
        },
        onConflictDoNothing: () => chain,
        returning: () => Promise.resolve([returning]),
        then: (resolve: any, reject: any) =>
          Promise.resolve([returning]).then(resolve, reject),
      };
      return chain;
    }),
  };

  return { db, calls };
}

function makeRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  } as any;
}

function makeRepo(selectResults?: any[][]) {
  const { db, calls } = makeDb(selectResults);
  const redis = makeRedis();
  return { repo: new IpoPipelineStepsRepository(db, redis), calls, redis, db };
}

describe('IpoPipelineStepsRepository.upsertStep — attempts', () => {
  it('increments attempts when the new status is FAILED', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 2, status: 'RUNNING' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'FAILED', error: 'boom' });

    expect(calls.conflictSets[0].attempts).toBe(3);
  });

  it('increments attempts on a RUNNING -> DONE completion', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 1, status: 'RUNNING' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(calls.conflictSets[0].attempts).toBe(2);
  });

  it('does NOT increment attempts on a DUE -> DONE transition', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 4, status: 'DUE' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(calls.conflictSets[0].attempts).toBe(4);
  });

  it('does NOT increment attempts when merely marking a step RUNNING', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 0, status: 'DUE' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C1', status: 'RUNNING' });

    expect(calls.conflictSets[0].attempts).toBe(0);
  });

  it('starts a first-ever FAILED row at attempts = 1', async () => {
    const { repo, calls } = makeRepo([[]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C3', status: 'FAILED', error: 'x' });

    expect(calls.insertValues[0].attempts).toBe(1);
  });
});

describe('IpoPipelineStepsRepository.upsertStep — error and timestamps', () => {
  it('clears the error on DONE even when a previous error is stored', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 1, status: 'FAILED', error: 'old' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'DONE' });

    expect(calls.conflictSets[0].error).toBeNull();
  });

  it('keeps the supplied error on FAILED', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 0, status: 'DUE' }]]);

    await repo.upsertStep({
      ipoId: IPO_ID,
      stepId: 'B7',
      status: 'FAILED',
      error: 'W-16/W-17/W-18 open',
    });

    expect(calls.conflictSets[0].error).toBe('W-16/W-17/W-18 open');
  });

  it('sets last_run_at on a terminal status', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 0, status: 'RUNNING' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(calls.conflictSets[0].lastRunAt).toBeInstanceOf(Date);
  });

  it('does NOT set last_run_at on a non-terminal status', async () => {
    const { repo, calls } = makeRepo([[{ id: 'r', attempts: 0, status: 'NOT_DUE' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'RUNNING' });

    expect(calls.conflictSets[0].lastRunAt).toBeUndefined();
  });

  it('rejects a step id that is not in the catalogue', async () => {
    const { repo } = makeRepo([[]]);

    await expect(
      repo.upsertStep({ ipoId: IPO_ID, stepId: 'Z9', status: 'DONE' })
    ).rejects.toThrow(/Z9/);
  });

  it('invalidates the IPO grid cache after an upsert', async () => {
    const { repo, redis } = makeRepo([[{ id: 'r', attempts: 0, status: 'DUE' }]]);

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(redis.del).toHaveBeenCalled();
  });
});

describe('IpoPipelineStepsRepository.initForIpo', () => {
  it('creates one NOT_DUE row per catalogue step in a single insert', async () => {
    const { repo, calls, db } = makeRepo([[]]);

    await repo.initForIpo(IPO_ID);

    expect(db.insert).toHaveBeenCalledTimes(1);
    const rows = calls.insertValues[0];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(PIPELINE_STEPS.length);
    expect(rows.every((r: any) => r.status === 'NOT_DUE')).toBe(true);
    expect(new Set(rows.map((r: any) => r.stepId)).size).toBe(PIPELINE_STEPS.length);
  });

  it('is idempotent — a second init does not overwrite existing rows', async () => {
    const { repo, calls } = makeRepo([[]]);

    await repo.initForIpo(IPO_ID);
    await repo.initForIpo(IPO_ID);

    // onConflictDoNothing, never onConflictDoUpdate: existing statuses survive.
    expect(calls.conflictSets).toHaveLength(0);
  });
});
