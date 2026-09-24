/**
 * #1016 (RCA of #862's follow-on): the filing persister writes the E-1
 * exchange-owned timetable dates `creditOfSharesDate`, `basisOfAllotmentDate`
 * and `initiationOfRefundsDate` through `trackField` with source DRHP. The
 * #862 guard in `FieldSourcesRepository.trackFieldUpdate` refuses E-1 fields
 * on the document path by THROWING — nothing caught it, so one exchange-owned
 * field sank the whole document: the `ipo_details` upsert had already run by
 * then, so the document was marked FAILED and wrote no receipts at all.
 *
 * Class: any document of any type (price-band ad, RHP, prospectus, ...) that
 * prints any E-1 field. `source` is always DRHP for this persister
 * (`scraperSourceForDocType`), so every doc type is in the class.
 *
 * This test drives the REAL `FieldSourcesRepository.trackFieldUpdate` (a stub
 * db/redis, same shape as `field-sources-e1-guard.test.ts`) as
 * `deps.fieldSources` — not a mock that merely returns `{}` — so the real
 * #862 guard is exactly what would have thrown before the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock, warnMock } = vi.hoisted(() => ({
  upsertIPOMock: vi.fn(async () => 'ipo-id'),
  warnMock: vi.fn(),
}));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() },
}));

import { FieldSourcesRepository } from '@ipodhan/shared/repositories/field-sources-repository';
import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b3b1f4d7-1f3f-4c8a-8f1d-2e3f4a5b6c7d';

function makeStubFieldSourcesDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'row-1', rowKey: '' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, select: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() } as unknown as never;
}

const stubRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

/** A price-band-ad extraction that prints a compliance officer (legit) AND an
 *  E-1 credit date (exchange-stated, must be refused on the document path). */
function priceBandAdWithE1Date(): FilingExtraction {
  const values: Record<string, unknown> = {
    headline_source: 'PRICE_BAND_AD',
    issue_price_type: 'BOOK_BUILDING',
    price_band_floor: 100,
    price_band_cap: 110,
    face_value: 10,
    lot_size: 100,
    compliance_officer: 'Jane Doe',
    credit_date: '2026-10-05',
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'PRICE_BAND_AD',
    source_doc: 'price_band_ad.pdf',
    pages: 1,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Testcredit Limited',
        slug: 'testcredit-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    // The REAL guard, not a stub that swallows everything.
    fieldSources: new FieldSourcesRepository(makeStubFieldSourcesDb(), stubRedis),
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
}

describe('#1016: an E-1 field on the document path is dropped, not thrown', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
    warnMock.mockClear();
  });

  it('completes the document instead of throwing when it prints an E-1 date', async () => {
    await expect(
      persistFilingExtraction(
        IPO_ID,
        priceBandAdWithE1Date(),
        { docType: 'PRICE_BAND_AD', apply: true, documentId: 'doc-1' },
        makeDeps()
      )
    ).resolves.toBeDefined();
  });

  it('writes the OTHER ipo_details fields and does not write the E-1 date', async () => {
    const deps = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      priceBandAdWithE1Date(),
      { docType: 'PRICE_BAND_AD', apply: true, documentId: 'doc-1' },
      deps
    );
    const upsertCalls = (deps.ipoDetailsWriter.upsert as ReturnType<typeof vi.fn>).mock.calls;
    expect(upsertCalls.length).toBeGreaterThan(0);
    const payload = upsertCalls[0][1] as Record<string, unknown>;
    expect(payload.complianceOfficer).toBe('Jane Doe');
    expect(payload.creditOfSharesDate).toBeUndefined();
  });

  it('logs one structured refusal naming the field, document id and value', async () => {
    await persistFilingExtraction(
      IPO_ID,
      priceBandAdWithE1Date(),
      { docType: 'PRICE_BAND_AD', apply: true, documentId: 'doc-1' },
      makeDeps()
    );
    const refusal = warnMock.mock.calls.find(
      (call) => call[0]?.reason === 'e1-document-path-refused'
    );
    expect(refusal).toBeDefined();
    expect(refusal![0]).toMatchObject({
      field: 'creditOfSharesDate',
      value: '2026-10-05',
      documentId: 'doc-1',
      source: 'DRHP',
    });
  });

  it('records the refusal in skipped_failed_check', async () => {
    const summary = await persistFilingExtraction(
      IPO_ID,
      priceBandAdWithE1Date(),
      { docType: 'PRICE_BAND_AD', apply: true, documentId: 'doc-1' },
      makeDeps()
    );
    expect(summary.skipped_failed_check.some((s) => s.includes('creditOfSharesDate'))).toBe(true);
  });
});

describe('#862 guard still throws for a non-document caller (unweakened)', () => {
  it('refuses a DRHP write to an E-1 field outside the document-path filter', async () => {
    const repo = new FieldSourcesRepository(makeStubFieldSourcesDb(), stubRedis);
    await expect(
      repo.trackFieldUpdate({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'creditOfSharesDate',
        source: 'DRHP' as never,
      })
    ).rejects.toThrow(/E-1/);
  });
});
