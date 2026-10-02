// implements: item 41 -- spec data-sourcing-pull-model.md OD-161 (a)/(b)/(c), OD-162, OD-91, OD-97, OD-61, §2.7:
// the DOC fetcher answers from the document's OWN record (document_field_receipts), never from who owns the stored
// value; equal credits (no write), a TEXT value replaces a lower-ranked website value and is listed for the admin,
// OCR/MIXED/unknown never replaces (listed), exchange-first fields and ADMIN values are unchanged. Plus #1459
// point 2: a credited answer never votes in the witness verdict.
// Class: every IPO (all statuses, MAINBOARD and SME, every offering type) x every ipos/ipo_details field ranked
// DOC above the source that owns its stored value x every receipt.
// Fixtures shaped from real staging rows (2026-10-02, F-225): ashutosh-fibre-ltd lot 2,400 (document) vs NSE
// 1,200; runwal-enterprises-ltd band max 305 vs NSE 302; national-stock-exchange-of-india-ltd band 1.7 (OCR)
// vs CHITTORGARH 1,700.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';
import { buildDocFetcher, decodeReceiptForColumn, type DocFetcherDeps } from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { walkFieldPlanForIPO, isCreditedAnswer, type FieldPlanWalkDeps } from '../../../src/services/field-plan-walk.js';
import { computeVerdict } from '../../../src/services/witness-verdict.js';

const IPO_ID = '00000000-0000-4000-8000-000000000041';
const RHP_ID = '00000000-0000-4000-8000-0000000041a1';
const PBA_ID = '00000000-0000-4000-8000-0000000041a2';
const DOCS = [{ id: RHP_ID, type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'e'.repeat(64), filingDate: '2026-09-01' }];

type Over = {
  owner?: string | null;
  stored?: Record<string, unknown>;
  receipts?: Array<[string, string, string | null]>;
  mark?: string | null;
  docs?: unknown[];
  manifestDocType?: string;
};

function deps(o: Over = {}): DocFetcherDeps {
  const owner = o.owner === undefined ? 'NSE' : o.owner;
  const receiptMap = new Map<string, Map<string, string | null>>();
  for (const [docId, key, v] of o.receipts ?? [[RHP_ID, 'ipos||lotSize', '2400']]) {
    if (!receiptMap.has(docId)) receiptMap.set(docId, new Map());
    receiptMap.get(docId)!.set(key, v);
  }
  return {
    fieldSources: { findByField: vi.fn().mockResolvedValue(owner === null ? null : { source: owner, dataLineage: {} }) } as any,
    ipoRepository: {
      findById: vi.fn().mockResolvedValue({ id: IPO_ID, lotSize: 1200, priceRangeMin: '290.00', priceRangeMax: '302.00', ...(o.stored ?? {}) }),
    } as any,
    documentRepository: { findByIPO: vi.fn().mockResolvedValue(o.docs ?? DOCS) } as any,
    manifestDocumentType: () => o.manifestDocType ?? 'PRICE_BAND_AD',
    isDocCapable: () => true,
    ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue({ issueType: 'BOOK_BUILDING' }) } as any,
    receiptReader: vi.fn().mockResolvedValue(receiptMap),
    receiptMarkReader: vi.fn().mockResolvedValue(o.mark === undefined ? 'TEXT' : o.mark),
  };
}

const RANKS = { ranks: ['DOC', 'BSE', 'NSE'] };

describe('item 41 DOC answer-state table (OD-161) -- the real fetcher', () => {
  it('equal value (owner CHITTORGARH) -> SUPPLIED credited DOCUMENT_VALUE_STORED, value null, document evidence', async () => {
    const a = await buildDocFetcher(deps({ owner: 'CHITTORGARH', receipts: [[RHP_ID, 'ipos||lotSize', '1200']] }))(IPO_ID, 'ipos', '', 'lot_size', RANKS);
    expect(a).toEqual({ outcome: 'SUPPLIED', value: null, documentId: RHP_ID, documentType: 'RHP', sha256: 'e'.repeat(64), credited: 'DOCUMENT_VALUE_STORED' });
    expect(isCreditedAnswer(a)).toBe(true);
  });

  it('ashutosh: different, DOC outranks NSE, TEXT -> SUPPLIED with the document value (a number) and a REPLACED listing', async () => {
    const a: any = await buildDocFetcher(deps())(IPO_ID, 'ipos', '', 'lot_size', RANKS);
    expect(a.outcome).toBe('SUPPLIED');
    expect(a.value).toBe(2400);
    expect(a.credited).toBeUndefined();
    expect(a.adminListing).toMatchObject({ outcome: 'REPLACED', storedSource: 'NSE', storedValue: '1200', documentValue: '2400', mark: 'TEXT', documentId: RHP_ID, fieldName: 'lotSize' });
  });

  it('runwal: numeric column stored as text, TEXT receipt 305 vs NSE 302 -> SUPPLIED "305"', async () => {
    const a: any = await buildDocFetcher(deps({ receipts: [[RHP_ID, 'ipos||priceRangeMax', '305']] }))(IPO_ID, 'ipos', '', 'price_range_max', RANKS);
    expect(a).toMatchObject({ outcome: 'SUPPLIED', value: '305', adminListing: { outcome: 'REPLACED', storedValue: '302', documentValue: '305' } });
  });

  for (const mark of ['OCR', 'MIXED', null, 'WEIRD']) {
    it(`NSE band: different, mark ${mark} -> kept (CHECK_FAILED transient), KEPT listing, never SUPPLIED`, async () => {
      const a: any = await buildDocFetcher(
        deps({ owner: 'CHITTORGARH', mark, stored: { priceRangeMin: '1700.00' }, receipts: [[RHP_ID, 'ipos||priceRangeMin', '1.7']] })
      )(IPO_ID, 'ipos', '', 'price_range_min', { ranks: ['DOC', 'CHITTORGARH'] });
      expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
      expect(a.adminListing).toMatchObject({ outcome: 'KEPT', storedSource: 'CHITTORGARH', storedValue: '1700', documentValue: '1.7', mark });
    });
  }

  it('exchange-first: NSE ranks above DOC, owner CHITTORGARH, different -> kept, nothing listed (OD-161(c))', async () => {
    const a: any = await buildDocFetcher(deps({ owner: 'CHITTORGARH' }))(IPO_ID, 'ipos', '', 'lot_size', { ranks: ['NSE', 'DOC', 'CHITTORGARH'] });
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
    expect(a.adminListing).toBeUndefined();
  });

  it('owner ranks above DOC (CHITTORGARH rank 1), different -> kept, nothing listed', async () => {
    const a: any = await buildDocFetcher(deps({ owner: 'CHITTORGARH' }))(IPO_ID, 'ipos', '', 'lot_size', { ranks: ['CHITTORGARH', 'DOC'] });
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED' });
    expect(a.adminListing).toBeUndefined();
  });

  it('no rank list (fail closed), different -> kept, never SUPPLIED', async () => {
    const a: any = await buildDocFetcher(deps())(IPO_ID, 'ipos', '', 'lot_size');
    expect(a.outcome).toBe('CHECK_FAILED');
  });

  for (const eq of [true, false]) {
    it(`ADMIN owner (§2.7), receipt ${eq ? 'equal' : 'different'} -> today's answer, CHECK_FAILED NO_DOCUMENT_PROVENANCE`, async () => {
      const a: any = await buildDocFetcher(deps({ owner: 'ADMIN', receipts: [[RHP_ID, 'ipos||lotSize', eq ? '1200' : '2400']] }))(IPO_ID, 'ipos', '', 'lot_size', RANKS);
      expect(a).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_DOCUMENT_PROVENANCE' });
      expect(a.reason).toMatch(/no document provenance/);
      expect(a.adminListing).toBeUndefined();
    });
  }

  it('no receipt for the field -> today answer (CHECK_FAILED NO_DOCUMENT_PROVENANCE)', async () => {
    const a: any = await buildDocFetcher(deps({ receipts: [[RHP_ID, 'ipos||faceValue', '10']] }))(IPO_ID, 'ipos', '', 'lot_size', RANKS);
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_DOCUMENT_PROVENANCE' });
    expect(a.reason).toMatch(/no document provenance/);
  });

  it('receipt only from a document outside the field family (OD-96) -> CHECK_FAILED transient, never credited', async () => {
    const docs = [...DOCS, { id: PBA_ID, type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'f'.repeat(64) }];
    const a: any = await buildDocFetcher(deps({ docs, manifestDocType: 'RHP', receipts: [[PBA_ID, 'ipos||lotSize', '1200']] }))(IPO_ID, 'ipos', '', 'lot_size', RANKS);
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
    expect(a.reason).toMatch(/outside the RHP family/);
  });

  it('decodeReceiptForColumn fails closed on a shape that does not round-trip', () => {
    expect(decodeReceiptForColumn('2400', 1200)).toEqual({ value: 2400 });
    expect(decodeReceiptForColumn('["A","B"]', ['C'])).toEqual({ value: ['A', 'B'] });
    expect(decodeReceiptForColumn('abc', 1200)).toBeNull();
    expect(decodeReceiptForColumn('{bad', ['C'])).toBeNull();
  });
});

function walkSetup(fetchers: Record<string, unknown>, ranks: string[], field = 'lot_size', writeResult?: unknown) {
  const recorded: any[] = [];
  const queue = [
    {
      id: 'plan-41', ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName: field,
      rank1Source: ranks[0] ?? null, rank2Source: ranks[1] ?? null, rank3Source: ranks[2] ?? null, state: 'CHECK_FAILED' as const,
      chosenSource: null, chosenRank: null, attempts: 0, cause: null, claimToken: 'tok-41',
      manifestVersion: 2, policyOrigin: 'registry:2', reopenedUnderPolicy: null,
    },
  ];
  const orchestrator = {
    consolidatedUpsertIPO: vi.fn(async () =>
      writeResult ?? { consolidation: { fieldResults: [{ fieldName: 'lotSize', chosenSource: 'DRHP', finalValue: 2400 }] } }
    ),
    consolidatedUpsertChildRows: vi.fn(),
  };
  const trackWitnessVerdict = vi.fn();
  const listDocDifferenceForAdmin = vi.fn(async () => undefined);
  const walkDeps = {
    fieldPlanRepository: {
      claimNextDueField: vi.fn(async () => queue.shift() ?? null),
      recordOutcome: vi.fn(async (p: any) => { recorded.push(p); return { written: true }; }),
      releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
      restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
    },
    orchestrator,
    sourceFetchers: fetchers,
    ipoRepository: { findById: vi.fn(async () => ({ id: IPO_ID, companyName: 'Ashutosh Fibre Ltd', segment: 'SME', lotSize: 1200 })) },
    resolvePolicy: () => ({ ranks, documentType: 'PRICE_BAND_AD', origin: { kind: 'registry', version: 2 }, na: false, incapable: {} }),
    trackWitnessVerdict,
    listDocDifferenceForAdmin,
  } as unknown as FieldPlanWalkDeps;
  return { walkDeps, recorded, orchestrator, trackWitnessVerdict, listDocDifferenceForAdmin };
}

describe('item 41 the real walk over the real DOC fetcher', () => {
  afterEach(() => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = false;
  });

  it('equal -> SUPPLIED from DOC, ZERO writer calls, nothing listed', async () => {
    const w = walkSetup({ DOC: buildDocFetcher(deps({ owner: 'CHITTORGARH', receipts: [[RHP_ID, 'ipos||lotSize', '1200']] })) }, ['DOC']);
    await walkFieldPlanForIPO(IPO_ID, w.walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(w.orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(w.listDocDifferenceForAdmin).not.toHaveBeenCalled();
    expect(w.recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'DOC', documentId: RHP_ID } });
  });

  it('TEXT replacement -> the normal walk write with the document value, then ONE REPLACED listing', async () => {
    const w = walkSetup({ DOC: buildDocFetcher(deps()) }, ['DOC', 'BSE', 'NSE']);
    await walkFieldPlanForIPO(IPO_ID, w.walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(w.orchestrator.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect((w.orchestrator.consolidatedUpsertIPO.mock.calls[0] as any[])[0]).toMatchObject({ id: IPO_ID, lotSize: 2400 });
    expect(w.recorded[0].state).toBe('SUPPLIED');
    expect(w.listDocDifferenceForAdmin).toHaveBeenCalledTimes(1);
    expect((w.listDocDifferenceForAdmin.mock.calls[0] as any[])[0]).toMatchObject({ outcome: 'REPLACED', documentValue: '2400' });
  });

  it('TEXT replacement REFUSED by the write checks (#721 lot rule) -> not SUPPLIED, nothing listed as replaced', async () => {
    const w = walkSetup({ DOC: buildDocFetcher(deps()) }, ['DOC'], 'lot_size', { refusedLotFields: ['lotSize'] });
    await walkFieldPlanForIPO(IPO_ID, w.walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(w.recorded[0].state).not.toBe('SUPPLIED');
    expect(w.listDocDifferenceForAdmin).not.toHaveBeenCalled();
  });

  it('OCR difference -> no write, ONE KEPT listing, plan row not settled by DOC', async () => {
    const w = walkSetup(
      { DOC: buildDocFetcher(deps({ owner: 'CHITTORGARH', mark: 'OCR', stored: { priceRangeMin: '1700.00' }, receipts: [[RHP_ID, 'ipos||priceRangeMin', '1.7']] })) },
      ['DOC', 'CHITTORGARH'],
      'price_range_min'
    );
    await walkFieldPlanForIPO(IPO_ID, w.walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(w.orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalledWith(expect.objectContaining({ priceRangeMin: '1.7' }), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(w.listDocDifferenceForAdmin).toHaveBeenCalledTimes(1);
    expect((w.listDocDifferenceForAdmin.mock.calls[0] as any[])[0]).toMatchObject({ outcome: 'KEPT', mark: 'OCR' });
    expect(w.recorded[0].chosen?.source).not.toBe('DOC');
  });

  it('#1459 point 2: NSE wins at rank 1, DOC credited at rank 2 -> the witness verdict is not DISPUTED and the DOC witness keeps its marker', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const w = walkSetup(
      {
        NSE: vi.fn(async () => ({ outcome: 'SUPPLIED' as const, value: 1200 })),
        DOC: buildDocFetcher(deps({ owner: 'NSE', receipts: [[RHP_ID, 'ipos||lotSize', '1200']] })),
      },
      ['NSE', 'DOC'],
      'lot_size',
      { consolidation: { fieldResults: [{ fieldName: 'lotSize', chosenSource: 'NSE', finalValue: 1200 }] } }
    );
    await walkFieldPlanForIPO(IPO_ID, w.walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(w.trackWitnessVerdict).toHaveBeenCalledTimes(1);
    const arg = (w.trackWitnessVerdict.mock.calls[0] as any[])[0];
    expect(arg.verdict).not.toBe('DISPUTED');
    expect(arg.witnesses).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'DOC', credited: 'DOCUMENT_VALUE_STORED', value: null })]));
  });
});

describe('#1459 point 2 -- computeVerdict never counts a credited answer as a vote', () => {
  it('one real value + one credited null -> UNCONFIRMED, never DISPUTED', () => {
    const r = computeVerdict(
      [
        { rank: 1, source: 'NSE', value: 1200, at: 'x', outcome: 'SUPPLIED' },
        { rank: 2, source: 'DOC', value: null, at: 'x', outcome: 'SUPPLIED', credited: 'DOCUMENT_VALUE_STORED' },
      ],
      3,
      'MONEY' as never
    );
    expect(r.verdict).toBe('UNCONFIRMED');
    expect(r.witnesses[1]).toMatchObject({ credited: 'DOCUMENT_VALUE_STORED' });
  });
});

// Fix round (PR #1463 review): the admin queue reads evidence.documentType, so the OD-161 listing must store that key.
describe('OD-161 listing evidence', () => {
  it('stores documentType (the key the admin queue reads), the rule and the origin', async () => {
    const { docDifferenceEvidence } = await import('../../../src/services/field-plan-walk-deps.js');
    const e = docDifferenceEvidence({ outcome: 'REPLACED', documentType: 'RHP', mark: 'TEXT', storedSource: 'NSE' } as never);
    expect(e).toMatchObject({ documentType: 'RHP', rule: 'OD-161', origin: 'OD161_DOCUMENT_REPLACED_WEBSITE_VALUE', storedSource: 'NSE' });
  });
});
