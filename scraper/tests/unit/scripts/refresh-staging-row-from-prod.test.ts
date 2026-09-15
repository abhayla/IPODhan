import { describe, it, expect, vi } from 'vitest';
import {
  applyRefresh,
  computeFieldDiffs,
  countAndFetchBySlug,
  decideProdReadRefusal,
  decideStagingWriteRefusal,
  DEFAULT_FIELDS,
  IPOS_FIELD_COLUMNS,
  PROD_POOL_OPTIONS,
  STAGING_DATABASE_NAME,
} from '../../../scripts/refresh-staging-row-from-prod.js';
import { PRODUCTION_DATABASE_NAME, upsertFieldSource } from '../../../scripts/lib/repair-tool.js';

/**
 * Lane C item 14 slice 6: refresh one stale `ipos` row on staging from
 * production's read path. Tier A review (PR #666) found three MAJORs after
 * the first pass: (1) the prod pool had no server-enforced read-only guard,
 * (2) mutations to the apply-body logic survived because it lived inline in
 * `main()` with no seam to test, (3) the shared repair-tool filename lint
 * never inspected this file. This test file's structure follows that
 * finding order.
 */

describe('decideStagingWriteRefusal — the ONLY database this tool ever writes to', () => {
  it('MUTATION: deleting the refusal turns this red — refuses --apply when the target is production', () => {
    const d = decideStagingWriteRefusal({ apply: true, dbName: 'ipodhan' });
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/refusing to APPLY/);
    expect(d.reason).toMatch(/ipodhan/);
    expect(d.reason).not.toMatch(/--allow-prod/); // this tool has no such flag
  });

  it('refuses --apply against any database that is not exactly ipodhan_staging', () => {
    expect(decideStagingWriteRefusal({ apply: true, dbName: 'ipodhan_test' }).refuse).toBe(true);
    expect(decideStagingWriteRefusal({ apply: true, dbName: 'some_other_db' }).refuse).toBe(true);
  });

  it('allows --apply when the write target really is ipodhan_staging', () => {
    expect(decideStagingWriteRefusal({ apply: true, dbName: STAGING_DATABASE_NAME }).refuse).toBe(false);
  });

  it('never refuses a dry run, even against production (a dry run writes nothing)', () => {
    expect(decideStagingWriteRefusal({ apply: false, dbName: 'ipodhan' }).refuse).toBe(false);
  });

  it('STAGING_DATABASE_NAME is exactly "ipodhan_staging"', () => {
    expect(STAGING_DATABASE_NAME).toBe('ipodhan_staging');
  });
});

describe('decideProdReadRefusal — the read source must really be production', () => {
  it('MUTATION: deleting the refusal turns this red — refuses when PROD_DATABASE_URL names a non-prod database', () => {
    const d = decideProdReadRefusal('ipodhan_staging');
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/ipodhan_staging/);
  });

  it('allows when PROD_DATABASE_URL really is ipodhan', () => {
    expect(decideProdReadRefusal(PRODUCTION_DATABASE_NAME).refuse).toBe(false);
  });

  it('is case-sensitive-safe (still refuses a wrong name in any case)', () => {
    expect(decideProdReadRefusal('IPODHAN_STAGING').refuse).toBe(true);
  });
});

describe('PROD_POOL_OPTIONS — the prod connection is read-only at the SERVER, not just by convention (finding 1)', () => {
  it('MUTATION: removing default_transaction_read_only=on turns this red', () => {
    expect(PROD_POOL_OPTIONS).toMatch(/default_transaction_read_only=on/);
  });

  it('still sets the session timezone to UTC alongside the read-only flag', () => {
    expect(PROD_POOL_OPTIONS).toMatch(/timezone=UTC/);
  });
});

describe('computeFieldDiffs — dry run computes the diff, writes nothing (no DB)', () => {
  it('marks fields differing between staging and prod values', () => {
    const staging = { price_band_low: 10, price_band_high: 10, issue_size: '43320000.00', lot_size: 4000 };
    const prod = { price_band_low: 85, price_band_high: 90, issue_size: '1990000000.00', lot_size: 4000 };
    const diffs = computeFieldDiffs(DEFAULT_FIELDS, staging, prod);
    expect(diffs.find((d) => d.field === 'price_band_low')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'price_band_high')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'issue_size')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'lot_size')?.differs).toBe(false); // same on both
  });

  it('produces zero differing fields when staging already matches prod', () => {
    const row = { price_band_low: 85, price_band_high: 90, issue_size: '1990000000.00', lot_size: 4000 };
    const diffs = computeFieldDiffs(DEFAULT_FIELDS, row, row);
    expect(diffs.every((d) => !d.differs)).toBe(true);
  });

  it('the four real ipos columns are wired for the default fields', () => {
    expect(Object.keys(IPOS_FIELD_COLUMNS).sort()).toEqual(
      ['issue_size', 'lot_size', 'price_band_high', 'price_band_low'].sort()
    );
    expect(DEFAULT_FIELDS.sort()).toEqual(
      ['issue_size', 'lot_size', 'price_band_high', 'price_band_low'].sort()
    );
  });
});

/** A fake selectable that answers a COUNT query then a row query, in that order. */
function fakeCountAndFetchDb(count: number, row: Record<string, unknown> | null) {
  let call = 0;
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const whereForRow = vi.fn().mockReturnValue({ limit });
  const whereForCount = vi.fn().mockResolvedValue([{ n: count }]);
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    // First .from() belongs to the count select, second to the row select.
    return call === 1 ? { where: whereForCount } : { where: whereForRow };
  });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

describe('countAndFetchBySlug — a COUNT first, never a bare .limit(1) with no ORDER BY (finding 4)', () => {
  it('returns count=1 and the row when the slug matches exactly one row', async () => {
    const dbLike = fakeCountAndFetchDb(1, { id: 'ipo-1', companyName: 'STALLION' });
    const result = await countAndFetchBySlug(dbLike, { id: 1 }, 'stallion-india-fluorochemicals-ltd');
    expect(result.count).toBe(1);
    expect(result.row).toEqual({ id: 'ipo-1', companyName: 'STALLION' });
  });

  it('MUTATION: returns count=0 and a null row when the slug matches nothing (never silently proceeds)', async () => {
    const dbLike = fakeCountAndFetchDb(0, null);
    const result = await countAndFetchBySlug(dbLike, { id: 1 }, 'no-such-slug');
    expect(result.count).toBe(0);
    expect(result.row).toBeNull();
  });

  it('MUTATION: returns count=2 and a null row when the slug is ambiguous (never picks an arbitrary row)', async () => {
    const dbLike = fakeCountAndFetchDb(2, { id: 'ipo-1', companyName: 'DUPLICATE' });
    const result = await countAndFetchBySlug(dbLike, { id: 1 }, 'ambiguous-slug');
    expect(result.count).toBe(2);
    expect(result.row).toBeNull(); // the row fetch is skipped entirely when count !== 1
  });
});

describe('applyRefresh — the write body extracted from main(), tested against fakes (finding 2)', () => {
  function mockTx(existingSource: string | null = null) {
    const limit = vi.fn().mockResolvedValue(existingSource ? [{ source: existingSource }] : []);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    return { select, insert, values, onConflictDoUpdate, update };
  }

  function baseInput(toWrite: ReturnType<typeof computeFieldDiffs>) {
    return {
      slug: 'stallion-india-fluorochemicals-ltd',
      stagingRow: { id: 'ipo-stallion', companyName: 'STALLION' },
      toWrite,
      selectCols: { id: 1 },
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup: vi.fn().mockReturnValue('evidence/backup.json'),
      writeLedger: vi.fn().mockReturnValue('evidence/applied.json'),
      upsert: upsertFieldSource,
    };
  }

  it('MUTATION: writes the backup BEFORE opening the transaction — call order asserted', async () => {
    const tx = mockTx();
    const calls: string[] = [];
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => {
      calls.push('transaction-start');
      await fn(tx);
      calls.push('transaction-end');
    });
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: 'ipo-stallion' }]) }) }),
    });

    const diffs = computeFieldDiffs(['price_band_low'], { price_band_low: 10 }, { price_band_low: 85 });
    const input = baseInput(diffs);
    const writeBackup = vi.fn().mockImplementation((path: string) => {
      calls.push('backup-written');
      return path;
    });

    await applyRefresh({ transaction, select }, { ...input, writeBackup });

    expect(calls).toEqual(['backup-written', 'transaction-start', 'transaction-end']);
  });

  it('MUTATION: exactly one upsertFieldSource per changed field, not per row', async () => {
    const tx = mockTx();
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: 'ipo-stallion' }]) }) }),
    });
    const diffs = computeFieldDiffs(
      ['price_band_low', 'price_band_high', 'issue_size'],
      { price_band_low: 10, price_band_high: 10, issue_size: '43320000.00' },
      { price_band_low: 85, price_band_high: 90, issue_size: '1990000000.00' }
    );
    const upsert = vi.fn().mockResolvedValue({ previousSource: null });
    const input = baseInput(diffs);

    await applyRefresh({ transaction, select }, { ...input, upsert });

    expect(upsert).toHaveBeenCalledTimes(3);
    const fieldsUpserted = upsert.mock.calls.map((c: any[]) => c[1].fieldName).sort();
    expect(fieldsUpserted).toEqual(['issue_size', 'price_band_high', 'price_band_low']);
  });

  it('MUTATION: zero differing fields => no UPDATE, no backup, no provenance, wrote=false', async () => {
    const transaction = vi.fn();
    const select = vi.fn();
    const writeBackup = vi.fn();
    const writeLedger = vi.fn();
    const upsert = vi.fn();

    const diffs = computeFieldDiffs(['lot_size'], { lot_size: 4000 }, { lot_size: 4000 }); // identical -> 0 differing
    const input = baseInput(diffs.filter((d) => d.differs)); // mirrors main(): applyRefresh receives only the differing fields

    const result = await applyRefresh({ transaction, select }, { ...input, writeBackup, writeLedger, upsert });

    expect(result.wrote).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(writeBackup).not.toHaveBeenCalled();
    expect(writeLedger).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes the provenance row with source ADMIN and a dated "refreshed from production read path" note', async () => {
    const tx = mockTx(null);
    const diffs = computeFieldDiffs(
      ['price_band_low', 'price_band_high'],
      { price_band_low: 10, price_band_high: 10 },
      { price_band_low: 85, price_band_high: 90 }
    );
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: 'ipo-stallion' }]) }) }),
    });
    const input = baseInput(diffs);

    await applyRefresh({ transaction, select }, input);

    expect(tx.insert).toHaveBeenCalledTimes(2);
    const firstRow = tx.values.mock.calls[0][0];
    expect(firstRow.source).toBe('ADMIN');
    expect(firstRow.dataLineage.reason).toMatch(/refreshed from production read path/);
    expect(firstRow.previousValue).toBe('10');
  });
});
