// implements: F-240 (#1500 point 3) -- spec data-sourcing-pull-model.md OD-161 ("the DOC fetcher reads a
// document's answer from its own record, never from who owns the stored value"), OD-96, OD-97, OD-91, §2.5;
// failure class #684 (the walk's write records the field_sources row).
// Class: every IPO x every DOC-readable field (ipos, ipo_details) whose column is EMPTY, has NO field_sources
// row, and whose COMPLETED family document holds a non-empty receipt. Staging 2026-10-03: 27 ipos rows on
// 26 IPOs (objectives 17, companyDescription 6, ...), all CHECK_FAILED NO_DOCUMENT_PROVENANCE before.
// Fixture: nityas-gems-and-jewellery-ltd ipos.objectives NULL; its RHP (2026-09-24) and DRHP (no filing date)
// receipts, verbatim from ipodhan_staging 2026-10-03 (mark NULL = read before OD-97's mark existed).
import { describe, it, expect, vi } from 'vitest';
import { buildDocFetcher, emptyColumnExemplar, type DocFetcherDeps } from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { walkFieldPlanForIPO, type FieldPlanWalkDeps } from '../../../src/services/field-plan-walk.js';

const IPO_ID = '00000000-0000-4000-8000-000000000240';
const RHP_ID = '00000000-0000-4000-8000-0000000240a1';
const DRHP_ID = '00000000-0000-4000-8000-0000000240a2';
const RHP2_ID = '00000000-0000-4000-8000-0000000240a3';
const RHP_OBJECTIVES =
  '[{"amount":70,"description":"Funding Working Capital requirements of our Company","sno":1},{"amount":null,"description":"General corporate purposes","sno":2}]';
const DRHP_OBJECTIVES =
  '[{"amount":70,"description":"Funding Working Capital requirements of our Company Upto","sno":1},{"amount":null,"description":"General corporate purposes","sno":2}]';
const DOCS = [
  { id: DRHP_ID, type: 'DRHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'd'.repeat(64), filingDate: null },
  { id: RHP_ID, type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'e'.repeat(64), filingDate: '2026-09-24' },
];

type Over = {
  provenance?: { source: string; dataLineage: Record<string, unknown> } | null;
  stored?: Record<string, unknown>;
  receipts?: Array<[string, string, string | null]>;
  mark?: string | null;
  docs?: unknown[];
};

function deps(o: Over = {}): DocFetcherDeps {
  const receiptMap = new Map<string, Map<string, string | null>>();
  const rows = o.receipts ?? [
    [DRHP_ID, 'ipos||objectives', DRHP_OBJECTIVES],
    [RHP_ID, 'ipos||objectives', RHP_OBJECTIVES],
  ];
  for (const [docId, key, v] of rows) {
    if (!receiptMap.has(docId)) receiptMap.set(docId, new Map());
    receiptMap.get(docId)!.set(key, v);
  }
  return {
    fieldSources: { findByField: vi.fn().mockResolvedValue(o.provenance === undefined ? null : o.provenance) } as any,
    ipoRepository: { findById: vi.fn().mockResolvedValue({ id: IPO_ID, objectives: null, companyDescription: null, ...(o.stored ?? {}) }) } as any,
    documentRepository: { findByIPO: vi.fn().mockResolvedValue(o.docs ?? DOCS) } as any,
    manifestDocumentType: () => 'RHP',
    isDocCapable: () => true,
    ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue({ issueType: 'BOOK_BUILDING', faceValue: null }) } as any,
    receiptReader: vi.fn().mockResolvedValue(receiptMap),
    receiptMarkReader: vi.fn().mockResolvedValue(o.mark === undefined ? null : o.mark),
  };
}

describe('F-240 DOC answer for an EMPTY column with no provenance row -- the real fetcher', () => {
  it('nityas: objectives empty, no field_sources row, RHP receipt (mark unknown) -> SUPPLIED from the RHP, decoded to a list', async () => {
    const a: any = await buildDocFetcher(deps())(IPO_ID, 'ipos', '', 'objectives');
    expect(a.outcome).toBe('SUPPLIED');
    expect(a.value).toEqual(JSON.parse(RHP_OBJECTIVES));
    expect(a).toMatchObject({ documentId: RHP_ID, documentType: 'RHP', sha256: 'e'.repeat(64) });
    expect(a.credited).toBeUndefined();
    expect(a.adminListing).toBeUndefined();
  });

  it('mark TEXT -> SUPPLIED; text column (companyDescription) decodes to the string', async () => {
    const a: any = await buildDocFetcher(deps({ mark: 'TEXT', receipts: [[RHP_ID, 'ipos||companyDescription', 'Jewellery maker']] }))(
      IPO_ID, 'ipos', '', 'company_description'
    );
    expect(a).toMatchObject({ outcome: 'SUPPLIED', value: 'Jewellery maker', documentId: RHP_ID });
  });

  for (const mark of ['OCR', 'MIXED', 'WEIRD']) {
    it(`mark ${mark} -> column kept empty (CHECK_FAILED transient), KEPT listing with no stored source, never SUPPLIED`, async () => {
      const a: any = await buildDocFetcher(deps({ mark }))(IPO_ID, 'ipos', '', 'objectives');
      expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
      expect(a.adminListing).toMatchObject({ outcome: 'KEPT', storedSource: null, storedValue: null, documentValue: RHP_OBJECTIVES, mark, documentId: RHP_ID });
    });
  }

  it('no receipt for the field -> unchanged answer (CHECK_FAILED NO_DOCUMENT_PROVENANCE, no listing)', async () => {
    const a: any = await buildDocFetcher(deps({ receipts: [[RHP_ID, 'ipos||faceValue', '10']] }))(IPO_ID, 'ipos', '', 'objectives');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_DOCUMENT_PROVENANCE' });
    expect(a.reason).toMatch(/no document provenance/);
    expect(a.adminListing).toBeUndefined();
  });

  it('an empty-string receipt is no receipt -> unchanged answer', async () => {
    const a: any = await buildDocFetcher(deps({ receipts: [[RHP_ID, 'ipos||objectives', '']] }))(IPO_ID, 'ipos', '', 'objectives');
    expect(a.reason).toMatch(/no document provenance/);
  });

  it('receipt only from a document outside the family (OD-96) -> ignored, CHECK_FAILED transient, nothing written', async () => {
    const docs = [...DOCS, { id: 'pba', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'f'.repeat(64) }];
    const a: any = await buildDocFetcher(deps({ docs, receipts: [['pba', 'ipos||objectives', RHP_OBJECTIVES]] }))(IPO_ID, 'ipos', '', 'objectives');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
    expect(a.reason).toMatch(/outside the RHP family/);
  });

  it('two RHPs printing different values that cannot be ordered (one has no filing date) -> AMBIGUOUS, nothing written', async () => {
    const docs = [...DOCS, { id: RHP2_ID, type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'a'.repeat(64), filingDate: null }];
    const a: any = await buildDocFetcher(
      deps({ docs, receipts: [[RHP_ID, 'ipos||objectives', RHP_OBJECTIVES], [RHP2_ID, 'ipos||objectives', DRHP_OBJECTIVES]] })
    )(IPO_ID, 'ipos', '', 'objectives');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
    expect(a.reason).toMatch(/^AMBIGUOUS/);
  });

  it('a better-ranked document that differs from a lower one (RHP over DRHP, real nityas pair) is not ambiguous', async () => {
    const a: any = await buildDocFetcher(deps())(IPO_ID, 'ipos', '', 'objectives');
    expect(a.documentType).toBe('RHP');
  });

  it('a value that does not decode to the column shape -> CHECK_FAILED, never SUPPLIED', async () => {
    const a: any = await buildDocFetcher(deps({ receipts: [[RHP_ID, 'ipos||objectives', '{broken']] }))(IPO_ID, 'ipos', '', 'objectives');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
    expect(a.reason).toMatch(/does not decode/);
  });

  it('ipo_details: empty numeric column (face_value), TEXT receipt -> SUPPLIED as the numeric text drizzle stores', async () => {
    const a: any = await buildDocFetcher(deps({ mark: 'TEXT', receipts: [[RHP_ID, 'ipo_details||faceValue', '10']] }))(IPO_ID, 'ipo_details', '', 'face_value');
    expect(a).toMatchObject({ outcome: 'SUPPLIED', documentId: RHP_ID });
    expect(a.value).toBe('10');
  });

  it('ipos: empty integer column (lot_size), TEXT receipt -> SUPPLIED as a number', async () => {
    const a: any = await buildDocFetcher(deps({ mark: 'TEXT', receipts: [[RHP_ID, 'ipos||lotSize', '2400']] }))(IPO_ID, 'ipos', '', 'lot_size');
    expect(a).toMatchObject({ outcome: 'SUPPLIED', value: 2400 });
  });

  it('stored value with a website owner -> OD-161 path unchanged (equal credits, nothing written)', async () => {
    const a: any = await buildDocFetcher(
      deps({ provenance: { source: 'CHITTORGARH', dataLineage: {} }, stored: { objectives: JSON.parse(RHP_OBJECTIVES) } })
    )(IPO_ID, 'ipos', '', 'objectives', { ranks: ['DOC', 'CHITTORGARH'] });
    expect(a).toMatchObject({ outcome: 'SUPPLIED', value: null, credited: 'DOCUMENT_VALUE_STORED' });
  });

  it('empty column WITH a website provenance row -> not this path (today answer)', async () => {
    const a: any = await buildDocFetcher(deps({ provenance: { source: 'CHITTORGARH', dataLineage: {} } }))(IPO_ID, 'ipos', '', 'objectives', {
      ranks: ['DOC', 'CHITTORGARH'],
    });
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_DOCUMENT_PROVENANCE' });
    expect(a.reason).toMatch(/no document provenance/);
  });

  it('a stored value with no provenance row -> not this path (today answer)', async () => {
    const a: any = await buildDocFetcher(deps({ stored: { objectives: [{ sno: 1 }] } }))(IPO_ID, 'ipos', '', 'objectives');
    expect(a.reason).toMatch(/no document provenance/);
  });

  it('emptyColumnExemplar: json, text, unknown column and unknown table', () => {
    expect(emptyColumnExemplar('ipos', 'objectives')).toEqual({ exemplar: {} });
    expect(emptyColumnExemplar('ipos', 'companyDescription')).toEqual({ exemplar: '' });
    expect(emptyColumnExemplar('ipos', 'noSuchColumn')).toBeNull();
    expect(emptyColumnExemplar('promoters', 'name')).toBeNull();
  });
});

describe('F-240 the real walk over the real DOC fetcher', () => {
  it('nityas objectives: ONE normal write with the decoded RHP value and the RHP as evidence, plan row SUPPLIED', async () => {
    const recorded: any[] = [];
    const queue = [
      {
        id: 'plan-240', ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName: 'objectives',
        rank1Source: 'DOC', rank2Source: null, rank3Source: null, state: 'CHECK_FAILED' as const,
        chosenSource: null, chosenRank: null, attempts: 3, cause: null, claimToken: 'tok-240',
        manifestVersion: 2, policyOrigin: 'registry:2', reopenedUnderPolicy: null,
      },
    ];
    const orchestrator = {
      consolidatedUpsertIPO: vi.fn(async () => ({
        consolidation: { fieldResults: [{ fieldName: 'objectives', chosenSource: 'DRHP', finalValue: JSON.parse(RHP_OBJECTIVES) }] },
      })),
      consolidatedUpsertChildRows: vi.fn(),
    };
    const listDocDifferenceForAdmin = vi.fn(async () => undefined);
    const walkDeps = {
      fieldPlanRepository: {
        claimNextDueField: vi.fn(async () => queue.shift() ?? null),
        recordOutcome: vi.fn(async (p: any) => { recorded.push(p); return { written: true }; }),
        releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
        restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
      },
      orchestrator,
      sourceFetchers: { DOC: buildDocFetcher(deps()) },
      ipoRepository: { findById: vi.fn(async () => ({ id: IPO_ID, companyName: 'Nityas Gems and Jewellery Ltd', segment: 'SME', objectives: null })) },
      resolvePolicy: () => ({ ranks: ['DOC'], documentType: 'RHP', origin: { kind: 'registry', version: 2 }, na: false, incapable: {} }),
      trackWitnessVerdict: vi.fn(),
      listDocDifferenceForAdmin,
    } as unknown as FieldPlanWalkDeps;
    await walkFieldPlanForIPO(IPO_ID, walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(orchestrator.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    const call = orchestrator.consolidatedUpsertIPO.mock.calls[0] as any[];
    expect(call[0]).toMatchObject({ id: IPO_ID, objectives: JSON.parse(RHP_OBJECTIVES) });
    expect(call[1]).toBe('DRHP');
    expect(recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'DOC', documentId: RHP_ID, documentType: 'RHP' } });
    expect(listDocDifferenceForAdmin).not.toHaveBeenCalled();
  });
});
