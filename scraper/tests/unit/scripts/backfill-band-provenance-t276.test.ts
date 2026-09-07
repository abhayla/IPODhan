import { describe, it, expect, vi } from 'vitest';
import {
  parseAppliedLedger,
  decideBandProvenanceRepair,
  resolveDatabaseName,
  PRODUCTION_DATABASE_NAME,
  buildDataLineage,
  upsertBandFieldSourceProvenance,
  BACKFILL_UPDATED_BY,
} from '../../../scripts/backfill-band-provenance-t276.js';

const SAMPLE_CSV = [
  'slug,companyName,dbSymbol,beforeMin,beforeMax,afterMin,afterMax,action,matchedBy,sourceEndpoint,sourceCompany,sourceSymbol,sourceRaw',
  'silverstorm-parks-and-resorts-ltd,Silverstorm Parks and Resorts,SSPRL,133,133,,,SKIP_NO_MATCH,,,,,',
  'technocraft-ventures-ltd,Technocraft Ventures Ltd.,TECHNOCRAF,212,212,200,212,UPDATED,symbol,/api/public-past-issues,Technocraft Ventures Limited,TECHNOCRAF,Rs.200 to Rs.212',
  'sunshine-pictures-ltd,Sunshine Pictures Ltd.,SUNSHINE,360,360,342,360,UPDATED,symbol,/api/public-past-issues,Sunshine Pictures Limited,SUNSHINE,Rs.342 to Rs.360',
].join('\n');

describe('parseAppliedLedger (#165)', () => {
  it('keeps only UPDATED rows with numeric afterMin/afterMax', () => {
    const rows = parseAppliedLedger(SAMPLE_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ slug: 'technocraft-ventures-ltd', afterMin: 200, afterMax: 212 });
    expect(rows[1]).toEqual({ slug: 'sunshine-pictures-ltd', afterMin: 342, afterMax: 360 });
  });

  it('drops SKIP_NO_MATCH / SKIP_DEGENERATE_SOURCE rows (never wrote the DB)', () => {
    const rows = parseAppliedLedger(SAMPLE_CSV);
    expect(rows.find((r) => r.slug === 'silverstorm-parks-and-resorts-ltd')).toBeUndefined();
  });

  it('throws on a malformed header (missing an expected column)', () => {
    expect(() => parseAppliedLedger('slug,companyName\na,b')).toThrow(/missing an expected column/);
  });
});

describe('decideBandProvenanceRepair (#165)', () => {
  it('writes when the current band still matches the ledger corrected value', () => {
    const d = decideBandProvenanceRepair({ currentMin: 200, currentMax: 212, ledgerMin: 200, ledgerMax: 212 });
    expect(d.write).toBe(true);
  });

  it('skips when the current band has since changed (never overwrites an unrelated later edit)', () => {
    const d = decideBandProvenanceRepair({ currentMin: 205, currentMax: 212, ledgerMin: 200, ledgerMax: 212 });
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/no longer matches/);
  });

  it('skips when the row now has no band at all', () => {
    const d = decideBandProvenanceRepair({ currentMin: null, currentMax: null, ledgerMin: 200, ledgerMax: 212 });
    expect(d.write).toBe(false);
  });
});

describe('resolveDatabaseName / production guard (#165)', () => {
  it('resolves the db name from DATABASE_URL', () => {
    expect(resolveDatabaseName({ DATABASE_URL: 'postgresql://u:p@localhost:15432/ipodhan_staging' } as NodeJS.ProcessEnv)).toBe('ipodhan_staging');
  });

  it('the production database name is exactly "ipodhan"', () => {
    expect(PRODUCTION_DATABASE_NAME).toBe('ipodhan');
  });
});

describe('buildDataLineage (#165)', () => {
  it('carries the fixed note and the ledger path', () => {
    const l = buildDataLineage('/some/path/33-applied-ledger.csv');
    expect(l.note).toBe('T-276 band repair provenance backfill 2026-09-07');
    expect(l.ledger).toBe('/some/path/33-applied-ledger.csv');
  });
});

/**
 * RED-first regression (#165 F1): before this backfill, field_sources for one of the 87
 * ledger rows credits CHITTORGARH/MONEYCONTROL/whatever last consolidated the OLD (wrong)
 * band — not NSE, which is where the T-276 corrected value actually came from. This test
 * proves the repair function stamps NSE regardless of what was there before, and PRESERVES
 * the wrong prior source in previous_source (the audit trail, not silently dropped).
 */
describe('upsertBandFieldSourceProvenance (#165 F1 — red-then-green)', () => {
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

  it('stamps source=NSE and keeps the stale source as previous_source', async () => {
    const tx = mockTx('CHITTORGARH');
    await upsertBandFieldSourceProvenance(tx as any, {
      ipoId: 'ipo-1',
      fieldName: 'priceRangeMin',
      previousValue: 212,
      ledgerPath: '/x/33-applied-ledger.csv',
      updatedBy: BACKFILL_UPDATED_BY,
    });
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'NSE',
        confidence: 100,
        previousSource: 'CHITTORGARH',
        previousValue: '212',
        fieldName: 'priceRangeMin',
      })
    );
  });

  it('leaves previous_source null when no field_sources row exists yet', async () => {
    const tx = mockTx(null);
    await upsertBandFieldSourceProvenance(tx as any, {
      ipoId: 'ipo-2',
      fieldName: 'priceRangeMax',
      previousValue: null,
      ledgerPath: '/x/33-applied-ledger.csv',
      updatedBy: BACKFILL_UPDATED_BY,
    });
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({ source: 'NSE', previousSource: null, previousValue: null }));
  });
});
