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
 * production's read path.
 *
 * Tier A review round 1 (PR #666) found three MAJORs: (1) the prod pool had
 * no server-enforced read-only guard, (2) mutations to the apply-body logic
 * survived because it lived inline in `main()` with no seam to test, (3) the
 * shared repair-tool filename lint never inspected this file; plus one
 * MINOR: a bare `.limit(1)` with no ORDER BY on the slug lookup.
 *
 * Lane B / staging review round 2 found a further bug the round-1 fix
 * introduced no test for: `IPOS_FIELD_COLUMNS` was keyed by aliases
 * (`price_band_low`/`price_band_high`) that are the names of a DEAD column
 * pair on `ipos` (T-276 — see `price-band-single-scheme.test.ts`), so
 * `field_sources.field_name` was written as that dead, snake_case alias
 * instead of the real camelCase drizzle property (`priceRangeMin`/
 * `priceRangeMax`) every other repair tool in this directory uses. This
 * file's field-name assertions and the two new describe blocks at the
 * bottom (exact field_name strings; never write provenance for a null
 * value) are round 2's fix.
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

describe('IPOS_FIELD_COLUMNS / DEFAULT_FIELDS — real camelCase column keys, never the dead price_band_low/high alias (round 2)', () => {
  it('the field keys are the real drizzle/schema camelCase property names', () => {
    expect(Object.keys(IPOS_FIELD_COLUMNS).sort()).toEqual(
      ['issueSize', 'lotSize', 'priceRangeMax', 'priceRangeMin'].sort()
    );
    expect(DEFAULT_FIELDS.sort()).toEqual(['issueSize', 'lotSize', 'priceRangeMax', 'priceRangeMin'].sort());
  });

  it('MUTATION: the dead price_band_low/price_band_high alias names never appear as field keys', () => {
    const keys = Object.keys(IPOS_FIELD_COLUMNS);
    expect(keys).not.toContain('price_band_low');
    expect(keys).not.toContain('price_band_high');
    expect(keys).not.toContain('priceBandLow');
    expect(keys).not.toContain('priceBandHigh');
  });
});

describe('computeFieldDiffs — dry run computes the diff, writes nothing (no DB)', () => {
  it('marks fields differing between staging and prod values', () => {
    const staging = { priceRangeMin: 10, priceRangeMax: 10, issueSize: '43320000.00', lotSize: 4000 };
    const prod = { priceRangeMin: 85, priceRangeMax: 90, issueSize: '1990000000.00', lotSize: 4000 };
    const diffs = computeFieldDiffs(DEFAULT_FIELDS, staging, prod);
    expect(diffs.find((d) => d.field === 'priceRangeMin')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'priceRangeMax')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'issueSize')?.differs).toBe(true);
    expect(diffs.find((d) => d.field === 'lotSize')?.differs).toBe(false); // same on both
  });

  it('produces zero differing fields when staging already matches prod', () => {
    const row = { priceRangeMin: 85, priceRangeMax: 90, issueSize: '1990000000.00', lotSize: 4000 };
    const diffs = computeFieldDiffs(DEFAULT_FIELDS, row, row);
    expect(diffs.every((d) => !d.differs)).toBe(true);
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

describe('applyRefresh — the write body extracted from main(), tested against fakes (finding 2); write-ratchet routing (round 4)', () => {
  function mockTx(existingSource: string | null = null) {
    const limit = vi.fn().mockResolvedValue(existingSource ? [{ source: existingSource }] : []);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    return { select, insert, values, onConflictDoUpdate };
  }

  /**
   * Fake repository standing in for IPORepository — `applyRefresh` never
   * calls `db.update(schema.ipos)` directly (round 4: PR #666 CI's write
   * ratchet, T-316/R0, refused this file as a new direct `ipos` writer). It
   * must call `applyOfferTerms(id, data)` on whatever `makeRepo(tx)` returns.
   */
  function mockRepo() {
    const applyOfferTerms = vi.fn().mockResolvedValue(undefined);
    return { applyOfferTerms };
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

  const fakeSelect = () =>
    vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: 'ipo-stallion' }]) }) }),
    });

  it('MUTATION: writes the backup BEFORE opening the transaction — call order asserted', async () => {
    const tx = mockTx();
    const repo = mockRepo();
    const calls: string[] = [];
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => {
      calls.push('transaction-start');
      await fn(tx);
      calls.push('transaction-end');
    });
    const select = fakeSelect();
    const makeRepo = vi.fn().mockReturnValue(repo);

    const diffs = computeFieldDiffs(['priceRangeMin'], { priceRangeMin: 10 }, { priceRangeMin: 85 });
    const input = baseInput(diffs);
    const writeBackup = vi.fn().mockImplementation((path: string) => {
      calls.push('backup-written');
      return path;
    });

    await applyRefresh({ transaction, select, makeRepo }, { ...input, writeBackup });

    expect(calls).toEqual(['backup-written', 'transaction-start', 'transaction-end']);
  });

  it('MUTATION: exactly one upsertFieldSource per changed field, not per row', async () => {
    const tx = mockTx();
    const repo = mockRepo();
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = fakeSelect();
    const makeRepo = vi.fn().mockReturnValue(repo);
    const diffs = computeFieldDiffs(
      ['priceRangeMin', 'priceRangeMax', 'issueSize'],
      { priceRangeMin: 10, priceRangeMax: 10, issueSize: '43320000.00' },
      { priceRangeMin: 85, priceRangeMax: 90, issueSize: '1990000000.00' }
    );
    const upsert = vi.fn().mockResolvedValue({ previousSource: null });
    const input = baseInput(diffs);

    await applyRefresh({ transaction, select, makeRepo }, { ...input, upsert });

    expect(upsert).toHaveBeenCalledTimes(3);
    const fieldsUpserted = upsert.mock.calls.map((c: any[]) => c[1].fieldName).sort();
    expect(fieldsUpserted).toEqual(['issueSize', 'priceRangeMax', 'priceRangeMin']);
  });

  it('MUTATION: zero differing fields => no repository call, no backup, no provenance, wrote=false', async () => {
    const transaction = vi.fn();
    const select = vi.fn();
    const makeRepo = vi.fn();
    const writeBackup = vi.fn();
    const writeLedger = vi.fn();
    const upsert = vi.fn();

    const diffs = computeFieldDiffs(['lotSize'], { lotSize: 4000 }, { lotSize: 4000 }); // identical -> 0 differing
    const input = baseInput(diffs.filter((d) => d.differs)); // mirrors main(): applyRefresh receives only the differing fields

    const result = await applyRefresh({ transaction, select, makeRepo }, { ...input, writeBackup, writeLedger, upsert });

    expect(result.wrote).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(makeRepo).not.toHaveBeenCalled();
    expect(writeBackup).not.toHaveBeenCalled();
    expect(writeLedger).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes the provenance row with source ADMIN, field_name = the real camelCase column key, and a dated note', async () => {
    const tx = mockTx(null);
    const repo = mockRepo();
    const diffs = computeFieldDiffs(
      ['priceRangeMin', 'priceRangeMax'],
      { priceRangeMin: 10, priceRangeMax: 10 },
      { priceRangeMin: 85, priceRangeMax: 90 }
    );
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = fakeSelect();
    const makeRepo = vi.fn().mockReturnValue(repo);
    const input = baseInput(diffs);

    await applyRefresh({ transaction, select, makeRepo }, input);

    expect(tx.insert).toHaveBeenCalledTimes(2);
    const rows = tx.values.mock.calls.map((c: any[]) => c[0]);
    const fieldNames = rows.map((r: any) => r.fieldName).sort();
    // MUTATION: exact field_name strings — the real camelCase column keys,
    // never the dead price_band_low/price_band_high alias.
    expect(fieldNames).toEqual(['priceRangeMax', 'priceRangeMin']);
    expect(fieldNames).not.toContain('price_band_low');
    expect(fieldNames).not.toContain('price_band_high');
    const firstRow = rows[0];
    expect(firstRow.source).toBe('ADMIN');
    expect(firstRow.dataLineage.reason).toMatch(/refreshed from production read path/);
    expect(firstRow.previousValue).toBe('10');
  });

  it('MUTATION (finding 2): never writes a provenance row for a field whose production value is null', async () => {
    const tx = mockTx(null);
    const repo = mockRepo();
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = fakeSelect();
    const makeRepo = vi.fn().mockReturnValue(repo);
    // priceRangeMin differs and prod has a real value; priceRangeMax differs
    // but prod's value is null — this field must be silently dropped, not
    // written with a null and not given a provenance row.
    const diffs = computeFieldDiffs(
      ['priceRangeMin', 'priceRangeMax'],
      { priceRangeMin: 10, priceRangeMax: 10 },
      { priceRangeMin: 85, priceRangeMax: null }
    );
    const input = baseInput(diffs);

    const result = await applyRefresh({ transaction, select, makeRepo }, input);

    expect(result.wrote).toBe(true);
    expect(tx.insert).toHaveBeenCalledTimes(1); // only priceRangeMin
    const fieldNames = tx.values.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(fieldNames).toEqual(['priceRangeMin']);
    expect(fieldNames).not.toContain('priceRangeMax');
    // The repository call must reflect the same drop — only the non-null field.
    expect(repo.applyOfferTerms).toHaveBeenCalledTimes(1);
    expect(repo.applyOfferTerms.mock.calls[0][1]).toEqual({ priceRangeMin: 85 });
  });

  it('MUTATION (finding 2): when EVERY differing field is null on production, nothing is written at all', async () => {
    const transaction = vi.fn();
    const select = vi.fn();
    const makeRepo = vi.fn();
    const writeBackup = vi.fn();
    const upsert = vi.fn();

    const diffs = computeFieldDiffs(['priceRangeMax'], { priceRangeMax: 10 }, { priceRangeMax: null });
    const input = baseInput(diffs);

    const result = await applyRefresh({ transaction, select, makeRepo }, { ...input, writeBackup, upsert });

    expect(result.wrote).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(makeRepo).not.toHaveBeenCalled();
    expect(writeBackup).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('MUTATION (round 4, write-ratchet routing): the ipos write goes through repo.applyOfferTerms(id, data), never a direct db.update(schema.ipos)', async () => {
    const tx = mockTx();
    const repo = mockRepo();
    const transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const select = fakeSelect();
    const makeRepo = vi.fn().mockReturnValue(repo);
    const diffs = computeFieldDiffs(
      ['priceRangeMin', 'priceRangeMax', 'issueSize', 'lotSize'],
      { priceRangeMin: 10, priceRangeMax: 10, issueSize: '43320000.00', lotSize: 4000 },
      { priceRangeMin: 85, priceRangeMax: 90, issueSize: '1990000000.00', lotSize: 4000 } // lotSize unchanged
    );
    const input = baseInput(diffs.filter((d) => d.differs)); // mirrors main(): only the 3 differing fields

    await applyRefresh({ transaction, select, makeRepo }, input);

    // makeRepo is called with the TRANSACTION handle, never the outer db —
    // the repository write must run on the same connection as the
    // provenance rows (all-or-nothing).
    expect(makeRepo).toHaveBeenCalledWith(tx);
    expect(repo.applyOfferTerms).toHaveBeenCalledTimes(1);
    const [id, data] = repo.applyOfferTerms.mock.calls[0];
    expect(id).toBe('ipo-stallion');
    expect(data).toEqual({ priceRangeMin: 85, priceRangeMax: 90, issueSize: '1990000000.00' });
    // No raw drizzle table access on the transaction handle at all — the
    // write-ratchet's `drizzle` pattern (`\.(insert|update|delete)\(\s*
    // (schema\.)?ipos\b`) must never match anything applyRefresh emits.
    expect((tx as any).update).toBeUndefined();
  });
});
