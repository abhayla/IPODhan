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
import {
  alreadyRepairedKey,
  assertNoSchemaDrift,
  buildAlreadyRepairedSet,
  buildIpoScopeCondition,
  collectFlagValues,
  decideCacheInvalidationBlock,
  decideProdWriteRefusal,
  decideSchemaDriftRefusal,
  describeIpoScope,
  flagIsPresent,
  formatCacheInvalidationBlockNotice,
  guardCacheInvalidation,
  openRepairDb,
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
    const r = await openRepairDb({ execute }, { apply: false, allowProd: false, toolName: 't', log, error: vi.fn() });
    expect(log).toHaveBeenCalledWith('current_database(): ipodhan_staging');
    expect(r).toEqual({ dbName: 'ipodhan_staging', isProd: false });
  });

  it('MUTATION: deleting the refusal branch turns this red — an --apply on prod calls onRefuse and prints the reason', async () => {
    const onRefuse = vi.fn();
    const error = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan' }]);
    await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 'tool-x', log: vi.fn(), error, onRefuse });
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('tool-x: refusing to APPLY'));
  });

  it('does not refuse an authorized prod apply, and says so', async () => {
    const log = vi.fn();
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: 'ipodhan' }]);
    const r = await openRepairDb({ execute }, { apply: true, allowProd: true,
      toolName: 't', log, error: vi.fn(), onRefuse });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r.isProd).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ALLOW-PROD'));
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
    const r = await openRepairDb({ execute }, { apply: true, allowProd: false, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r).toEqual({ dbName: 'ipodhan_staging', isProd: false });
  });

  it('an --apply against prod (--allow-prod given) succeeds with no Redis env set — the prod-write guard and the retired Redis guard are independent', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    const onRefuse = vi.fn();
    const execute = vi.fn().mockResolvedValue([{ name: PRODUCTION_DATABASE_NAME }]);
    const r = await openRepairDb({ execute }, { apply: true, allowProd: true, toolName: 'tool-x', log: vi.fn(), error: vi.fn(), onRefuse });
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
