/**
 * T-490: mutation tests for the shared repair-tool guard module.
 *
 * Each `MUTATION:` test names exactly which deletion in
 * `scraper/scripts/lib/repair-tool.ts` turns it red. Verified by deleting each
 * guard in turn before committing:
 *   - delete the `isProdDb && !allowProd` refusal branch  -> MUTATION 1 red
 *   - drop `previousSource` from the upsert row           -> MUTATION 2 red
 *   - key the idempotency set by ipoId only (not field)   -> MUTATION 3 red
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { types as pgTypes } from 'pg';
import {
  alreadyRepairedKey,
  assertNoSchemaDrift,
  buildAlreadyRepairedSet,
  buildIpoScopeCondition,
  collectFlagValues,
  decideCacheInvalidationBlock,
  decideProdWriteRefusal,
  decideSchemaDriftRefusal,
  decideStaleCorrectionSkip,
  queryLatestFieldSourceDate,
  decideUndoIpoConflict,
  describeDbConnectionTarget,
  describeIpoScope,
  flagIsPresent,
  formatCacheInvalidationBlockNotice,
  guardCacheInvalidation,
  openRepairDb,
  readExpectDbFlag,
  parseIpoScope,
  probeFieldSourcesRowKeyColumn,
  repairToolRedisSlot,
  resolveIpoScope,
  resolveRedisTargetHost,
  LOCAL_TEST_DATABASE_NAME,
  PRODUCTION_DATABASE_NAME,
  queryCurrentDatabase,
  readFieldSource,
  upsertFieldSource,
  writeLedgerFile,
} from '../../../scripts/lib/repair-tool.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// #481: openRepairDb now pre-checks the connection env before calling
// dbLike.execute(). Every existing openRepairDb() call in this file uses a
// MOCKED dbLike that never touches the network, so tests supply a usable
// fake env (never a real credential) purely to reach the same mocked
// dbLike.execute() path as before — the assertions below are unchanged.
const FAKE_USABLE_ENV: NodeJS.ProcessEnv = { DATABASE_URL: 'postgresql://user:pw@localhost:5432/fake_test_db' }; // secret-scan:allow (dummy fixture)

function mockTx(existingSource: string | null) {
  const limit = vi.fn().mockResolvedValue(existingSource ? [{ source: existingSource }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { select, insert, values, onConflictDoUpdate };
}

describe('MUTATION 1 — the production write refusal', () => {
  it('MUTATION: deleting the refusal branch turns this red — --apply against current_database()="ipodhan" is refused without --allow-prod', () => {
    const d = decideProdWriteRefusal({ apply: true, dbName: 'ipodhan', allowProd: false });
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/refusing to APPLY/);
    expect(d.reason).toMatch(/ipodhan/);
  });

  it('allows --apply against prod when --allow-prod is explicitly passed', () => {
    expect(decideProdWriteRefusal({ apply: true, dbName: 'ipodhan', allowProd: true }).refuse).toBe(false);
  });

  it('never refuses a dry run, even against prod (a dry run writes nothing)', () => {
    expect(decideProdWriteRefusal({ apply: false, dbName: 'ipodhan', allowProd: false }).refuse).toBe(false);
  });

  it('allows --apply against staging / test databases without --allow-prod', () => {
    expect(decideProdWriteRefusal({ apply: true, dbName: 'ipodhan_staging', allowProd: false }).refuse).toBe(false);
    expect(decideProdWriteRefusal({ apply: true, dbName: 'ipodhan_test', allowProd: false }).refuse).toBe(false);
  });

  it('is case-insensitive on the database name (a mixed-case name is still prod)', () => {
    expect(decideProdWriteRefusal({ apply: true, dbName: 'IPODhan', allowProd: false }).refuse).toBe(true);
  });

  it('the production database name is exactly "ipodhan"', () => {
    expect(PRODUCTION_DATABASE_NAME).toBe('ipodhan');
  });
});

describe('queryCurrentDatabase — the guard signal comes from the WRITING pool, never from env', () => {
  it('reads the name from SELECT current_database() on the same handle', async () => {
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan_staging' }]);
    expect(await queryCurrentDatabase({ execute })).toBe('ipodhan_staging');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('handles a node-postgres-shaped {rows: [...]} result', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ name: 'ipodhan' }] });
    expect(await queryCurrentDatabase({ execute })).toBe('ipodhan');
  });

  it('throws rather than silently trusting an empty result', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(queryCurrentDatabase({ execute })).rejects.toThrow(/no row/);
  });
});

describe('openRepairDb — prints the real database name and gates the write', () => {
  it('prints the `current_database(): <name>` line the ops recipes and dry-run proofs read', async () => {
    const log = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan_staging' }]);
    const r = await openRepairDb({ execute }, { apply: false, allowProd: false, toolName: 't', log, error: vi.fn(), env: FAKE_USABLE_ENV });
    expect(log).toHaveBeenCalledWith('current_database(): ipodhan_staging');
    expect(r).toEqual({ dbName: 'ipodhan_staging', isProd: false });
  });

  it('MUTATION: deleting the refusal branch turns this red — an --apply on prod calls onRefuse and prints the reason', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan' }]);
    await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 'tool-x', log: vi.fn(), error, onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('tool-x: refusing to APPLY'));
  });

  it('does not refuse an authorized prod apply, and says so', async () => {
    const log = vi.fn();
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan' }]);
    const r = await openRepairDb({ execute }, { apply: true, allowProd: true,
      toolName: 't', log, error: vi.fn(), onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r.isProd).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ALLOW-PROD'));
  });
});

describe('openRepairDb — #671: --expect-db refuses a pool connected to a different database', () => {
  it('refuses (even a dry run) when expectDb names another database, before the prod decision', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan' }]);
    await openRepairDb({ execute }, { apply: false, allowProd: false, toolName: 'tool-x', expectDb: 'ipodhan_staging', log: vi.fn(), error, onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--expect-db said "ipodhan_staging"'));
  });

  it('passes when expectDb matches (case-insensitive) and when it is absent', async () => {
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan_staging' }]);
    await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 't', expectDb: 'IPODHAN_STAGING', log: vi.fn(), error: vi.fn(), onRefuse, env: FAKE_USABLE_ENV });
    await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 't', expectDb: null, log: vi.fn(), error: vi.fn(), onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it('readExpectDbFlag reads both --expect-db <name> and --expect-db=<name>', () => {
    expect(readExpectDbFlag(['--expect-db', 'ipodhan_test'])).toBe('ipodhan_test');
    expect(readExpectDbFlag(['--expect-db=ipodhan_staging', '--apply'])).toBe('ipodhan_staging');
    expect(readExpectDbFlag(['--apply'])).toBeNull();
  });
});

describe('describeDbConnectionTarget — #481 pre-connect env check (pure, no I/O)', () => {
  it('the discrete form (DATABASE_HOST+DATABASE_PASSWORD) is usable and redacts to host:port/db', () => {
    const d = describeDbConnectionTarget({
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '15432',
      DATABASE_NAME: 'ipodhan_staging',
      DATABASE_USER: 'ipodhan_app',
      DATABASE_PASSWORD: 'super-secret-pw',
    } as NodeJS.ProcessEnv);
    expect(d.usable).toBe(true);
    expect(d.target).toBe('127.0.0.1:15432/ipodhan_staging');
    expect(d.target).not.toContain('super-secret-pw');
  });

  it('a lone DATABASE_URL is usable — initPool() honours it when DATABASE_HOST/PASSWORD are absent', () => {
    const d = describeDbConnectionTarget({
      DATABASE_URL: 'postgresql://ipodhan_app:super-secret-pw@127.0.0.1:15432/ipodhan_staging', // secret-scan:allow (dummy fixture)
    } as NodeJS.ProcessEnv);
    expect(d.usable).toBe(true);
    expect(d.target).toBe('127.0.0.1:15432/ipodhan_staging');
    expect(d.target).not.toContain('super-secret-pw');
    expect(d.target).not.toContain('ipodhan_app');
  });

  it('MUTATION: neither form set is unusable and names BOTH missing forms, never a bare count', () => {
    const d = describeDbConnectionTarget({} as NodeJS.ProcessEnv);
    expect(d.usable).toBe(false);
    expect(d.missing).toHaveLength(2);
    expect(d.missing.join(' ')).toMatch(/DATABASE_HOST/);
    expect(d.missing.join(' ')).toMatch(/DATABASE_URL/);
  });

  it('#640: DATABASE_HOST+DATABASE_PASSWORD with DATABASE_NAME unset is unusable, and NEVER labelled ipodhan — resolveDiscreteDbParams() throws on this exact shape', () => {
    const d = describeDbConnectionTarget({
      DATABASE_HOST: 'h',
      DATABASE_PASSWORD: 'p',
    } as NodeJS.ProcessEnv);
    expect(d.usable).toBe(false);
    expect(d.missing).toContain('DATABASE_NAME');
    expect(d.target).not.toContain('ipodhan');
  });

  it('#640: DATABASE_HOST+DATABASE_PASSWORD+DATABASE_NAME with DATABASE_USER unset is unusable and names DATABASE_USER', () => {
    const d = describeDbConnectionTarget({
      DATABASE_HOST: 'h',
      DATABASE_PASSWORD: 'p',
      DATABASE_NAME: 'ipodhan_staging',
    } as NodeJS.ProcessEnv);
    expect(d.usable).toBe(false);
    expect(d.missing).toContain('DATABASE_USER');
  });

  it('DATABASE_HOST alone (no DATABASE_PASSWORD) falls through to the DATABASE_URL check, not the discrete form', () => {
    const d = describeDbConnectionTarget({
      DATABASE_HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://u:pw@localhost:5432/fallback_db', // secret-scan:allow (dummy fixture)
    } as NodeJS.ProcessEnv);
    expect(d.usable).toBe(true);
    expect(d.target).toBe('localhost:5432/fallback_db');
  });
});

describe('openRepairDb — #481: an unusable env never refuses a SUCCESSFUL mocked connection', () => {
  it('a mocked dbLike that resolves succeeds even with neither DATABASE_HOST+PASSWORD nor DATABASE_URL set — no pre-connect refusal, so the dozens of other repair-tool test files (mocked dbLike, no env set) are unaffected', async () => {
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan_staging' }]);
    const r = await openRepairDb(
      { execute },
      { apply: false, allowProd: false, toolName: 'tool-y', log: vi.fn(), error: vi.fn(), onRefuse, env: {} as NodeJS.ProcessEnv }
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r).toEqual({ dbName: 'ipodhan_staging', isProd: false });
  });
});

describe('openRepairDb — #481: a connection failure names its target and cause, never an anonymous stack', () => {
  it('MUTATION: deleting this catch turns it red — a timeout-shaped error is reported with host:port/db and the wrapped cause', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const timeoutError = new Error('Failed query: SELECT current_database() AS name');
    (timeoutError as { cause?: unknown }).cause = Object.assign(new Error('Connection terminated due to connection timeout'), {
      code: 'ETIMEDOUT',
    });
    const execute = vi.fn().mockRejectedValue(timeoutError);
    const r = await openRepairDb(
      { execute },
      {
        apply: false,
        allowProd: false,
        toolName: 'tool-z',
        log: vi.fn(),
        error,
        onRefuse,
        env: { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '15432', DATABASE_NAME: 'ipodhan_staging', DATABASE_USER: 'ipodhan_app', DATABASE_PASSWORD: 'pw' } as NodeJS.ProcessEnv,
      }
    );
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('tool-z: failed to connect to 127.0.0.1:15432/ipodhan_staging'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection terminated due to connection timeout'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ETIMEDOUT'));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('pw')); // never the password
    expect(r).toEqual({ dbName: '', isProd: false });
  });

  it('a plain Error with no .cause still reports its own message rather than throwing unhandled', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await openRepairDb(
      { execute },
      { apply: false, allowProd: false, toolName: 't', log: vi.fn(), error, onRefuse, env: FAKE_USABLE_ENV }
    );
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('#481 the reported class: env unusable AND the connection genuinely fails — names BOTH missing forms instead of an anonymous stack', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const timeoutError = new Error('Failed query: SELECT current_database() AS name');
    (timeoutError as { cause?: unknown }).cause = Object.assign(new Error('Connection terminated due to connection timeout'), {
      code: 'ETIMEDOUT',
    });
    const execute = vi.fn().mockRejectedValue(timeoutError);
    const r = await openRepairDb(
      { execute },
      { apply: false, allowProd: false, toolName: 'tool-q', log: vi.fn(), error, onRefuse, env: {} as NodeJS.ProcessEnv }
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_HOST'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection terminated due to connection timeout'));
    expect(r).toEqual({ dbName: '', isProd: false });
  });
});

describe('resolveRedisTargetHost — reads the SAME env the shared Redis client factory reads (#1070)', () => {
  it('prefers REDIS_URL, extracting its hostname', () => {
    expect(resolveRedisTargetHost({ redisUrl: 'redis://10.0.0.5:6379/1', redisHost: 'ignored' })).toBe('10.0.0.5');
  });

  it('falls back to REDIS_HOST when REDIS_URL is unset', () => {
    expect(resolveRedisTargetHost({ redisHost: '10.0.0.5' })).toBe('10.0.0.5');
  });

  it('returns null when neither is set', () => {
    expect(resolveRedisTargetHost({})).toBeNull();
  });

  it('treats an unparseable REDIS_URL as not-configured (null), never as safe', () => {
    expect(resolveRedisTargetHost({ redisUrl: 'not a url' })).toBeNull();
  });
});

describe('repairToolRedisSlot — the on-box redis-cli db index (prod 0, staging 1)', () => {
  it('maps the production database name to db 0', () => {
    expect(repairToolRedisSlot(PRODUCTION_DATABASE_NAME)).toEqual({ slot: 'prod', dbIndex: 0 });
  });

  it('maps any staging-named database to db 1', () => {
    expect(repairToolRedisSlot('ipodhan_staging')).toEqual({ slot: 'staging', dbIndex: 1 });
  });

  it('reports unknown/null for anything else', () => {
    expect(repairToolRedisSlot('some_other_db')).toEqual({ slot: 'unknown', dbIndex: null });
  });
});

describe('decideCacheInvalidationBlock — the #1070 redesign of the #715 guard', () => {
  it('MUTATION: deleting the localhost check turns this red — staging + REDIS_URL=redis://127.0.0.1:6379 BLOCKS (still the laptop, not the slot Redis)', () => {
    const d = decideCacheInvalidationBlock({ dbName: 'ipodhan_staging', redisHost: '127.0.0.1' });
    expect(d.block).toBe(true);
    expect(d.reason).toMatch(/loopback/);
  });

  it('blocks staging with REDIS_URL/REDIS_HOST unset entirely', () => {
    const d = decideCacheInvalidationBlock({ dbName: 'ipodhan_staging', redisHost: null });
    expect(d.block).toBe(true);
    expect(d.reason).toMatch(/neither REDIS_URL nor REDIS_HOST/);
  });

  it('also blocks prod with a loopback/unset Redis target — a SEPARATE guard from the prod-write refusal', () => {
    expect(decideCacheInvalidationBlock({ dbName: PRODUCTION_DATABASE_NAME, redisHost: null }).block).toBe(true);
    expect(decideCacheInvalidationBlock({ dbName: PRODUCTION_DATABASE_NAME, redisHost: '::1' }).block).toBe(true);
  });

  it('connects (does not block) when the resolved host is a real remote target', () => {
    expect(decideCacheInvalidationBlock({ dbName: 'ipodhan_staging', redisHost: 'redis-staging.internal' }).block).toBe(
      false
    );
  });

  it(`always connects for ${LOCAL_TEST_DATABASE_NAME}, even with no Redis host resolved — the one db local Redis is correct for`, () => {
    expect(decideCacheInvalidationBlock({ dbName: LOCAL_TEST_DATABASE_NAME, redisHost: null }).block).toBe(false);
  });

  it(`is case-insensitive on the ${LOCAL_TEST_DATABASE_NAME} exemption`, () => {
    expect(decideCacheInvalidationBlock({ dbName: 'IPODhan_Test', redisHost: null }).block).toBe(false);
  });
});

describe('formatCacheInvalidationBlockNotice — prints the exact keys and the on-box command', () => {
  it('lists every key and the correct db index for staging', () => {
    const msg = formatCacheInvalidationBlockNotice({
      dbName: 'ipodhan_staging',
      toolName: 'tool-x',
      keys: ['ipo:detail:foo', 'ipo:list:*'],
      reason: 'neither REDIS_URL nor REDIS_HOST is set',
    });
    expect(msg).toMatch(/tool-x: BLOCKED/);
    expect(msg).toMatch(/#1070/);
    expect(msg).toMatch(/ipo:detail:foo/);
    expect(msg).toMatch(/ipo:list:\*/);
    expect(msg).toMatch(/redis-cli -n 1 DEL/);
  });

  it('uses db 0 for prod', () => {
    const msg = formatCacheInvalidationBlockNotice({
      dbName: PRODUCTION_DATABASE_NAME,
      toolName: 'tool-x',
      keys: ['ipo:detail:foo'],
      reason: 'unset',
    });
    expect(msg).toMatch(/redis-cli -n 0 DEL/);
  });
});

describe('guardCacheInvalidation — the call site every repair-tool invalidation goes through instead of getRedisClient() directly (#1070)', () => {
  it('blocks and prints (does not connect) for staging + REDIS_URL=redis://127.0.0.1:6379', () => {
    const log = vi.fn();
    const r = guardCacheInvalidation({
      dbName: 'ipodhan_staging',
      toolName: 'tool-x',
      keys: ['ipo:detail:foo'],
      redisHost: resolveRedisTargetHost({ redisUrl: 'redis://127.0.0.1:6379' }),
      log,
    });
    expect(r.blocked).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('BLOCKED cache invalidation'));
  });

  it('blocks and prints for staging with REDIS_URL/REDIS_HOST unset', () => {
    const log = vi.fn();
    const r = guardCacheInvalidation({ dbName: 'ipodhan_staging', toolName: 'tool-x', keys: ['ipo:detail:foo'], redisHost: null, log });
    expect(r.blocked).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it(`connects (never blocks, never prints) for ${LOCAL_TEST_DATABASE_NAME}`, () => {
    const log = vi.fn();
    const r = guardCacheInvalidation({ dbName: LOCAL_TEST_DATABASE_NAME, toolName: 'tool-x', keys: ['ipo:detail:foo'], redisHost: null, log });
    expect(r.blocked).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('reads process.env.REDIS_URL/REDIS_HOST by default when redisHost is not injected', () => {
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    const log = vi.fn();
    const r = guardCacheInvalidation({ dbName: 'ipodhan_staging', toolName: 'tool-x', keys: ['ipo:detail:foo'], log });
    expect(r.blocked).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe('openRepairDb — #1070: never touches Redis; a tool that never invalidates cache is never refused', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('an --apply against a remote db succeeds with NO Redis env set at all — openRepairDb no longer gates on Redis', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan_staging' }]);
    const r = await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r).toEqual({ dbName: 'ipodhan_staging', isProd: false });
  });

  it('an --apply against prod (--allow-prod given) succeeds with no Redis env set — the prod-write guard and the retired Redis guard are independent', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: PRODUCTION_DATABASE_NAME }]);
    const r = await openRepairDb({ execute }, { apply: true, allowProd: true, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse, env: FAKE_USABLE_ENV });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r.isProd).toBe(true);
  });
});

describe('decideSchemaDriftRefusal — the #713 prod schema-drift preflight (decision 4)', () => {
  it('MUTATION: deleting this refusal turns it red — --apply is refused when field_sources.row_key is absent', () => {
    const d = decideSchemaDriftRefusal({ apply: true, hasRowKeyColumn: false, toolName: 'tool-x' });
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/field_sources\.row_key/);
    expect(d.reason).toMatch(/#713/);
    expect(d.reason).toMatch(/tool-x/);
  });

  it('allows --apply when the column is present', () => {
    expect(decideSchemaDriftRefusal({ apply: true, hasRowKeyColumn: true }).refuse).toBe(false);
  });

  it('never refuses a dry run, even when the column is absent', () => {
    expect(decideSchemaDriftRefusal({ apply: false, hasRowKeyColumn: false }).refuse).toBe(false);
  });
});

describe('probeFieldSourcesRowKeyColumn — mocked information_schema.columns probe', () => {
  it('returns true when the probe query returns a row', async () => {
    const execute = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    expect(await probeFieldSourcesRowKeyColumn({ execute })).toBe(true);
  });

  it('returns false when the probe query returns no rows (the #713 class)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    expect(await probeFieldSourcesRowKeyColumn({ execute })).toBe(false);
  });

  it('handles a node-postgres-shaped {rows: [...]} result', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    expect(await probeFieldSourcesRowKeyColumn({ execute })).toBe(false);
  });
});

describe('assertNoSchemaDrift — composed preflight (mirrors openRepairDb shape)', () => {
  it('MUTATION: refuses and calls onRefuse when --apply is given and the column probe comes back empty (the prod-on-old-schema class from #713)', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockResolvedValue([]); // column probe: absent
    const r = await assertNoSchemaDrift({ execute }, { apply: true, toolName: 'tool-x', log: vi.fn(), error, onRefuse });
    expect(r.refused).toBe(true);
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('#713'));
  });

  it('does not refuse when the column probe comes back present', async () => {
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ x: 1 }]);
    const r = await assertNoSchemaDrift({ execute }, { apply: true, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse });
    expect(r.refused).toBe(false);
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it('never refuses a dry run regardless of the probe result', async () => {
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([]);
    const r = await assertNoSchemaDrift({ execute }, { apply: false, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse });
    expect(r.refused).toBe(false);
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it('fails closed (refuses) with the #713 message PLUS the underlying error text when the probe itself throws (signal-ownership R6) — never a bare stack', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
    const r = await assertNoSchemaDrift({ execute }, { apply: true, toolName: 'tool-x', log: vi.fn(), error, onRefuse });
    expect(r.refused).toBe(true);
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('#713'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('connection terminated unexpectedly'));
  });

  it('a throwing probe never refuses a dry run — a dry run never writes, so a probe failure has nothing to protect', async () => {
    const onRefuse = vi.fn();
    const execute = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
    const r = await assertNoSchemaDrift({ execute }, { apply: false, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse });
    expect(r.refused).toBe(false);
    expect(onRefuse).not.toHaveBeenCalled();
  });
});

describe('MUTATION 2 — the previous_source carry (the audit trail)', () => {
  it('MUTATION: dropping previousSource from the upsert turns this red — the stale source is carried into previous_source', async () => {
    const tx = mockTx('CHITTORGARH');
    const { previousSource } = await upsertFieldSource(tx as never, {
      ipoId: 'ipo-1',
      fieldName: 'issueSize',
      source: 'ADMIN',
      previousValue: 12345,
      dataLineage: { note: 'x' },
      updatedBy: 'tool',
    });
    expect(previousSource).toBe('CHITTORGARH');
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ADMIN', previousSource: 'CHITTORGARH', confidence: 100 })
    );
    expect(tx.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ previousSource: 'CHITTORGARH' }) })
    );
  });

  it('leaves previous_source null when no field_sources row exists yet — never fabricated', async () => {
    const tx = mockTx(null);
    await upsertFieldSource(tx as never, {
      ipoId: 'ipo-2',
      fieldName: 'priceRangeMax',
      source: 'NSE',
      previousValue: null,
      dataLineage: { note: 'x' },
      updatedBy: 'tool',
    });
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ previousSource: null, previousValue: null })
    );
  });

  it("previous_value is the CALLER's ledger value, stringified — never the now-current value", async () => {
    const tx = mockTx('BSE');
    await upsertFieldSource(tx as never, {
      ipoId: 'ipo-3',
      fieldName: 'priceRangeMin',
      source: 'NSE',
      previousValue: 212,
      dataLineage: { note: 'x' },
      updatedBy: 'tool',
    });
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({ previousValue: '212' }));
  });

  it('always sets dataLineage, so a prior source stale lineage never survives the upsert', async () => {
    const tx = mockTx('MONEYCONTROL');
    const lineage = { note: 'T-490 test lineage' };
    await upsertFieldSource(tx as never, {
      ipoId: 'ipo-4',
      fieldName: 'issueSize',
      source: 'ADMIN',
      previousValue: null,
      dataLineage: lineage,
      updatedBy: 'tool',
    });
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({ dataLineage: lineage }));
    expect(tx.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ dataLineage: lineage }) })
    );
  });

  it('defaults the table to ipos and honours an explicit tableName', async () => {
    const tx = mockTx(null);
    await upsertFieldSource(tx as never, {
      ipoId: 'ipo-5',
      tableName: 'ipo_financials',
      fieldName: 'revenue',
      source: 'DRHP',
      previousValue: null,
      dataLineage: {},
      updatedBy: 'tool',
    });
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'ipo_financials' }));
  });

  it('readFieldSource returns null when nothing is stored', async () => {
    const tx = mockTx(null);
    expect(await readFieldSource(tx as never, { ipoId: 'x', fieldName: 'issueSize' })).toBeNull();
  });
});

describe('MUTATION 3 — per-FIELD idempotency', () => {
  const rows = [
    { ipoId: 'ipo-1', fieldName: 'priceRangeMin', repaired: true },
    { ipoId: 'ipo-1', fieldName: 'priceRangeMax', repaired: false },
  ];

  it('MUTATION: keying the set by ipoId only turns this red — a half-repaired row keeps its unrepaired field eligible', () => {
    const set = buildAlreadyRepairedSet(rows, (r) => r.repaired);
    expect(set.has(alreadyRepairedKey('ipo-1', 'priceRangeMin'))).toBe(true);
    expect(set.has(alreadyRepairedKey('ipo-1', 'priceRangeMax'))).toBe(false);
    expect(set.size).toBe(1);
  });

  it('the key is field-scoped, so two fields of one IPO never collide', () => {
    expect(alreadyRepairedKey('ipo-1', 'a')).not.toBe(alreadyRepairedKey('ipo-1', 'b'));
  });

  it('excludes rows this tool did not write (a foreign provenance row is not "already repaired")', () => {
    const set = buildAlreadyRepairedSet(rows, () => false);
    expect(set.size).toBe(0);
  });
});

describe('writeLedgerFile', () => {
  it('creates the directory and writes the payload as JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'repair-tool-'));
    try {
      const file = path.join(dir, 'nested', 'ledger.json');
      writeLedgerFile(file, [{ slug: 'a', changes: 1 }]);
      expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual([{ slug: 'a', changes: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#1045 — shared --ipo scope (test-isolation class)', () => {
  const UUID_A = '00000000-0000-4000-9161-000000000001';
  const UUID_B = '00000000-0000-4000-9161-000000000002';

  describe('collectFlagValues', () => {
    it('collects every occurrence of a repeatable flag', () => {
      expect(collectFlagValues(['--ipo', UUID_A, '--ipo', UUID_B, '--apply'], '--ipo')).toEqual([UUID_A, UUID_B]);
    });

    it('returns empty when the flag is absent', () => {
      expect(collectFlagValues(['--apply'], '--ipo')).toEqual([]);
    });

    it('does not swallow the next flag as a value', () => {
      expect(collectFlagValues(['--ipo', '--apply'], '--ipo')).toEqual([]);
    });

    it('MUTATION (#1053 MAJOR-1): parses the --flag=value single-token form', () => {
      expect(collectFlagValues([`--ipo=${UUID_A}`], '--ipo')).toEqual([UUID_A]);
    });
  });

  describe('parseIpoScope', () => {
    it('MUTATION: a flag unknown/ignored turns this red — recognizes a single --ipo value', () => {
      expect(parseIpoScope([UUID_A])).toEqual({ ipoIds: [UUID_A], invalid: [] });
    });

    it('splits comma-separated values from one --ipo', () => {
      expect(parseIpoScope([`${UUID_A},${UUID_B}`])).toEqual({ ipoIds: [UUID_A, UUID_B], invalid: [] });
    });

    it('merges repeated --ipo occurrences and dedupes', () => {
      expect(parseIpoScope([UUID_A, UUID_A, UUID_B])).toEqual({ ipoIds: [UUID_A, UUID_B], invalid: [] });
    });

    it('reports a non-uuid value as invalid rather than silently dropping or accepting it', () => {
      expect(parseIpoScope(['not-a-uuid'])).toEqual({ ipoIds: [], invalid: ['not-a-uuid'] });
    });

    it('is unscoped (empty ipoIds) when no --ipo is given', () => {
      expect(parseIpoScope([])).toEqual({ ipoIds: [], invalid: [] });
    });
  });

  describe('describeIpoScope', () => {
    it('names ALL IPOs when unscoped', () => {
      expect(describeIpoScope([])).toMatch(/ALL IPOs/);
    });

    it('names the scoped ids so the tool header states what it will touch', () => {
      expect(describeIpoScope([UUID_A, UUID_B])).toContain(UUID_A);
      expect(describeIpoScope([UUID_A, UUID_B])).toContain(UUID_B);
    });
  });

  /**
   * #1053 review round 2, MAJOR-1: every measured form where `--ipo` is
   * PRESENT in argv but `collectFlagValues`/`parseIpoScope` alone yield zero
   * ids and zero invalid tokens — indistinguishable, at the values level,
   * from "the flag was never given". A caller trusting only `ipoIds.length
   * === 0` treats each of these as unscoped/DB-wide, which for a --apply
   * repair tool means "every candidate row in the database". `resolveIpoScope`
   * must flag all five as `unusable: true` by inspecting argv directly.
   */
  describe('resolveIpoScope (#1053 MAJOR-1: present-but-unusable --ipo)', () => {
    it('MUTATION: is unusable when --ipo is immediately followed by another flag', () => {
      expect(resolveIpoScope(['--ipo', '--apply'])).toEqual({ ipoIds: [], invalid: [], unusable: true });
    });

    it('MUTATION: is unusable when --ipo is the trailing argv token', () => {
      expect(resolveIpoScope(['--expect-db', 'ipodhan_test', '--ipo'])).toEqual({
        ipoIds: [],
        invalid: [],
        unusable: true,
      });
    });

    it('MUTATION: is unusable when --ipo is given an empty string', () => {
      expect(resolveIpoScope(['--ipo', ''])).toEqual({ ipoIds: [], invalid: [], unusable: true });
    });

    it('MUTATION: is unusable when --ipo is given a bare comma', () => {
      expect(resolveIpoScope(['--ipo', ','])).toEqual({ ipoIds: [], invalid: [], unusable: true });
    });

    it('MUTATION: parses the --ipo=<uuid> single-token form rather than treating it as absent', () => {
      expect(resolveIpoScope([`--ipo=${UUID_A}`])).toEqual({ ipoIds: [UUID_A], invalid: [], unusable: false });
    });

    it('is NOT unusable, and unscoped, when --ipo is never given at all', () => {
      expect(resolveIpoScope(['--expect-db', 'ipodhan_test', '--apply'])).toEqual({
        ipoIds: [],
        invalid: [],
        unusable: false,
      });
    });

    it('is NOT unusable when --ipo carries a real uuid', () => {
      expect(resolveIpoScope(['--ipo', UUID_A])).toEqual({ ipoIds: [UUID_A], invalid: [], unusable: false });
    });

    it('reports invalid (not unusable) when --ipo carries a non-uuid token', () => {
      expect(resolveIpoScope(['--ipo', 'not-a-uuid'])).toEqual({ ipoIds: [], invalid: ['not-a-uuid'], unusable: false });
    });
  });

  describe('flagIsPresent', () => {
    it('is true for the bare flag', () => {
      expect(flagIsPresent(['--ipo', UUID_A], '--ipo')).toBe(true);
    });

    it('is true for the --flag=value form', () => {
      expect(flagIsPresent([`--ipo=${UUID_A}`], '--ipo')).toBe(true);
    });

    it('is false when the flag never appears', () => {
      expect(flagIsPresent(['--apply'], '--ipo')).toBe(false);
    });
  });

  describe('decideUndoIpoConflict (#1059 round 2, MINOR-2)', () => {
    it('true when --ipo is present and --undo was given', () => {
      expect(decideUndoIpoConflict(['--undo', 'x.json', '--ipo', UUID_A], true)).toBe(true);
    });

    it('true for --ipo=<uuid> alongside --undo (the single-token form)', () => {
      expect(decideUndoIpoConflict([`--ipo=${UUID_A}`, '--undo', 'x.json'], true)).toBe(true);
    });

    it('false when --undo was not given, even with --ipo present', () => {
      expect(decideUndoIpoConflict(['--ipo', UUID_A, '--apply'], false)).toBe(false);
    });

    it('false when --ipo is absent, even with --undo given', () => {
      expect(decideUndoIpoConflict(['--undo', 'x.json'], true)).toBe(false);
    });
  });

  /**
   * Flatten a drizzle SQL fragment to the literal text plus bound params.
   * `Param` (a `sql.param()` binding) and `StringChunk` (literal text, including
   * a nested `sql.raw()` fragment) both carry a `.value` array, so they are
   * told apart by constructor name — never by `Array.isArray(node.value)`
   * alone, which matches both and would silently read a bound array param as
   * literal text.
   */
  function flattenSql(node: any, out: { text: string[]; params: unknown[] } = { text: [], params: [] }) {
    if (node == null) return out;
    if (typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const n of node) flattenSql(n, out);
      return out;
    }
    if (Array.isArray(node.queryChunks)) {
      for (const chunk of node.queryChunks) flattenSql(chunk, out);
      return out;
    }
    if (node.constructor?.name === 'Param') {
      out.params.push(node.value);
      return out;
    }
    if (Array.isArray(node.value)) {
      out.text.push(node.value.join(''));
      return out;
    }
    if ('value' in node) {
      out.params.push(node.value);
      return out;
    }
    return out;
  }

  describe('buildIpoScopeCondition — the candidate-row filter itself', () => {
    it('MUTATION: an ignored --ipo turns this red — returns null (no filter) when unscoped', () => {
      expect(buildIpoScopeCondition([])).toBeNull();
    });

    it('builds an `ipo_id = ANY(...)` condition binding the ids as ONE array param, not a tuple', () => {
      const cond = buildIpoScopeCondition([UUID_A, UUID_B]);
      const flat = flattenSql(cond);
      expect(flat.text.join('')).toContain('ipo_id = ANY(');
      expect(flat.text.join('')).toContain('::uuid[]');
      // exactly one bound param carrying the whole id array — never one param per id
      expect(flat.params).toEqual([[UUID_A, UUID_B]]);
    });

    it('qualifies the column with a caller-supplied table alias (e.g. a joined query)', () => {
      const cond = buildIpoScopeCondition([UUID_A], 'p.ipo_id');
      const flat = flattenSql(cond);
      expect(flat.text.join('')).toContain('p.ipo_id = ANY(');
    });
  });
});

describe('MUTATION 4 — the ON CONFLICT arbiter of upsertFieldSource (item 1 slice s18)', () => {
  it('MUTATION: dropping rowKey from the target turns this red — the arbiter must name (ipo_id, table_name, row_key, field_name)', async () => {
    const tx = mockTx(null);
    await upsertFieldSource(tx as never, {
      ipoId: 'ipo-1',
      fieldName: 'issueSize',
      source: 'NSE',
      previousValue: null,
      dataLineage: { tool: 't' },
      updatedBy: 'test',
    });

    expect(tx.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const target = tx.onConflictDoUpdate.mock.calls[0][0].target as Array<{ name: string }>;
    // Postgres resolves ON CONFLICT to an arbiter INDEX whose columns match this
    // list exactly. After slice s18 the only unique index on field_sources is
    // the 4-column one, so a 3-column target here raises 42P10 on the FIRST
    // write of every repair tool — and scripts/ci/require-repair-tool-module.mjs
    // forces every repair tool through this function.
    expect(target.map((c) => c.name)).toEqual([
      'ipo_id',
      'table_name',
      'row_key',
      'field_name',
    ]);
  });
});

describe('decideStaleCorrectionSkip (#422)', () => {
  it('skips a LISTED row even when latestSourceDate/assumedFrom would otherwise pass', () => {
    const d = decideStaleCorrectionSkip({
      status: 'LISTED',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: null,
      currentValue: '2026-08-28',
    });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/status is LISTED/);
  });

  it('skips a CLOSED row', () => {
    expect(
      decideStaleCorrectionSkip({
        status: 'CLOSED',
        citationDate: '2026-08-23',
        latestSourceDate: null,
        assumedFromValue: null,
        currentValue: 'x',
      }).skip
    ).toBe(true);
  });

  it('skips when field_sources has a source newer than the citation', () => {
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: '2026-09-01',
      assumedFromValue: 'FPO',
      currentValue: 'FPO',
    });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/newer source/);
  });

  it('skips when the table entry carries no recorded from value', () => {
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      currentValue: null,
    });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/no recorded 'from' value/);
  });

  it('skips when the current value differs from the value the citation was taken against', () => {
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: 'FPO',
      currentValue: 'IPO',
    });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/current value/);
  });

  it('does not skip when the row is non-terminal, the source is not newer, and the current value matches from', () => {
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: '2026-08-20',
      assumedFromValue: 'FPO',
      currentValue: 'FPO',
    });
    expect(d.skip).toBe(false);
    expect(d.reason).toBeUndefined();
  });

  it('treats a null assumedFrom/currentValue pair as matching (not a false mismatch)', () => {
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: null,
      currentValue: null,
    });
    expect(d.skip).toBe(false);
  });

  // #422 round 2 (supervisor MAJOR): the raw `pg` driver's own OID-1082 (DATE)
  // type parser hands back `new Date(year, month - 1, day)` — LOCAL date
  // parts, not a UTC instant. Both the raw-`pg` repair tools AND drizzle's
  // default `date()` column mode (a pass-through of that same driver value)
  // receive exactly this shape for a live row's current DATE column value.
  // Before this fix, `String(dateObject)` never equalled a plain 'YYYY-MM-DD'
  // `from` string, so every date-typed correction was falsely skipped as
  // "changed since" even when nothing had changed. This test pins the real
  // pg parser's output — not a hand-typed Date — as the current value.
  it('treats a real pg-parsed DATE value as equal to its matching YYYY-MM-DD `from`, proceeding on a non-terminal row (#422 round 2)', () => {
    const parseDateOid1082 = pgTypes.getTypeParser(1082) as (v: string) => unknown;
    const currentValue = parseDateOid1082('2026-02-16');
    expect(currentValue).toBeInstanceOf(Date); // pin the shape this test depends on

    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: '2026-02-16',
      currentValue,
    });
    expect(d.skip).toBe(false);
    expect(d.reason).toBeUndefined();
  });

  it('NEVER uses toISOString() to compare a DATE value — that shifts IST midnight to the previous UTC calendar day', () => {
    // Reproduces the supervisor's exact probe: IST local midnight for
    // 2026-02-16, expressed as a Date the way the raw pg OID-1082 parser
    // builds one (local year/month/day components).
    const localMidnight = new Date(2026, 1, 16); // month is 0-indexed: Feb
    // The forbidden shape the reviewer's round-1 suggestion used.
    expect(localMidnight.toISOString().slice(0, 10)).not.toBe('2026-02-16');

    const d = decideStaleCorrectionSkip({
      status: 'OPEN',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: '2026-02-16',
      currentValue: localMidnight,
    });
    expect(d.skip).toBe(false);
  });

  it('still skips (does not falsely proceed) when the current DATE value is one calendar day different from `from`', () => {
    const parseDateOid1082 = pgTypes.getTypeParser(1082) as (v: string) => unknown;
    const currentValue = parseDateOid1082('2026-02-17');
    const d = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: '2026-02-16',
      currentValue,
    });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/current value/);
  });
});

describe('queryLatestFieldSourceDate (#422)', () => {
  it('returns null when no field_sources row exists', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    expect(await queryLatestFieldSourceDate(tx as any, { ipoId: 'x', fieldName: 'openDate' })).toBeNull();
  });

  it('returns the updatedAt date as YYYY-MM-DD', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ updatedAt: new Date('2026-09-01T12:00:00Z') }],
          }),
        }),
      }),
    };
    expect(await queryLatestFieldSourceDate(tx as any, { ipoId: 'x', fieldName: 'openDate' })).toBe('2026-09-01');
  });
});
