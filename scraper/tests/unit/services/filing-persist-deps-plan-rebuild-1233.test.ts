/**
 * #1233 round 2 MINOR-1: the plan rebuilder the filing write hands to the `ipos` transaction takes
 * the `ipos` row lock FOR NO KEY UPDATE before it rebuilds (the lock the admin save and the plant
 * take), in the SAME tx it is given, and passes the before-slice through unchanged. And the
 * listing-precedence reader filters documents the way the check does (`is_active IS NOT FALSE`).
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@ipodhan/shared', () => {
  class StubRepo {}
  return {
    db: {},
    getRedisClient: () => ({}),
    filterProtectedFields: async () => ({ filtered: {} }),
    IPORepository: StubRepo,
    FinancialStatementsRepository: StubRepo,
    IpoValuationRepository: StubRepo,
    PromotersRepository: StubRepo,
    IpoIntermediariesRepository: StubRepo,
    BrlmTrackRecordRepository: StubRepo,
    FinancialDataRepository: StubRepo,
    FieldSourcesRepository: StubRepo,
    DataConflictsRepository: StubRepo,
    IpoRiskFactorsRepository: StubRepo,
    DocumentRepository: StubRepo,
  };
});
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: class {},
}));
vi.mock('../../../src/repositories/peer-company-repository.js', () => ({
  PeerCompanyRepository: class {},
}));

import { makePlanRebuilder, makeListingPrecedenceReader } from '../../../src/services/filing-persist-deps.js';

const dialect = new PgDialect();
const text = (q: unknown) => dialect.sqlToQuery(q as never).sql.replace(/\s+/g, ' ');

describe('#1233 round 2 makePlanRebuilder', () => {
  it('locks the ipos row FOR NO KEY UPDATE in the given tx BEFORE the rebuild, then rebuilds in that tx', async () => {
    const order: string[] = [];
    const tx = { execute: vi.fn(async (q: unknown) => { order.push(`execute: ${text(q)}`); return { rows: [] }; }) };
    const rebuild = vi.fn(async (t: unknown) => {
      order.push(`rebuild in ${t === tx ? 'same tx' : 'OTHER tx'}`);
      return { rebuilt: true, typeKeyBefore: 'MAINBOARD', typeKeyAfter: 'SME_NSE', planned: 0, kept: 0, replanted: 0, dropped: 0, added: 0, queued: 0 };
    });
    const before = { segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' };
    const r = await makePlanRebuilder({ version: 2, fields: {} } as never, rebuild as never)(tx, 'ipo-1', before);
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/^execute: select 1 from ipos where id = \$1::uuid for no key update$/i);
    expect(order[1]).toBe('rebuild in same tx');
    expect(rebuild).toHaveBeenCalledWith(tx, 'ipo-1', { version: 2, fields: {} }, before);
    expect(r.rebuilt).toBe(true);
  });

  it('a rebuild failure propagates (the caller transaction rolls back)', async () => {
    const tx = { execute: vi.fn(async () => ({ rows: [] })) };
    const rebuild = vi.fn(async () => { throw new Error('boom'); });
    await expect(makePlanRebuilder({ version: 2, fields: {} } as never, rebuild as never)(tx, 'ipo-1', { segment: null, listingExchanges: null, offeringType: 'IPO' })).rejects.toThrow('boom');
  });
});

describe('#1233 round 2 makeListingPrecedenceReader', () => {
  it('reads active (IS NOT FALSE), COMPLETED listing-sentence documents; an ad only with a listing receipt; never itself', async () => {
    const seen: string[] = [];
    const database = {
      execute: vi.fn(async (q: unknown) => {
        const t = text(q);
        seen.push(t);
        if (/from documents where id =/i.test(t)) return { rows: [{ filing_date: '2026-09-10' }] };
        return { rows: [{ id: 'd2', doc_type: 'RHP', filing_date: '2026-09-01' }] };
      }),
    };
    const r = await makeListingPrecedenceReader(database as never).listingDocuments('ipo-1', 'd1');
    expect(r).toEqual({ selfFilingDate: '2026-09-10', others: [{ id: 'd2', docType: 'RHP', filingDate: '2026-09-01' }] });
    const q = seen[1];
    expect(q).toMatch(/d\.is_active IS NOT FALSE/);
    expect(q).toMatch(/d\.extraction_status = 'COMPLETED'/);
    expect(q).toMatch(/d\.id <> \$\d+::uuid/);
    expect(q).toMatch(/d\.type::text <> 'PRICE_BAND_AD' OR EXISTS/);
    expect(q).toMatch(/field_name IN \('listingExchanges', 'segment'\)/);
  });
});
