/**
 * Appendix A rows 59-60 (`ipo_details.registrar_link`, `ipo_details.lead_managers`; DOC rank 1, E7) from
 * the cover reader (item 39, spec 2.5.6 item 2; OD-162 for the lead manager list).
 *
 * Values are the NSE DRHP's own reads (D:/Abhay/Ventures/IPODhan-doc-cache/national-stock-exchange-of-india-ltd/
 * DRHP-d88fad44-...pdf): General Information p92 "Website: www.in.mpms.mufg.com" (extractor field
 * registrar_website, 0-based page 91) and the Definitions-row list of 20 book running lead managers (page 9)
 * that `ipos.lead_managers` already takes. Before the fix neither reached ipo_details.
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
import { mappedField } from '../../../src/services/filing-clearable-columns';
import { normalizeRegistrarLink } from '../../../src/services/company-host-source';

const IPO_ID = 'd88fad44-0000-4000-8000-000000000059';
type Field = FilingExtraction['fields'][string];
const value = (v: unknown, page: number): Field =>
  ({ value: v, page, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;
const missed = (reason: string): Field =>
  ({ value: null, page: null, check: { name: 'not_extractable', passed: true, detail: reason }, state: 'MISSED' }) as unknown as Field;

const NSE_BRLMS = [
  'Kotak Mahindra Capital Company Limited', 'JM Financial Limited', 'Morgan Stanley India Company Private Limited',
  'Citigroup Global Markets India Private Limited', 'HSBC Securities and Capital Markets (India) Private Limited',
  'J.P. Morgan India Private Limited', 'SBI Capital Markets Limited', 'Anand Rathi Advisors Limited',
  'Avendus Capital Private Limited', 'Axis Capital Limited', 'DAM Capital Advisors Limited', 'Equirus Capital Limited',
  'HDFC Bank Limited', 'ICICI Securities Limited', 'IDBI Capital Markets & Securities Limited',
  'IIFL Capital Services Limited', 'Motilal Oswal Investment Advisors Limited', 'Nuvama Wealth Management Limited',
  'Pantomath Capital Advisors Private Limited', '360 ONE WAM Limited',
];

function extraction(docType: string, fields: Record<string, Field>): FilingExtraction {
  return { doc_type: docType, source_doc: 'DRHP-d88fad44.pdf', pages: 614, extraction_status: 'OK', unit: 'millions', fiscal_years: [], fields } as FilingExtraction;
}

const NSE_FIELDS = (): Record<string, Field> => ({
  registrar_website: value('www.in.mpms.mufg.com', 91),
  lead_managers: value(NSE_BRLMS, 9),
});

function makeDeps() {
  const upsert = vi.fn(async (_id: string, values: Record<string, unknown>, opts?: { afterWriteInTx?: (tx: unknown, w: Record<string, unknown>) => Promise<void> }) => {
    await opts?.afterWriteInTx?.('tx-1', values);
  });
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert, insertIfMissing: vi.fn(async () => false) },
  } as unknown as FilingPersisterDeps;
  return { deps, upsert };
}

const detailsWritten = (upsert: ReturnType<typeof vi.fn>): Record<string, unknown> =>
  Object.assign({}, ...upsert.mock.calls.map((c) => c[1] as Record<string, unknown>));

describe('filing-persister - ipo_details.registrar_link and ipo_details.lead_managers (rows 59-60)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('the map names the cover reader fields (one-to-one, clearable)', () => {
    expect(mappedField('ipo_details', 'registrarLink')).toBe('registrar_website');
    expect(mappedField('ipo_details', 'leadManagers')).toBe('lead_managers');
  });

  it('the NSE DRHP writes the registrar website as an https origin and the 20 lead managers, each with a receipt', async () => {
    const h = makeDeps();
    const summary = await persistFilingExtraction(IPO_ID, extraction('DRHP', NSE_FIELDS()), { docType: 'DRHP', apply: true }, h.deps);
    const d = detailsWritten(h.upsert);
    expect(d.registrarLink).toBe('https://www.in.mpms.mufg.com');
    expect(d.leadManagers).toEqual(NSE_BRLMS);
    const r = (summary.receipt_fields ?? []).filter((x) => x.tableName === 'ipo_details');
    expect(r.find((x) => x.fieldName === 'registrarLink')?.value).toBe('https://www.in.mpms.mufg.com');
    expect(r.find((x) => x.fieldName === 'leadManagers')?.value).toBe(JSON.stringify(NSE_BRLMS));
  });

  it('a MISSED read writes neither column (a stored value stays, OD-158)', async () => {
    const h = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extraction('DRHP', { registrar_website: missed('registrar_block_not_found'), lead_managers: missed('lead_managers_row_overrun') }),
      { docType: 'DRHP', apply: true },
      h.deps
    );
    const d = detailsWritten(h.upsert);
    expect('registrarLink' in d).toBe(false);
    expect('leadManagers' in d).toBe(false);
  });

  it('a list with an empty name is not a passing read: no lead managers written', async () => {
    const h = makeDeps();
    await persistFilingExtraction(IPO_ID, extraction('DRHP', { lead_managers: value(['Kotak Mahindra Capital Company Limited', ' '], 9) }), { docType: 'DRHP', apply: true }, h.deps);
    expect('leadManagers' in detailsWritten(h.upsert)).toBe(false);
  });

  it('a refused host (private, port, other scheme) writes no registrar link and says why', async () => {
    for (const bad of ['localhost', '127.0.0.1', 'www.in.mpms.mufg.com:8080', 'mailto:nse.ipo@in.mpms.mufg.com']) {
      const h = makeDeps();
      const summary = await persistFilingExtraction(IPO_ID, extraction('DRHP', { registrar_website: value(bad, 91) }), { docType: 'DRHP', apply: true }, h.deps);
      expect('registrarLink' in detailsWritten(h.upsert)).toBe(false);
      expect(summary.skipped_failed_check.join('\n')).toContain('ipo_details.registrarLink: E7 host refused');
    }
  });

  it('a price band advert (outside the RHP family) writes neither column (OD-96)', async () => {
    const h = makeDeps();
    await persistFilingExtraction(IPO_ID, extraction('PRICE_BAND_AD', NSE_FIELDS()), { docType: 'PRICE_BAND_AD', apply: true }, h.deps);
    const d = detailsWritten(h.upsert);
    expect('registrarLink' in d).toBe(false);
    expect('leadManagers' in d).toBe(false);
  });

  it('normalizeRegistrarLink keeps registrar hosts normalizeCompanyUrl refuses', () => {
    expect(normalizeRegistrarLink('www.linkintime.co.in')).toBe('https://www.linkintime.co.in');
    expect(normalizeRegistrarLink('https://ipo.bigshareonline.com/IPO_Status.html')).toBe('https://ipo.bigshareonline.com');
    expect(normalizeRegistrarLink('ftp://www.linkintime.co.in')).toBeNull();
    expect(normalizeRegistrarLink('')).toBeNull();
  });
});
