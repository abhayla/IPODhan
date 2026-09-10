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
import { describe, it, expect, vi } from 'vitest';
import {
  alreadyRepairedKey,
  buildAlreadyRepairedSet,
  decideProdWriteRefusal,
  openRepairDb,
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
    const r = await openRepairDb({ execute }, { apply: true, allowProd: true, toolName: 't', log, error: vi.fn(), onRefuse });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(r.isProd).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ALLOW-PROD'));
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
