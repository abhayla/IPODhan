/**
 * OD-137: `recordOutcome` writes `ipo_field_plan.answers` in the SAME claim-token-guarded UPDATE
 * that records the outcome -- never a second, unguarded write. The SQL is rendered through the
 * real `PgDialect.sqlToQuery()` (the rendering drizzle sends to Postgres), so these tests assert
 * the actual statement and its bound parameters, not a mock's echo.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { IpoFieldPlanRepository } from '@ipodhan/shared/repositories';
import type Redis from 'ioredis';

const dialect = new PgDialect();
const PLAN_ROW_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'claim-token-abc';

function makeRepo(rows: Record<string, unknown>[] = [{ id: PLAN_ROW_ID, state: 'CHECK_FAILED' }]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executed: any[] = [];
  const db = {
    execute: vi.fn(async (q: unknown) => {
      executed.push(q);
      return { rows };
    }),
  };
  const redis = { get: vi.fn(), setex: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() } as unknown as Redis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo = new IpoFieldPlanRepository(db as any, redis);
  return { repo, db, executed };
}

function rendered(q: unknown): { sql: string; params: unknown[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return dialect.sqlToQuery(q as any) as { sql: string; params: unknown[] };
}

/** The bound value that follows `answers = CASE WHEN $n THEN $m::jsonb`. */
function answersBinding(q: { sql: string; params: unknown[] }): { when: unknown; value: unknown } {
  const m = q.sql.match(/answers = CASE WHEN \$(\d+) THEN \$(\d+)::jsonb ELSE answers END/);
  expect(m, `answers CASE clause missing from:\n${q.sql}`).not.toBeNull();
  return { when: q.params[Number(m![1]) - 1], value: q.params[Number(m![2]) - 1] };
}

const ANSWERS = [
  { source: 'NSE', outcome: 'CHECK_FAILED' as const, value: null, at: '2026-09-28T08:00:00.000Z', cause: 'rank1:NSE:CHECK_FAILED:x' },
  { source: 'BSE', outcome: 'NOT_PRINTED' as const, value: null, at: '2026-09-28T08:00:01.000Z' },
];

describe('IpoFieldPlanRepository.recordOutcome -- OD-137 answers column', () => {
  it('answers provided -> ONE UPDATE, guarded by the claim token, binds the answers as one JSON text cast to jsonb', async () => {
    const { repo, db, executed } = makeRepo();
    const res = await repo.recordOutcome({
      planRowId: PLAN_ROW_ID,
      claimToken: TOKEN,
      writeHappened: true,
      state: 'CHECK_FAILED',
      answers: ANSWERS,
    });

    expect(res.written).toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const q = rendered(executed[0]);
    expect(q.sql).toMatch(/^\s*UPDATE ipo_field_plan/);
    expect(q.sql).toMatch(/AND claim_token = \$\d+/);
    expect(q.params).toContain(TOKEN);
    const b = answersBinding(q);
    expect(b.when).toBe(true);
    expect(typeof b.value).toBe('string');
    expect(JSON.parse(b.value as string)).toEqual(ANSWERS);
  });

  it('answers: null -> the CASE writes SQL NULL (a value-storing pass clears stale answers)', async () => {
    const { repo, executed } = makeRepo();
    await repo.recordOutcome({ planRowId: PLAN_ROW_ID, claimToken: TOKEN, writeHappened: true, state: 'SUPPLIED', answers: null });

    const b = answersBinding(rendered(executed[0]));
    expect(b.when).toBe(true);
    expect(b.value).toBeNull();
  });

  it('answers omitted -> the CASE keeps the column as it is (flag OFF is byte-identical)', async () => {
    const { repo, executed } = makeRepo();
    await repo.recordOutcome({ planRowId: PLAN_ROW_ID, claimToken: TOKEN, writeHappened: true, state: 'CHECK_FAILED' });

    const b = answersBinding(rendered(executed[0]));
    expect(b.when).toBe(false);
    expect(b.value).toBeNull();
  });

  it('the skipped branch (writeHappened false) never writes answers, even when given', async () => {
    const { repo, executed } = makeRepo();
    await repo.recordOutcome({ planRowId: PLAN_ROW_ID, claimToken: TOKEN, writeHappened: false, answers: ANSWERS });

    const q = rendered(executed[0]);
    expect(q.sql).not.toMatch(/answers/);
    expect(JSON.stringify(q.params)).not.toContain('CHECK_FAILED');
  });

  it('a superseded claim (0 rows) -> written false, CLAIM_SUPERSEDED, the answers go nowhere else', async () => {
    const { repo, db } = makeRepo([]);
    const res = await repo.recordOutcome({
      planRowId: PLAN_ROW_ID,
      claimToken: TOKEN,
      writeHappened: true,
      state: 'CHECK_FAILED',
      answers: ANSWERS,
    });

    expect(res).toEqual({ written: false, reason: 'CLAIM_SUPERSEDED' });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('mapRow reads the answers column back onto the row', async () => {
    const { repo } = makeRepo([{ id: PLAN_ROW_ID, state: 'CHECK_FAILED', answers: ANSWERS }]);
    const res = await repo.recordOutcome({ planRowId: PLAN_ROW_ID, claimToken: TOKEN, writeHappened: true, state: 'CHECK_FAILED', answers: ANSWERS });
    expect(res.row?.answers).toEqual(ANSWERS);
  });
});
