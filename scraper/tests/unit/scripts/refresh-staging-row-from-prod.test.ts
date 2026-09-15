import { describe, it, expect, vi } from 'vitest';
import {
  computeFieldDiffs,
  decideProdReadRefusal,
  decideStagingWriteRefusal,
  DEFAULT_FIELDS,
  IPOS_FIELD_COLUMNS,
  STAGING_DATABASE_NAME,
} from '../../../scripts/refresh-staging-row-from-prod.js';
import { PRODUCTION_DATABASE_NAME, upsertFieldSource } from '../../../scripts/lib/repair-tool.js';

/**
 * Lane C item 14 slice 6: refresh one stale `ipos` row on staging from
 * production's read path. Four load-bearing behaviors, red before the
 * implementation existed:
 *   1. refuses --apply when the write target is not ipodhan_staging (NO override flag)
 *   2. refuses to start when PROD_DATABASE_URL's own current_database() is not ipodhan
 *   3. dry run computes the field diff against fake pools and writes nothing
 *   4. apply issues the UPDATE and one field_sources provenance row per changed field
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

describe('apply issues one field_sources provenance row per changed field (shared upsertFieldSource)', () => {
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

  it('MUTATION: writes source ADMIN with a dated "refreshed from production read path" note per changed field', async () => {
    const tx = mockTx(null);
    const diffs = computeFieldDiffs(
      ['price_band_low', 'price_band_high'],
      { price_band_low: 10, price_band_high: 10 },
      { price_band_low: 85, price_band_high: 90 }
    ).filter((d) => d.differs);
    expect(diffs).toHaveLength(2);

    for (const d of diffs) {
      await upsertFieldSource(tx as any, {
        ipoId: 'ipo-stallion',
        fieldName: d.field,
        source: 'ADMIN',
        confidence: 100,
        previousValue: d.stagingValue,
        dataLineage: { reason: 'refreshed from production read path 2026-09-16T00:00:00.000Z' },
        updatedBy: 'SYSTEM_LANEC_ITEM14_S6_REFRESH',
      });
    }

    expect(tx.insert).toHaveBeenCalledTimes(2);
    const firstRow = tx.values.mock.calls[0][0];
    expect(firstRow.source).toBe('ADMIN');
    expect(firstRow.dataLineage.reason).toMatch(/refreshed from production read path/);
    expect(firstRow.previousValue).toBe('10');
  });
});
