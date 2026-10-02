/**
 * Item 39 (OD-164(b), OD-162): the cover-block reader's answers reach the write path.
 *
 * The values are the R K Fashion Accessories SME RHP's own cover, as the reader
 * returns them for scraper/tests/fixtures/cover-block/rkfal-sme-rhp.json
 * (scraper/scripts/test_cover_block.py asserts the same values from the text):
 *   BRLM       Affinity Global Capital Market Private Limited (p.1)
 *   registrar  Cameo Corporate Services Limited, investor@cameoindia.com, +91 44 2846 0390
 *
 * Proved: (1) an RHP writes ipos.lead_managers + ipos.registrar with a receipt each (OD-162,
 * OD-91 receipts); (2) the BRLM / REGISTRAR intermediary rows carry the document's names
 * (row 114 reconciles with ipos.lead_managers); (3) a PRICE_BAND_AD carrying the same fields
 * writes neither column and leaves no receipt (OD-96); (4) a MISSED read writes nothing, so a
 * stored value stays (OD-158).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b3b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6d';
const BRLM = 'Affinity Global Capital Market Private Limited';
const REGISTRAR = 'Cameo Corporate Services Limited';

type Field = FilingExtraction['fields'][string];

function value(v: unknown, page = 0): Field {
  return { value: v, page, check: { name: 'c', passed: true }, state: 'VALUE' } as unknown as Field;
}
function missed(reason: string): Field {
  return { value: null, page: null, check: { name: 'not_extractable', passed: true, detail: reason }, state: 'MISSED' } as unknown as Field;
}

function extraction(docType: string, fields: Record<string, Field>): FilingExtraction {
  return {
    doc_type: docType,
    source_doc: 'rkfal.pdf',
    pages: 496,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [],
    fields,
  } as FilingExtraction;
}

const RKFAL_FIELDS = {
  lead_managers: value([BRLM], 0),
  registrar_name: value(REGISTRAR, 0),
  registrar_email: value('investor@cameoindia.com', 0),
  registrar_phone: value('+91 44 2846 0390', 0),
  registrar_sebi_reg: missed('registrar_sebi_reg_not_found'),
  lead_manager_sebi_reg: missed('lead_manager_sebi_reg_not_found'),
};

function makeDeps(stored: { leadManagers?: string[]; registrar?: string } = {}) {
  const replaceForIpo = vi.fn(async () => []);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'R K Fashion Accessories Limited',
        slug: 'r-k-fashion-accessories-ltd',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE'],
        ...stored,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
  return { deps, replaceForIpo };
}

function intermediaryRows(replaceForIpo: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  expect(replaceForIpo).toHaveBeenCalled();
  return replaceForIpo.mock.calls[0][1] as Array<Record<string, unknown>>;
}

describe('filing-persister — item 39 cover block', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('an RHP writes ipos.lead_managers and ipos.registrar with a receipt each (OD-162)', async () => {
    const h = makeDeps({ leadManagers: ['Some Other Capital Limited'], registrar: 'Old Registry Limited' });
    const summary = await persistFilingExtraction(IPO_ID, extraction('RHP', RKFAL_FIELDS), { docType: 'RHP', apply: true }, h.deps);

    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.leadManagers).toEqual([BRLM]);
    expect(scraped.registrar).toBe(REGISTRAR);
    expect(summary.ipos_fields).toEqual(expect.arrayContaining(['leadManagers', 'registrar']));
    const receipt = (f: string) => summary.receipt_fields?.find((r) => r.tableName === 'ipos' && r.fieldName === f);
    expect(receipt('leadManagers')).toBeDefined();
    expect(receipt('leadManagers')?.value).toContain(BRLM);
    expect(receipt('registrar')?.value).toBe(REGISTRAR);

    const rows = intermediaryRows(h.replaceForIpo);
    const brlm = rows.filter((r) => r.role === 'BRLM');
    expect(brlm.map((r) => r.name)).toEqual([BRLM]);
    const reg = rows.find((r) => r.role === 'REGISTRAR');
    expect(reg?.name).toBe(REGISTRAR);
    expect(reg?.email).toBe('investor@cameoindia.com');
    expect(reg?.phone).toBe('+91 44 2846 0390');
  });

  it('a PRICE_BAND_AD carrying the same fields writes neither column and leaves no receipt (OD-96)', async () => {
    const h = makeDeps();
    const summary = await persistFilingExtraction(IPO_ID, extraction('PRICE_BAND_AD', RKFAL_FIELDS), { docType: 'PRICE_BAND_AD', apply: true }, h.deps);
    const scraped = (upsertIPOMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(scraped).not.toHaveProperty('leadManagers');
    expect(scraped).not.toHaveProperty('registrar');
    expect(summary.receipt_fields?.some((r) => r.tableName === 'ipos' && (r.fieldName === 'leadManagers' || r.fieldName === 'registrar'))).toBe(false);
  });

  it('a MISSED read writes nothing, so the stored lead managers and registrar stay (OD-158)', async () => {
    const h = makeDeps({ leadManagers: ['Stored Capital Limited'], registrar: 'Stored Registry Limited' });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction('RHP', {
        lead_managers: missed('lead_managers_sources_disagree'),
        registrar_name: missed('registrar_not_found'),
        registrar_email: value('someone@example.com'),
      }),
      { docType: 'RHP', apply: true },
      h.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(scraped).not.toHaveProperty('leadManagers');
    expect(scraped).not.toHaveProperty('registrar');
    expect(summary.receipt_fields?.some((r) => r.fieldName === 'leadManagers')).toBe(false);
    const rows = intermediaryRows(h.replaceForIpo);
    expect(rows.filter((r) => r.role === 'BRLM').map((r) => r.name)).toEqual(['Stored Capital Limited']);
    // contact lines are never filed on a registrar name the document did not read
    const reg = rows.find((r) => r.role === 'REGISTRAR');
    expect(reg?.name).toBe('Stored Registry Limited');
    expect(reg?.email).toBeNull();
  });

  it('a single document BRLM carries its own INM number', async () => {
    const h = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extraction('RHP', { ...RKFAL_FIELDS, lead_manager_sebi_reg: value('INM000012838') }),
      { docType: 'RHP', apply: true },
      h.deps
    );
    const rows = intermediaryRows(h.replaceForIpo);
    expect(rows.find((r) => r.role === 'BRLM')?.sebiRegNo).toBe('INM000012838');
  });

  // OD-166 (row 46), the NSE RHP's own values (F-228): nse_ipo@nse.co.in vs www.nseindia.com.
  function nseEmail(passed: boolean): Record<string, Field> {
    return {
      ...RKFAL_FIELDS,
      company_website: value('www.nseindia.com', 0),
      compliance_officer_email: {
        ...(value('nse_ipo@nse.co.in', 0) as object),
        cross_check: { name: 'email_domain_matches_website', passed },
      } as unknown as Field,
    };
  }

  it('OD-166: an email on another domain is KEPT and listed for the admin, never refused', async () => {
    const h = makeDeps();
    const listForAdmin = vi.fn(async () => undefined);
    (h.deps as unknown as Record<string, unknown>).adminListing = { listForAdmin };
    const writer = (h.deps as unknown as { ipoDetailsWriter: { upsert: ReturnType<typeof vi.fn> } }).ipoDetailsWriter;
    await persistFilingExtraction(IPO_ID, extraction('RHP', nseEmail(false)), { docType: 'RHP', apply: true, documentId: 'doc-1' }, h.deps);
    const details = writer.upsert.mock.calls.map((c) => c[1] as Record<string, unknown>).find((v) => 'complianceOfficerEmail' in v);
    expect(details?.complianceOfficerEmail).toBe('nse_ipo@nse.co.in');
    expect(listForAdmin).toHaveBeenCalledTimes(1);
    expect(listForAdmin.mock.calls[0][0]).toMatchObject({
      ipoId: IPO_ID,
      documentId: 'doc-1',
      tableName: 'ipo_details',
      fieldName: 'complianceOfficerEmail',
      value: 'nse_ipo@nse.co.in',
      rule: 'OD-166',
    });
  });

  it('OD-166: a matching domain is not listed; a dry run lists nothing', async () => {
    const listForAdmin = vi.fn(async () => undefined);
    const a = makeDeps();
    (a.deps as unknown as Record<string, unknown>).adminListing = { listForAdmin };
    await persistFilingExtraction(IPO_ID, extraction('RHP', nseEmail(true)), { docType: 'RHP', apply: true, documentId: 'doc-1' }, a.deps);
    const b = makeDeps();
    (b.deps as unknown as Record<string, unknown>).adminListing = { listForAdmin };
    await persistFilingExtraction(IPO_ID, extraction('RHP', nseEmail(false)), { docType: 'RHP', apply: false, documentId: 'doc-1' }, b.deps);
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it('OD-166 / OD-96: a PRICE_BAND_AD carrying the email lists nothing for the admin', async () => {
    const h = makeDeps();
    const listForAdmin = vi.fn(async () => undefined);
    (h.deps as unknown as Record<string, unknown>).adminListing = { listForAdmin };
    await persistFilingExtraction(IPO_ID, extraction('PRICE_BAND_AD', nseEmail(false)), { docType: 'PRICE_BAND_AD', apply: true, documentId: 'doc-1' }, h.deps);
    expect(listForAdmin).not.toHaveBeenCalled();
  });
});
