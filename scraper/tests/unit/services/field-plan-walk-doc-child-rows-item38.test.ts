// implements: item 38 -- spec data-sourcing-pull-model.md §2.5.6 item 1 / OD-164(a): the DOC rank answers an
// IPO-level child-table plan row (row_key '') from the document's own `rows` record and the stored rows, and the
// walk CREDITS it without a write (OD-161(a) "the document is credited, nothing is written"; OD-73; OD-76).
// Class: every IPO (all statuses, MAINBOARD and SME, every offering type) x the six tables whose section the
// filing persister records as one `rows` record (DOC_CHILD_ROWS_TABLES) x every IPO-level plan row.
// Fixtures are shaped from real staging rows (2026-10-02): national-stock-exchange-of-india-ltd ipo_risk_factors
// `rows` record from its RHP with 79 stored rows; papadmalji-agro-foods-ltd peer_companies stated absence
// (`peer_comparison_issuer_states_no_listed_peers`, DRHP + RHP, no stored rows); NSE promoter_acquisition_ranges
// `rows` record from a PRICE_BAND_AD (outside the RHP family).
import { describe, it, expect, vi } from 'vitest';
import {
  buildDocFetcher,
  DOC_CHILD_ROWS_TABLES,
  emptySectionReasonOf,
  type DocFetcherDeps,
} from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { walkFieldPlanForIPO, isCreditedAnswer, type FieldPlanWalkDeps } from '../../../src/services/field-plan-walk.js';

const IPO_ID = '00000000-0000-4000-8000-000000000038';
const RHP_ID = '00000000-0000-4000-8000-0000000038a1';
const DRHP_ID = '00000000-0000-4000-8000-0000000038a2';
const PBA_ID = '00000000-0000-4000-8000-0000000038a3';
const DOCS = [
  { id: RHP_ID, type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'b'.repeat(64) },
  { id: DRHP_ID, type: 'DRHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'c'.repeat(64) },
  { id: PBA_ID, type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'd'.repeat(64) },
];
const RISK_ROWS_RECORD = { source: 'DRHP', dataLineage: { docType: 'RHP', documentId: RHP_ID, sourceSha: 'b'.repeat(64) } };
const STATED_NO_PEERS = {
  tableName: 'peer_companies',
  documentId: RHP_ID,
  cause: 'RHP peer_companies: peer_comparison_issuer_states_no_listed_peers',
};

function deps(over: Partial<DocFetcherDeps> = {}): DocFetcherDeps {
  return {
    fieldSources: { findByField: vi.fn().mockResolvedValue(RISK_ROWS_RECORD) } as any,
    ipoRepository: { findById: vi.fn().mockResolvedValue(null) } as any,
    documentRepository: { findByIPO: vi.fn().mockResolvedValue(DOCS) } as any,
    manifestDocumentType: () => 'RHP',
    isDocCapable: () => true,
    ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue(null) } as any,
    childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 79, withValue: 79 }),
    openFailuresReader: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('item 38 DOC answer-state table for an IPO-level child-table row', () => {
  it('found: rows record from a family document and >=1 stored row with the column -> SUPPLIED, credited, evidence from the record', async () => {
    const d = deps();
    const a = await buildDocFetcher(d)(IPO_ID, 'ipo_risk_factors', '', 'heading');
    expect(a).toEqual({ outcome: 'SUPPLIED', value: 79, documentId: RHP_ID, documentType: 'RHP', sha256: 'b'.repeat(64), credited: true });
    expect(isCreditedAnswer(a)).toBe(true);
    // The section record is read, never a keyed per-row provenance row (F-227: those carry no lineage).
    expect((d.fieldSources.findByField as any).mock.calls).toEqual([[IPO_ID, 'ipo_risk_factors', 'rows', '']]);
    expect(d.childColumnCounter).toHaveBeenCalledWith(IPO_ID, 'ipo_risk_factors', 'heading');
  });

  it('column empty: rows exist, the column is null on all of them -> CHECK_FAILED transient, never NOT_PRINTED', async () => {
    const a = await buildDocFetcher(deps({ childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 79, withValue: 0 }) }))(
      IPO_ID, 'ipo_risk_factors', '', 'kpis'
    );
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
  });

  it('record but no stored rows (unlisted shape) -> fails closed: CHECK_FAILED transient', async () => {
    const a = await buildDocFetcher(deps({ childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 0, withValue: 0 }) }))(
      IPO_ID, 'ipo_risk_factors', '', 'heading'
    );
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
  });

  it('stated absent: no stored rows and an open failure on the #1420 list from a family document -> NOT_PRINTED', async () => {
    const a = await buildDocFetcher(
      deps({
        fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
        childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 0, withValue: 0 }),
        openFailuresReader: vi.fn().mockResolvedValue([STATED_NO_PEERS]),
      })
    )(IPO_ID, 'peer_companies', '', 'company_name');
    expect(a).toEqual({ outcome: 'NOT_PRINTED' });
  });

  it('a reason NOT on the stated-absence list (a pattern miss) is never NOT_PRINTED', async () => {
    const a = await buildDocFetcher(
      deps({
        fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
        childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 0, withValue: 0 }),
        openFailuresReader: vi.fn().mockResolvedValue([{ ...STATED_NO_PEERS, cause: 'RHP peer_companies: peer_comparison_table_not_in_document' }]),
      })
    )(IPO_ID, 'peer_companies', '', 'company_name');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
  });

  it('a stated absence from a document outside the field family is never NOT_PRINTED', async () => {
    const a = await buildDocFetcher(
      deps({
        fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
        childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 0, withValue: 0 }),
        openFailuresReader: vi.fn().mockResolvedValue([{ ...STATED_NO_PEERS, documentId: PBA_ID }]),
      })
    )(IPO_ID, 'peer_companies', '', 'company_name');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
  });

  it('row missing: no rows record -> CHECK_FAILED transient NO_DOCUMENT_PROVENANCE', async () => {
    const a = await buildDocFetcher(deps({ fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any }))(
      IPO_ID, 'promoters', '', 'name'
    );
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
  });

  it('unresolved: a rows record naming no document type -> fails closed, never SUPPLIED', async () => {
    const a = await buildDocFetcher(
      deps({ fieldSources: { findByField: vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: { documentId: RHP_ID } }) } as any })
    )(IPO_ID, 'ipo_risk_factors', '', 'heading');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
  });

  it('wrong family: a rows record from a PRICE_BAND_AD for an RHP-family field -> CHECK_FAILED transient', async () => {
    const a = await buildDocFetcher(
      deps({ fieldSources: { findByField: vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: { docType: 'PRICE_BAND_AD', documentId: PBA_ID } }) } as any })
    )(IPO_ID, 'promoter_acquisition_ranges', '', 'waca');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'NO_DOCUMENT_PROVENANCE' });
  });

  it('unknown column -> fails closed: CHECK_FAILED transient COLUMN_READ_NOT_IMPLEMENTED', async () => {
    const a = await buildDocFetcher(deps({ childColumnCounter: vi.fn().mockResolvedValue({ status: 'unknown_column' }) }))(
      IPO_ID, 'ipo_risk_factors', '', 'not_a_column'
    );
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true, gap: 'COLUMN_READ_NOT_IMPLEMENTED' });
  });

  it('unreadable: a read error -> CHECK_FAILED transient carrying the error', async () => {
    const a = await buildDocFetcher(deps({ childColumnCounter: vi.fn().mockRejectedValue(new Error('connection terminated')) }))(
      IPO_ID, 'ipo_risk_factors', '', 'heading'
    );
    expect(a).toEqual({ outcome: 'CHECK_FAILED', reason: 'connection terminated', transient: true });
  });

  it('no COMPLETED family document still answers NOT_AVAILABLE_YET before any child read', async () => {
    const d = deps({ documentRepository: { findByIPO: vi.fn().mockResolvedValue([]) } as any });
    expect(await buildDocFetcher(d)(IPO_ID, 'ipo_risk_factors', '', 'heading')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    expect(d.childColumnCounter).not.toHaveBeenCalled();
  });

  it('a keyed row (row_key set) and a table outside the six keep the existing path', async () => {
    const d = deps({ fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any });
    await buildDocFetcher(d)(IPO_ID, 'ipo_risk_factors', 'rf-1', 'heading');
    await buildDocFetcher(d)(IPO_ID, 'registrars', '', 'name');
    expect(d.childColumnCounter).not.toHaveBeenCalled();
    expect(DOC_CHILD_ROWS_TABLES).toEqual([
      'financial_statements', 'ipo_intermediaries', 'ipo_risk_factors', 'peer_companies', 'promoter_acquisition_ranges', 'promoters',
    ]);
  });

  it('reads the extractor reason out of the persister cause shape', () => {
    expect(emptySectionReasonOf(STATED_NO_PEERS.cause)).toBe('peer_comparison_issuer_states_no_listed_peers');
    expect(emptySectionReasonOf('no separator')).toBeNull();
  });
});

describe('item 38 the walk credits a DOC child-table answer with ZERO writer calls', () => {
  function walkSetup(d: DocFetcherDeps) {
    const recorded: any[] = [];
    const queue = [
      {
        id: 'plan-38', ipoId: IPO_ID, tableName: 'ipo_risk_factors', rowKey: '', fieldName: 'heading',
        rank1Source: 'DOC', rank2Source: null, rank3Source: null, state: 'CHECK_FAILED' as const,
        chosenSource: null, chosenRank: null, attempts: 0, cause: null, claimToken: 'tok-38',
        manifestVersion: 2, policyOrigin: 'registry:2', reopenedUnderPolicy: null,
      },
    ];
    const orchestrator = { consolidatedUpsertIPO: vi.fn(), consolidatedUpsertChildRows: vi.fn() };
    const trackWitnessVerdict = vi.fn();
    const walkDeps = {
      fieldPlanRepository: {
        claimNextDueField: vi.fn(async () => queue.shift() ?? null),
        recordOutcome: vi.fn(async (p: any) => { recorded.push(p); return { written: true }; }),
        releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
        restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
      },
      orchestrator,
      sourceFetchers: { DOC: buildDocFetcher(d) },
      ipoRepository: { findById: vi.fn(async () => ({ id: IPO_ID, companyName: 'National Stock Exchange of India Ltd', segment: 'MAINBOARD' })) },
      resolvePolicy: () => ({ ranks: ['DOC'], documentType: 'RHP', origin: { kind: 'registry', version: 2 }, na: false, incapable: {} }),
      trackWitnessVerdict,
    } as unknown as FieldPlanWalkDeps;
    return { walkDeps, recorded, orchestrator, trackWitnessVerdict };
  }

  it('found -> plan row SUPPLIED from DOC with the rows record evidence; the writer and the witness writer are never called', async () => {
    const { walkDeps, recorded, orchestrator, trackWitnessVerdict } = walkSetup(deps());
    const result = await walkFieldPlanForIPO(IPO_ID, walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(result.fieldsSupplied).toBe(1);
    expect(orchestrator.consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(trackWitnessVerdict).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      state: 'SUPPLIED',
      chosen: { source: 'DOC', rank: 1, documentId: RHP_ID, documentType: 'RHP', sha256: 'b'.repeat(64), page: null },
    });
  });

  it('stated absent -> NOT_PRINTED recorded, nothing written', async () => {
    const { walkDeps, recorded, orchestrator } = walkSetup(
      deps({
        fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
        childColumnCounter: vi.fn().mockResolvedValue({ status: 'ok', rows: 0, withValue: 0 }),
        openFailuresReader: vi.fn().mockResolvedValue([{ ...STATED_NO_PEERS, tableName: 'ipo_risk_factors' }]),
      })
    );
    await walkFieldPlanForIPO(IPO_ID, walkDeps, { deadlineMs: 1_000_000, now: () => 0 });
    expect(orchestrator.consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(recorded[0].state).not.toBe('SUPPLIED');
  });
});
