/**
 * Round 4 item 4 (OD-30, OD-154, D7 amended): a lead-manager list an EARLIER offer document of the
 * same IPO put into `ipos.lead_managers` / `ipo_details.lead_managers` is replaced by a later or
 * higher-ranked offer document. The empty-only rule (PR #1460, D7) still protects every other
 * holder: a website, ADMIN, an unknown document type, a later document, or an unreadable provenance.
 *
 * Real values: the NSE DRHP (DRHP-d88fad44) and RHP (RHP-3cb0ba27) list the same 20 book running lead
 * managers; the DRHP prints SBI Capital Markets Limited 7th (cover p2), the RHP prints it last as
 * "M-BRLM" (RHP p106). Staging run 2026-10-03 (rhp-saved-1.json): the RHP's list differed from the
 * held DRHP list only in that order, so the persister kept the DRHP list, the BRLM rows were built
 * from it with `docBrlmsHeld` false, and none of the 17 grievance e-mails the RHP read was saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock, recordDocumentSourceHints: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b8c5d769-3ad1-4c6c-b58d-9f37965ee343';
const RHP_ID = '3cb0ba27-4ec8-4b65-bb2a-e6ee74492120';
const DRHP_ID = 'd88fad44-75ce-4d90-aec7-2bb9f97aa734';
type Field = FilingExtraction['fields'][string];
const value = (v: unknown, page: number): Field =>
  ({ value: v, page, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;

const DRHP_LIST = [
  'Kotak Mahindra Capital Company Limited', 'JM Financial Limited', 'Morgan Stanley India Company Private Limited',
  'Citigroup Global Markets India Private Limited', 'HSBC Securities and Capital Markets (India) Private Limited',
  'J.P. Morgan India Private Limited', 'SBI Capital Markets Limited', 'Anand Rathi Advisors Limited',
  'Avendus Capital Private Limited', 'Axis Capital Limited', 'DAM Capital Advisors Limited', 'Equirus Capital Limited',
  'HDFC Bank Limited', 'ICICI Securities Limited', 'IDBI Capital Markets & Securities Limited',
  'IIFL Capital Services Limited', 'Motilal Oswal Investment Advisors Limited', 'Nuvama Wealth Management Limited',
  'Pantomath Capital Advisors Private Limited', '360 ONE WAM Limited',
];
const RHP_LIST = [...DRHP_LIST.filter((n) => n !== 'SBI Capital Markets Limited'), 'SBI Capital Markets Limited'];
// Two of the RHP's grievance e-mails (General Information p104-106), keyed by the document's BRLM name.
const GRIEVANCE = {
  'Kotak Mahindra Capital Company Limited': 'kmccredressal@kotak.com',
  'JM Financial Limited': 'grievance.ibd@jmfl.com',
};

function extraction(docType: string): FilingExtraction {
  return {
    doc_type: docType, source_doc: 'RHP-3cb0ba27.pdf', pages: 668, extraction_status: 'OK', unit: 'millions',
    fiscal_years: [],
    fields: { lead_managers: value(RHP_LIST, 1), brlm_grievance_emails: value(GRIEVANCE, 103) },
  } as FilingExtraction;
}

type Provenance = { source: string; dataLineage: Record<string, unknown> | null } | null | 'throw';

function makeDeps(provenance: Provenance, docs: Array<{ id: string; docType: string; filingDate: string | null }> = [], self = '2026-09-09') {
  const replaceForIpo = vi.fn(async () => []);
  const detailsUpsert = vi.fn(async (_id: string, values: Record<string, unknown>, opts?: { afterWriteInTx?: (tx: unknown, w: Record<string, unknown>) => Promise<void> }) => {
    await opts?.afterWriteInTx?.('tx-1', values);
  });
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [], leadManagers: DRHP_LIST,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: {
      findByField: vi.fn(async () => {
        if (provenance === 'throw') throw new Error('provenance read failed');
        return provenance;
      }),
      trackFieldUpdate: vi.fn(async () => ({})),
    },
    ocrPrecedence: {
      textReceipts: vi.fn(async () => []),
      documentRef: vi.fn(async () => null),
      storedDetails: vi.fn(async () => ({ ipoId: IPO_ID, leadManagers: DRHP_LIST })),
    },
    listingPrecedence: { listingDocuments: vi.fn(async () => ({ selfFilingDate: self, others: docs })) },
    ipoDetailsWriter: { upsert: detailsUpsert, insertIfMissing: vi.fn(async () => false) },
  } as unknown as FilingPersisterDeps;
  return { deps, replaceForIpo, detailsUpsert };
}

const scraped = () => (upsertIPOMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
const details = (h: ReturnType<typeof makeDeps>) =>
  Object.assign({}, ...h.detailsUpsert.mock.calls.map((c) => c[1] as Record<string, unknown>)) as Record<string, unknown>;
const brlmRows = (h: ReturnType<typeof makeDeps>) =>
  ((h.replaceForIpo.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>).filter((r) => r.role === 'BRLM');

const DRHP_HELD = { source: 'DRHP', dataLineage: { method: 'FILING_EXTRACTION', docType: 'DRHP', documentId: DRHP_ID } };
const DRHP_DOC = { id: DRHP_ID, docType: 'DRHP', filingDate: '2026-02-01' };

async function runRhp(h: ReturnType<typeof makeDeps>, docType = 'RHP') {
  return persistFilingExtraction(IPO_ID, extraction(docType), { docType, documentId: RHP_ID, apply: true }, h.deps);
}

describe('filing-persister - a later offer document supersedes an earlier one on the lead managers (OD-30, OD-154)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('DRHP then RHP with a changed list: the RHP list wins in ipos and ipo_details, and the grievance e-mails file', async () => {
    const h = makeDeps(DRHP_HELD, [DRHP_DOC]);
    await runRhp(h);
    expect(scraped().leadManagers).toEqual(RHP_LIST);
    expect(details(h).leadManagers).toEqual(RHP_LIST);
    const rows = brlmRows(h);
    expect(rows.map((r) => r.name)).toEqual(RHP_LIST);
    expect(rows.find((r) => r.name === 'Kotak Mahindra Capital Company Limited')?.grievanceEmail).toBe('kmccredressal@kotak.com');
    expect(rows.find((r) => r.name === 'JM Financial Limited')?.grievanceEmail).toBe('grievance.ibd@jmfl.com');
  });

  it('the stored document type may come from the documents row when the lineage names only the document', async () => {
    const h = makeDeps({ source: 'DRHP', dataLineage: { documentId: DRHP_ID } }, [DRHP_DOC]);
    await runRhp(h);
    expect(scraped().leadManagers).toEqual(RHP_LIST);
  });

  it('an earlier RHP of the same IPO is replaced by a later-filed RHP (OD-30 within one type)', async () => {
    const OLD = 'aaaaaaaa-0000-4000-8000-000000000001';
    const h = makeDeps({ source: 'DRHP', dataLineage: { docType: 'RHP', documentId: OLD } }, [{ id: OLD, docType: 'RHP', filingDate: '2026-08-01' }]);
    await runRhp(h);
    expect(scraped().leadManagers).toEqual(RHP_LIST);
  });

  const KEPT: Array<[string, Provenance, Array<{ id: string; docType: string; filingDate: string | null }>, string?]> = [
    ['an ADMIN value', { source: 'ADMIN', dataLineage: { docType: 'DRHP', documentId: DRHP_ID } }, [DRHP_DOC]],
    ['a website value (BSE)', { source: 'BSE', dataLineage: null }, []],
    ['no provenance row', null, []],
    ['a document value with no document type anywhere', { source: 'DRHP', dataLineage: { documentId: 'unknown-doc' } }, []],
    ['a PROSPECTUS value (it outranks an RHP)', { source: 'DRHP', dataLineage: { docType: 'PROSPECTUS', documentId: 'p1' } }, [{ id: 'p1', docType: 'PROSPECTUS', filingDate: '2026-09-15' }]],
    ['a later-filed RHP value', { source: 'DRHP', dataLineage: { docType: 'RHP', documentId: 'r2' } }, [{ id: 'r2', docType: 'RHP', filingDate: '2026-09-20' }]],
    ['an RHP value of unknown filing date (OD-30 cannot order)', { source: 'DRHP', dataLineage: { docType: 'RHP', documentId: 'r3' } }, [{ id: 'r3', docType: 'RHP', filingDate: null }]],
    ['an unreadable provenance', 'throw', []],
  ];
  for (const [name, prov, docs] of KEPT) {
    it(`${name} is kept: no list write, rows keep the held list, no grievance e-mail pinned`, async () => {
      const h = makeDeps(prov, docs);
      await runRhp(h);
      expect(scraped()).not.toHaveProperty('leadManagers');
      expect('leadManagers' in details(h)).toBe(false);
      const rows = brlmRows(h);
      expect(rows.map((r) => r.name)).toEqual(DRHP_LIST);
      expect(rows.every((r) => r.grievanceEmail === null)).toBe(true);
    });
  }

  it('a DRHP read after an RHP never replaces the RHP list', async () => {
    const h = makeDeps({ source: 'DRHP', dataLineage: { docType: 'RHP', documentId: RHP_ID } }, [{ id: RHP_ID, docType: 'RHP', filingDate: '2026-09-09' }], '2026-02-01');
    await persistFilingExtraction(IPO_ID, extraction('DRHP'), { docType: 'DRHP', documentId: DRHP_ID, apply: true }, h.deps);
    expect(scraped()).not.toHaveProperty('leadManagers');
    expect('leadManagers' in details(h)).toBe(false);
  });

  it('an ADMIN hold on the column still wins over a superseding document (section 2.7)', async () => {
    const h = makeDeps(DRHP_HELD, [DRHP_DOC]);
    (h.deps as unknown as Record<string, unknown>).protectionFilter = vi.fn(async (_id: string, t: string, data: Record<string, unknown>) => {
      const filtered = { ...data };
      if (t === 'ipos' || t === 'ipo_details') delete filtered.leadManagers;
      return { filtered };
    });
    await runRhp(h);
    expect(scraped()).not.toHaveProperty('leadManagers');
    expect(brlmRows(h).map((r) => r.name)).toEqual(DRHP_LIST);
  });
});
