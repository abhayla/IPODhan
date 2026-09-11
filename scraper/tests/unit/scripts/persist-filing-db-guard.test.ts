/**
 * #640: `persist-filing.ts` must prove which database it is connected to and
 * refuse to write when the caller did not name it — staging and production
 * share a host+port (the same tunnel), so the database NAME is the only
 * thing that tells them apart, and `packages/shared/src/db/index.ts` silently
 * defaults an unset `DATABASE_NAME` to `'ipodhan'` (production).
 *
 * Three layers, each proven separately:
 *   1. Pure decisions (`requireExpectDbForApply`, `decideDbMismatch`) — no DB,
 *      catches an always-true / deleted-refusal mutant instantly.
 *   2. `assertConnectedDatabase` against a MOCKED `execute` — proves the
 *      printed line's shape, that the mandatory-flag refusal never even
 *      queries the database, and that a mismatch names both databases.
 *   3. `assertConnectedDatabase` against a REAL, LIVE `ipodhan_test`
 *      connection — proves the guard against the actual thing it is meant to
 *      catch, not a string standing in for it. Gated on
 *      PERSIST_FILING_GUARD_TEST_DB_* env vars; skips (not fails) when they
 *      are not set, and says so once, out loud, rather than silently
 *      downgrading to the mocked layer and calling that the same evidence.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool as PgPool } from 'pg';
import {
  requireExpectDbForApply,
  decideDbMismatch,
  assertConnectedDatabase,
} from '../../../scripts/persist-filing.js';

describe('requireExpectDbForApply (pure)', () => {
  it('refuses --apply with no --expect-db', () => {
    const d = requireExpectDbForApply(true, undefined);
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/--apply requires --expect-db/);
  });

  it('does not require --expect-db on a dry run', () => {
    expect(requireExpectDbForApply(false, undefined).refuse).toBe(false);
  });

  it('is satisfied once --expect-db is given alongside --apply', () => {
    expect(requireExpectDbForApply(true, 'ipodhan_test').refuse).toBe(false);
  });
});

describe('decideDbMismatch (pure)', () => {
  it('refuses and names BOTH the expected and the actual database', () => {
    const d = decideDbMismatch('ipodhan_staging', 'ipodhan_test');
    expect(d.refuse).toBe(true);
    expect(d.reason).toContain('ipodhan_staging');
    expect(d.reason).toContain('ipodhan_test');
  });

  it('passes when the names match exactly', () => {
    expect(decideDbMismatch('ipodhan_test', 'ipodhan_test').refuse).toBe(false);
  });

  it('passes when no expectation was named (nothing to check against)', () => {
    expect(decideDbMismatch(undefined, 'ipodhan_test').refuse).toBe(false);
  });

  it('is case-sensitive and whitespace-sensitive — an exact-name match, not a fuzzy one', () => {
    expect(decideDbMismatch('IPODHAN_TEST', 'ipodhan_test').refuse).toBe(true);
    expect(decideDbMismatch('ipodhan_test ', 'ipodhan_test').refuse).toBe(true);
  });
});

describe('assertConnectedDatabase — mocked connection', () => {
  it('refuses --apply-without---expect-db BEFORE ever querying the database', async () => {
    const execute = vi.fn();
    const errs: string[] = [];
    let exitCode: number | undefined;
    await assertConnectedDatabase({ execute }, undefined, true, {
      log: () => {},
      error: (l) => errs.push(l),
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBe(2);
    expect(execute).not.toHaveBeenCalled();
    expect(errs[0]).toMatch(/--apply requires --expect-db/);
  });

  it('prints current_database/host/port on a DRY RUN too (not just --apply)', async () => {
    const execute = vi.fn(async () => ({
      rows: [{ db: 'ipodhan_test', host: '127.0.0.1', port: 15432 }],
    }));
    const logs: string[] = [];
    await assertConnectedDatabase({ execute }, 'ipodhan_test', false, {
      log: (l) => logs.push(l),
      error: () => {},
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatch(/current_database=ipodhan_test/);
    expect(logs[0]).toMatch(/host=127\.0\.0\.1/);
    expect(logs[0]).toMatch(/port=15432/);
  });

  it('refuses on a mismatch and names both databases (mocked connection)', async () => {
    const execute = vi.fn(async () => ({ rows: [{ db: 'ipodhan_test', host: null, port: null }] }));
    const errs: string[] = [];
    let exitCode: number | undefined;
    await assertConnectedDatabase({ execute }, 'ipodhan_staging', false, {
      log: () => {},
      error: (l) => errs.push(l),
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBe(2);
    expect(errs[0]).toContain('ipodhan_staging');
    expect(errs[0]).toContain('ipodhan_test');
  });

  it('proceeds (no exit) when --expect-db matches the connected database, even under --apply', async () => {
    const execute = vi.fn(async () => ({ rows: [{ db: 'ipodhan_test' }] }));
    let exitCode: number | undefined;
    await assertConnectedDatabase({ execute }, 'ipodhan_test', true, {
      log: () => {},
      error: () => {},
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Live connection. Only runs when PERSIST_FILING_GUARD_TEST_DB_* is set to a
// real, reachable ipodhan_test — set by the operator running this suite, not
// committed anywhere. Never opens ipodhan or ipodhan_staging: the database
// name is fixed to 'ipodhan_test' below regardless of what the env supplies.
// ---------------------------------------------------------------------------
const LIVE_HOST = process.env.PERSIST_FILING_GUARD_TEST_DB_HOST;
const LIVE_PORT = process.env.PERSIST_FILING_GUARD_TEST_DB_PORT;
const LIVE_USER = process.env.PERSIST_FILING_GUARD_TEST_DB_USER;
const LIVE_PASSWORD = process.env.PERSIST_FILING_GUARD_TEST_DB_PASSWORD;
const hasLiveDb = Boolean(LIVE_HOST && LIVE_PORT && LIVE_USER && LIVE_PASSWORD);

if (!hasLiveDb) {
  // eslint-disable-next-line no-console
  console.warn(
    'persist-filing-db-guard.test.ts: live ipodhan_test tests SKIPPED — set ' +
      'PERSIST_FILING_GUARD_TEST_DB_HOST/PORT/USER/PASSWORD to a reachable ipodhan_test ' +
      'to exercise assertConnectedDatabase against a real connection instead of a mock.'
  );
}

describe.skipIf(!hasLiveDb)('assertConnectedDatabase — LIVE ipodhan_test connection (#640)', () => {
  let pool: PgPool;
  let liveDb: { execute: (q: unknown) => Promise<unknown> };

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    pool = new Pool({
      host: LIVE_HOST,
      port: Number(LIVE_PORT),
      database: 'ipodhan_test', // fixed — never taken from the env, on purpose
      user: LIVE_USER,
      password: LIVE_PASSWORD,
      connectionTimeoutMillis: 10000,
    });
    liveDb = drizzle(pool) as unknown as { execute: (q: unknown) => Promise<unknown> };
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('prints the real current_database/host/port on a dry run', async () => {
    const logs: string[] = [];
    await assertConnectedDatabase(liveDb, undefined, false, {
      log: (l) => logs.push(l),
      error: () => {},
    });
    expect(logs[0]).toMatch(/current_database=ipodhan_test/);
  });

  it('proceeds when --expect-db ipodhan_test matches the real connection', async () => {
    const errs: string[] = [];
    let exitCode: number | undefined;
    await assertConnectedDatabase(liveDb, 'ipodhan_test', false, {
      log: () => {},
      error: (l) => errs.push(l),
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBeUndefined();
    expect(errs).toHaveLength(0);
  });

  it('refuses when --expect-db ipodhan_staging is named against the real ipodhan_test connection, naming both', async () => {
    const errs: string[] = [];
    let exitCode: number | undefined;
    await assertConnectedDatabase(liveDb, 'ipodhan_staging', false, {
      log: () => {},
      error: (l) => errs.push(l),
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBe(2);
    expect(errs[0]).toContain('ipodhan_staging');
    expect(errs[0]).toContain('ipodhan_test');
  });
});
