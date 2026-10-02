/**
 * Item 39 round 2 (spec 2.5.6 item 2; Appendix A row 30): the cover reader's issuer website reaches
 * `ipos.company_website` through its one existing writer, `recordDocumentSourceHints` (write-once).
 *
 * The values are real covers, as the reader returns them (scraper/scripts/test_cover_block.py reads
 * the same fixtures under scraper/tests/fixtures/cover-block/):
 *   vishal-nirmiti-mainboard-rhp.json  company_website "www.vishalnirmiti.com" (index 2)
 *   nse-mainboard-rhp.json             company_website "www.nseindia.com" (index 0) - an exchange
 *     host, which normalizeCompanyUrl refuses (the issuer here IS the exchange; the column feeds the
 *     company-host discovery rung, which must never fetch an exchange host).
 *
 * Proved: (1) an RHP with an EMPTY column writes it, normalised to https; (2) a stored website is
 * never replaced (write-once, OD-158); (3) a PRICE_BAND_AD carrying the same answer writes nothing
 * (OD-96); (4) a MISSED read writes nothing; (5) a non-issuer host is refused (E7 host check);
 * (6) a dry run (apply false) writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock, hintsMock } = vi.hoisted(() => ({
  upsertIPOMock: vi.fn(async () => 'ipo-id'),
  hintsMock: vi.fn(async () => undefined),
}));
vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: upsertIPOMock,
  recordDocumentSourceHints: hintsMock,
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'c1b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6e';
type Field = FilingExtraction['fields'][string];

function value(v: unknown, page = 0): Field {
  return { value: v, page, check: { name: 'website_has_host', passed: true }, state: 'VALUE' } as unknown as Field;
}
function missed(reason: string): Field {
  return { value: null, page: null, check: { name: 'not_extractable', passed: true, detail: reason }, state: 'MISSED' } as unknown as Field;
}
function extraction(docType: string, fields: Record<string, Field>): FilingExtraction {
  return { doc_type: docType, source_doc: 'nse-rhp.pdf', pages: 600, extraction_status: 'OK', unit: 'crores', fiscal_years: [], fields } as FilingExtraction;
}

function makeDeps(stored: { companyWebsite?: string | null } = {}) {
  const ipoRepository = {
    findById: vi.fn(async () => ({
      id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: ['BSE'], ...stored,
    })),
    updateDocumentSourceHints: vi.fn(async () => ({ id: IPO_ID })),
  };
  return {
    ipoRepository,
    deps: {
      ipoRepository,
      financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
      ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
      promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
      intermediaries: { replaceForIpo: vi.fn(async () => []) },
      brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
      peerCompanies: { replaceForIpo: vi.fn(async () => []) },
      financialData: { upsert: vi.fn(async (r: unknown) => r) },
      fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
      ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    } as unknown as FilingPersisterDeps,
  };
}

const VNL = { company_website: value('www.vishalnirmiti.com', 2) };
const NSE = { company_website: value('www.nseindia.com', 0) };

describe('filing-persister - item 39 round 2: cover website to ipos.company_website', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
    hintsMock.mockClear();
  });

  it('an RHP with an EMPTY column writes the website through the write-once path', async () => {
    const h = makeDeps({ companyWebsite: null });
    const summary = await persistFilingExtraction(IPO_ID, extraction('RHP', VNL), { docType: 'RHP', apply: true }, h.deps);
    expect(hintsMock).toHaveBeenCalledTimes(1);
    expect(hintsMock).toHaveBeenCalledWith(h.ipoRepository, IPO_ID, { companyWebsite: 'www.vishalnirmiti.com' }, { companyWebsite: null });
    expect(summary.ipos_fields).toContain('companyWebsite');
  });

  it('a STORED website is never replaced (write-once)', async () => {
    const h = makeDeps({ companyWebsite: 'https://www.vishalnirmiti.com/investors' });
    const summary = await persistFilingExtraction(IPO_ID, extraction('RHP', VNL), { docType: 'RHP', apply: true }, h.deps);
    expect(hintsMock).not.toHaveBeenCalled();
    expect(summary.skipped_no_column.join('\n')).toContain('company_website: write-once');
  });

  it('a PRICE_BAND_AD carrying the same answer writes nothing (OD-96)', async () => {
    const h = makeDeps({ companyWebsite: null });
    const summary = await persistFilingExtraction(IPO_ID, extraction('PRICE_BAND_AD', VNL), { docType: 'PRICE_BAND_AD', apply: true }, h.deps);
    expect(hintsMock).not.toHaveBeenCalled();
    expect(summary.skipped_no_column.join('\n')).toContain('company_website: OD-96');
  });

  it('a MISSED read writes nothing, so a stored value stays', async () => {
    const h = makeDeps({ companyWebsite: null });
    await persistFilingExtraction(IPO_ID, extraction('RHP', { company_website: missed('company_website_not_found') }), { docType: 'RHP', apply: true }, h.deps);
    expect(hintsMock).not.toHaveBeenCalled();
  });

  it('an exchange host (the NSE RHP cover) is refused before the write (E7 host check)', async () => {
    const h = makeDeps({ companyWebsite: null });
    const summary = await persistFilingExtraction(IPO_ID, extraction('RHP', NSE), { docType: 'RHP', apply: true }, h.deps);
    expect(hintsMock).not.toHaveBeenCalled();
    expect(summary.skipped_failed_check.join('\n')).toContain('company_website: E7 host refused');
  });

  it('a dry run writes nothing', async () => {
    const h = makeDeps({ companyWebsite: null });
    await persistFilingExtraction(IPO_ID, extraction('RHP', VNL), { docType: 'RHP', apply: false }, h.deps);
    expect(hintsMock).not.toHaveBeenCalled();
  });
});
