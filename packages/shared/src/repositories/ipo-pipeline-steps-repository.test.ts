/**
 * S-01 — ipo_pipeline_steps repository tests.
 *
 * Covers the upsert rules the ledger's usefulness depends on: attempts counted
 * in SQL (never read-then-write), partial updates that cannot wipe stored
 * provenance, error clearing on DONE, last_run_at only on terminal statuses,
 * enum-derived stage validation, and an idempotent initForIpo that creates
 * exactly one row per catalogue step.
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape) so
 * these stay unit tests -- no Postgres, no Redis.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  IpoPipelineStepsRepository,
  PIPELINE_STAGES,
  resolveAttemptsRule,
  resolveStageFilter,
} from './ipo-pipeline-steps-repository';
import { PIPELINE_STEPS } from '../pipeline/step-catalogue';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

/** Captures what the repository asked the db to write. */
interface DbCalls {
  insertValues: any[];
  conflictSets: any[];
  /** How many times the builder chose ON CONFLICT DO NOTHING. */
  conflictDoNothing: number;
  /** Every argument handed to .where() / .orderBy(), in call order. */
  whereArgs: any[];
  orderByArgs: any[][];
  selectResults: any[][];
}

function makeDb(selectResults: any[][] = [[]], returning: any = { id: 'row-1' }) {
  const calls: DbCalls = {
    insertValues: [],
    conflictSets: [],
    conflictDoNothing: 0,
    whereArgs: [],
    orderByArgs: [],
    selectResults,
  };
  let selectIdx = 0;

  const selectChain = () => {
    const result = selectResults[Math.min(selectIdx++, selectResults.length - 1)] ?? [];
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (w: any) => {
        calls.whereArgs.push(w);
        return chain;
      },
      orderBy: (...args: any[]) => {
        calls.orderByArgs.push(args);
        return chain;
      },
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
        onConflictDoNothing: () => {
          calls.conflictDoNothing += 1;
          return chain;
        },
        returning: () => Promise.resolve([returning]),
        then: (resolve: any, reject: any) => Promise.resolve([returning]).then(resolve, reject),
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

describe('resolveAttemptsRule', () => {
  it('increments on FAILED', () => {
    expect(resolveAttemptsRule('FAILED')).toBe('increment');
  });

  it('increments only from RUNNING on DONE', () => {
    expect(resolveAttemptsRule('DONE')).toBe('increment-if-running');
  });

  it('increments on BLOCKED — a spent retry budget is a finished failed attempt', () => {
    expect(resolveAttemptsRule('BLOCKED')).toBe('increment');
  });

  it('leaves attempts alone for SKIPPED and NOT_AVAILABLE_YET — nothing was attempted', () => {
    expect(resolveAttemptsRule('SKIPPED')).toBe('leave');
    expect(resolveAttemptsRule('NOT_AVAILABLE_YET')).toBe('leave');
  });

  it('leaves attempts alone for every non-finishing status', () => {
    const nonFinishing = ['NOT_DUE', 'DUE', 'RUNNING', 'SKIPPED', 'NOT_AVAILABLE_YET'] as const;
    for (const status of nonFinishing) {
      expect(resolveAttemptsRule(status)).toBe('leave');
    }
  });
});

describe('resolveStageFilter', () => {
  it('accepts every real ipo_status value', () => {
    expect(PIPELINE_STAGES.length).toBeGreaterThan(0);
    for (const stage of PIPELINE_STAGES) {
      expect(resolveStageFilter(stage)).toBe(stage);
    }
  });

  it('rejects a stage outside the ipo_status enum (WITHDRAWN was the 500)', () => {
    expect(resolveStageFilter('WITHDRAWN')).toBeUndefined();
    expect(resolveStageFilter('nonsense')).toBeUndefined();
    expect(resolveStageFilter(undefined)).toBeUndefined();
  });
});

describe('IpoPipelineStepsRepository.upsertStep — attempts (counted in SQL)', () => {
  it('increments attempts in SQL when the new status is FAILED', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'FAILED', error: 'boom' });

    // An SQL expression, never a number read out of a prior SELECT.
    expect(calls.conflictSets[0].attempts).toBeDefined();
    expect(typeof calls.conflictSets[0].attempts).not.toBe('number');
  });

  it('makes the RUNNING -> DONE increment conditional in SQL, not read-then-write', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(calls.conflictSets[0].attempts).toBeDefined();
    expect(typeof calls.conflictSets[0].attempts).not.toBe('number');
  });

  it('never issues a SELECT before writing (no read-then-write race)', async () => {
    const { repo, db } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'FAILED', error: 'x' });

    expect(db.select).not.toHaveBeenCalled();
  });

  it('leaves attempts entirely out of the conflict set when marking a step RUNNING', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C1', status: 'RUNNING' });

    expect('attempts' in calls.conflictSets[0]).toBe(false);
  });

  it('increments attempts in SQL on BLOCKED, and starts a new BLOCKED row at 1', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C1', status: 'BLOCKED', error: 'gave up' });

    expect(calls.conflictSets[0].attempts).toBeDefined();
    expect(typeof calls.conflictSets[0].attempts).not.toBe('number');
    expect(calls.insertValues[0].attempts).toBe(1);
  });

  it('leaves attempts out of the set for SKIPPED and NOT_AVAILABLE_YET', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C1', status: 'SKIPPED' });
    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C2', status: 'NOT_AVAILABLE_YET' });

    expect('attempts' in calls.conflictSets[0]).toBe(false);
    expect('attempts' in calls.conflictSets[1]).toBe(false);
  });

  it('starts a first-ever FAILED row at attempts = 1, and any other status at 0', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C3', status: 'FAILED', error: 'x' });
    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'C4', status: 'RUNNING' });

    expect(calls.insertValues[0].attempts).toBe(1);
    expect(calls.insertValues[1].attempts).toBe(0);
  });
});

describe('IpoPipelineStepsRepository.upsertStep — partial updates never wipe stored fields', () => {
  it('writes the fields the caller provided into the conflict set', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({
      ipoId: IPO_ID,
      stepId: 'B1',
      status: 'DONE',
      source: 'WALK',
      version: 'v1',
      evidence: { walk: 'docs/walks/2026-09-02-deepa-pipeline-walk.md' },
    });

    const set = calls.conflictSets[0];
    expect(set.source).toBe('WALK');
    expect(set.version).toBe('v1');
    expect(set.evidence).toEqual({ walk: 'docs/walks/2026-09-02-deepa-pipeline-walk.md' });
  });

  it('a later status-only write leaves source/evidence/version/input_ref/next_due_at untouched', async () => {
    const { repo, calls } = makeRepo();

    // First: the backfill records real provenance.
    await repo.upsertStep({
      ipoId: IPO_ID,
      stepId: 'B1',
      status: 'DONE',
      source: 'WALK',
      version: 'v1',
      inputRef: 'sha256:abc',
      nextDueAt: new Date('2026-09-03T00:00:00Z'),
      evidence: { walk: 'x' },
    });
    // Then: a scraper marks the same step RUNNING with nothing else.
    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'RUNNING' });

    const set = calls.conflictSets[1];
    for (const key of ['source', 'evidence', 'version', 'inputRef', 'nextDueAt']) {
      expect(key in set).toBe(false);
    }
  });

  it('an explicit null still clears a field', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'RUNNING', source: null });

    expect('source' in calls.conflictSets[0]).toBe(true);
    expect(calls.conflictSets[0].source).toBeNull();
  });
});

describe('IpoPipelineStepsRepository.upsertStep — error and timestamps', () => {
  it('clears a previously stored error on DONE even though the caller passed no error', async () => {
    const { repo, calls } = makeRepo();

    // A failure is recorded first, so there IS a stored error to clear.
    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'FAILED', error: 'old failure' });
    expect(calls.conflictSets[0].error).toBe('old failure');

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'DONE' });

    // The clearing branch must put an explicit null in the set -- omitting the
    // key would leave 'old failure' stored forever.
    expect('error' in calls.conflictSets[1]).toBe(true);
    expect(calls.conflictSets[1].error).toBeNull();
  });

  it('keeps the supplied error on FAILED', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({
      ipoId: IPO_ID,
      stepId: 'B7',
      status: 'FAILED',
      error: 'W-16/W-17/W-18 open',
    });

    expect(calls.conflictSets[0].error).toBe('W-16/W-17/W-18 open');
  });

  it('leaves a stored error alone on a non-DONE status with no error supplied', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B7', status: 'RUNNING' });

    expect('error' in calls.conflictSets[0]).toBe(false);
  });

  it('sets last_run_at on a terminal status', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(calls.conflictSets[0].lastRunAt).toBeInstanceOf(Date);
  });

  it('does NOT set last_run_at on a non-terminal status', async () => {
    const { repo, calls } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'RUNNING' });

    expect(calls.conflictSets[0].lastRunAt).toBeUndefined();
  });

  it('rejects a step id that is not in the catalogue', async () => {
    const { repo } = makeRepo();

    await expect(repo.upsertStep({ ipoId: IPO_ID, stepId: 'Z9', status: 'DONE' })).rejects.toThrow(
      /Z9/
    );
  });

  it('invalidates the IPO grid cache after an upsert', async () => {
    const { repo, redis } = makeRepo();

    await repo.upsertStep({ ipoId: IPO_ID, stepId: 'B1', status: 'DONE' });

    expect(redis.del).toHaveBeenCalled();
  });
});

/**
 * Flatten a drizzle SQL fragment into the literal text it carries plus every
 * bound parameter value, so a test can assert on what actually reaches
 * Postgres rather than on the builder object's shape.
 */
function flattenSql(node: any, out: { text: string[]; params: unknown[] } = { text: [], params: [] }) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const n of node) flattenSql(n, out);
    return out;
  }
  if (Array.isArray(node.queryChunks)) {
    for (const chunk of node.queryChunks) flattenSql(chunk, out);
    return out;
  }
  // StringChunk carries `value: string[]`; Param carries a single `value`.
  if (Array.isArray(node.value)) {
    out.text.push(node.value.join(''));
    return out;
  }
  if ('value' in node && typeof node.value !== 'object') {
    out.params.push(node.value);
    return out;
  }
  if (typeof node.name === 'string') {
    out.text.push(node.name);
    return out;
  }
  return out;
}

describe('IpoPipelineStepsRepository.findGrid — filtering and ordering', () => {
  it('applies a real stage as an equality filter on ipos.status', async () => {
    const { repo, calls } = makeRepo([[]]);

    await repo.findGrid({ stage: 'OPEN' });

    const where = flattenSql(calls.whereArgs[0]);
    expect(where.params).toContain('OPEN');
  });

  it('never lets an invalid stage reach the where clause (WITHDRAWN is not an ipo_status)', async () => {
    const { repo, calls } = makeRepo([[]]);

    await repo.findGrid({ stage: 'WITHDRAWN' });

    const where = flattenSql(calls.whereArgs[0]);
    // No bound parameter carries the bad value, and the clause is the
    // active-IPO fallback (which mentions LISTED) rather than a status filter.
    expect(where.params).not.toContain('WITHDRAWN');
    expect(where.text.join(' ')).toContain('LISTED');
  });

  it('orders by open_date DESC NULLS LAST with an id tiebreaker', async () => {
    const { repo, calls } = makeRepo([[]]);

    await repo.findGrid({});

    const [primary, tiebreaker] = calls.orderByArgs[0];
    // NULLS LAST: Postgres would otherwise sort undated IPOs FIRST on DESC and
    // let them crowd real ones out of the page.
    expect(flattenSql(primary).text.join(' ')).toContain('DESC NULLS LAST');
    // A second key makes the 50-row boundary stable between runs.
    expect(tiebreaker).toBeDefined();
    expect(flattenSql(tiebreaker).text.join(' ')).toContain('id');
  });
});

describe('IpoPipelineStepsRepository.initForIpo', () => {
  it('creates one NOT_DUE row per catalogue step in a single insert', async () => {
    const { repo, calls, db } = makeRepo();

    await repo.initForIpo(IPO_ID);

    expect(db.insert).toHaveBeenCalledTimes(1);
    const rows = calls.insertValues[0];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(PIPELINE_STEPS.length);
    expect(rows.every((r: any) => r.status === 'NOT_DUE')).toBe(true);
    expect(new Set(rows.map((r: any) => r.stepId)).size).toBe(PIPELINE_STEPS.length);
  });

  it('is idempotent — it uses ON CONFLICT DO NOTHING, never DO UPDATE', async () => {
    const { repo, calls } = makeRepo();

    await repo.initForIpo(IPO_ID);
    await repo.initForIpo(IPO_ID);

    // Observed on the builder itself: DO NOTHING was chosen both times, and no
    // DO UPDATE set was ever built, so existing statuses cannot be reset.
    expect(calls.conflictDoNothing).toBe(2);
    expect(calls.conflictSets).toHaveLength(0);
  });
});
