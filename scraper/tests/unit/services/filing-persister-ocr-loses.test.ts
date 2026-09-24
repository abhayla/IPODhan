/**
 * OD-97 (item 22, spec §2.2.1 OD-36 "Image-only pages go to OCR, marked"): the
 * per-value OCR mark reaches the receipt and provenance, and an OCR-only value
 * never wins a disagreement against a text-page value.
 *
 * Input is the REAL extractor envelope of SteamHouse India's price band
 * advertisement (BSE, 2026-09-07), a newspaper scan whose 4 pages all went
 * through OCR (fixtures/ocr/steamhouse-price-band-ad.envelope.json + .meta.json).
 * It reads band Rs 77-81, lot 185, face value 2, credit date 2026-09-16 (page 3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
import { fieldsMark, ocrValueLoses } from '../../../src/services/ocr-value-mark';

const IPO_ID = '5a1e0c9d-3b2f-4e8a-9c7d-0f1e2d3c4b5a';
const FIXTURE = resolve(__dirname, '../../fixtures/ocr/steamhouse-price-band-ad.envelope.json');

function realOcrEnvelope(): FilingExtraction {
  return JSON.parse(readFileSync(FIXTURE, 'utf-8')) as FilingExtraction;
}

/** The same envelope as a text-layer read would report it (no OCR'd page). */
function asTextRead(e: FilingExtraction): FilingExtraction {
  const fields: FilingExtraction['fields'] = {};
  for (const [k, f] of Object.entries(e.fields)) {
    const { source_text: _s, ocr_confidence: _c, ...rest } = f;
    fields[k] = rest;
  }
  return { ...e, extraction_status: 'OK', ocr_pages: [], fields };
}

interface Harness {
  deps: FilingPersisterDeps;
  detailsUpsert: ReturnType<typeof vi.fn>;
  trackFieldUpdate: ReturnType<typeof vi.fn>;
}

function makeDeps(opts: {
  stored?: Record<string, unknown>;
  storedDetails?: Record<string, unknown> | null;
  /** `${table}.${field}` -> text receipts; a bare string is a same-type, same-day text read. */
  textReceipts?: Record<string, Array<string | { value: string; docType: string; filingDate?: string | null }>>;
  /** The OCR value's own document as the documents table holds it. */
  ocrDocument?: { docType: string; filingDate: string | null } | null;
  withRule?: boolean;
}): Harness {
  const ownType = opts.ocrDocument?.docType ?? 'PRICE_BAND_AD';
  const ownDate = opts.ocrDocument === undefined ? '2026-09-05' : (opts.ocrDocument?.filingDate ?? null);
  const detailsUpsert = vi.fn(async () => undefined);
  const trackFieldUpdate = vi.fn(async () => ({}));
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'SteamHouse India Limited',
        slug: 'steamhouse-india-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['BSE', 'NSE'],
        ...(opts.stored ?? {}),
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate },
    ipoDetailsWriter: { upsert: detailsUpsert },
    ...(opts.withRule === false
      ? {}
      : {
          ocrPrecedence: {
            textReceipts: vi.fn(async (_id: string, table: string, field: string) =>
              (opts.textReceipts?.[`${table}.${field}`] ?? []).map((r, i) => {
                const t = typeof r === 'string' ? { value: r, docType: ownType, filingDate: ownDate } : r;
                return {
                  value: t.value,
                  document: { id: `text-doc-${i}`, docType: t.docType, filingDate: t.filingDate ?? null, sha256: null },
                };
              })
            ),
            documentRef: vi.fn(async (id: string) =>
              opts.ocrDocument === null ? null : { id, docType: ownType, filingDate: ownDate, sha256: null }
            ),
            storedDetails: vi.fn(async () => opts.storedDetails ?? null),
          },
        }),
  } as unknown as FilingPersisterDeps;
  return { deps, detailsUpsert, trackFieldUpdate };
}

const run = (e: FilingExtraction, h: Harness, docType: 'PRICE_BAND_AD' | 'RHP' | 'DRHP' | 'PROSPECTUS' = 'PRICE_BAND_AD') =>
  persistFilingExtraction(IPO_ID, e, { docType, documentId: 'ocr-doc', apply: true }, h.deps);

describe('OD-97 — an OCR-only value never wins a disagreement against a text page', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('the real OCR read marks every receipted value OCR with its page confidence', async () => {
    const summary = await run(realOcrEnvelope(), makeDeps({}));
    const r = (t: string, f: string) => summary.receipt_fields?.find((x) => x.tableName === t && x.fieldName === f);
    expect(r('ipos', 'priceRangeMax')).toMatchObject({ value: '81', sourceText: 'OCR', ocrConfidence: 0.7456 });
    expect(r('ipos', 'lotSize')).toMatchObject({ value: '185', sourceText: 'OCR' });
    // #1016: creditOfSharesDate is an E-1 (exchange-stated) field — the receipt still records
    // what the document printed (same treatment as an OCR value that loses precedence), but the
    // field is refused from ipo_details before the write and is never tracked in field_sources.
    expect(r('ipo_details', 'creditOfSharesDate')).toMatchObject({
      value: '2026-09-16',
      sourceText: 'OCR',
      ocrConfidence: 0.761,
    });
  });

  it('#1016: creditOfSharesDate (E-1) is never tracked in field_sources, OCR or not', async () => {
    const h = makeDeps({});
    await run(realOcrEnvelope(), h);
    const credit = h.trackFieldUpdate.mock.calls
      .map((c) => c[0] as { tableName: string; fieldName: string; dataLineage: Record<string, unknown> })
      .find((c) => c.tableName === 'ipo_details' && c.fieldName === 'creditOfSharesDate');
    expect(credit).toBeUndefined();
  });

  it('an OCR-only band cap loses to the stored text-page value; agreeing OCR fields still write', async () => {
    const h = makeDeps({
      stored: { priceRangeMax: '83.00', priceRangeMin: '77.00' },
      textReceipts: { 'ipos.priceRangeMax': ['83'] },
    });
    const summary = await run(realOcrEnvelope(), h);
    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.priceRangeMax).toBeUndefined();
    expect(scraped.priceRangeMin).toBe(77);
    expect(scraped.lotSize).toBe(185);
    expect(summary.skipped_lower_priority_source.join('\n')).toContain(
      "ipos.priceRangeMax (OCR-only value '81' loses to the text-page value '83', OD-97)"
    );
    // The receipt still says what the document printed.
    expect(summary.receipt_fields?.find((x) => x.fieldName === 'priceRangeMax')?.value).toBe('81');
  });

  it('an ipo_details OCR value loses the same way', async () => {
    const h = makeDeps({
      storedDetails: { creditOfSharesDate: '2026-09-17' },
      textReceipts: { 'ipo_details.creditOfSharesDate': ['2026-09-17'] },
    });
    await run(realOcrEnvelope(), h);
    const written = h.detailsUpsert.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written).toBeDefined();
    expect(written.creditOfSharesDate).toBeUndefined();
    expect(written.lotMultiple).toBe(185);
  });

  it('an unknown stored value (no text receipt: before the mark, or another OCR read) does not fire the rule', async () => {
    const h = makeDeps({ stored: { priceRangeMax: '83.00' }, textReceipts: {} });
    await run(realOcrEnvelope(), h);
    expect((upsertIPOMock.mock.calls[0][1] as Record<string, unknown>).priceRangeMax).toBe(81);
  });

  it('whatever the order: a text read over a stored OCR value writes', async () => {
    const h = makeDeps({ stored: { priceRangeMax: '83.00' }, textReceipts: {} });
    const summary = await run(asTextRead(realOcrEnvelope()), h);
    expect((upsertIPOMock.mock.calls[0][1] as Record<string, unknown>).priceRangeMax).toBe(81);
    expect(summary.receipt_fields?.find((x) => x.fieldName === 'priceRangeMax')?.sourceText).toBe('TEXT');
  });

  it('an envelope from before the mark (no ocr_pages) carries no mark and never fires', async () => {
    const old = realOcrEnvelope();
    delete (old as { ocr_pages?: unknown }).ocr_pages;
    const h = makeDeps({ stored: { priceRangeMax: '83.00' }, textReceipts: { 'ipos.priceRangeMax': ['83'] } });
    const summary = await run(old, h);
    expect((upsertIPOMock.mock.calls[0][1] as Record<string, unknown>).priceRangeMax).toBe(81);
    expect(summary.receipt_fields?.find((x) => x.fieldName === 'priceRangeMax')?.sourceText).toBeNull();
  });

  it('a stored-row read failure withholds only the OCR-only values (fail closed)', async () => {
    const h = makeDeps({});
    (h.deps.ocrPrecedence as { storedDetails: () => Promise<unknown> }).storedDetails = async () => {
      throw new Error('db down');
    };
    const summary = await run(realOcrEnvelope(), h);
    expect(h.detailsUpsert).not.toHaveBeenCalled();
    // #1016: creditOfSharesDate is refused as E-1 before this OCR-precedence path even runs, so
    // it no longer appears here — `lotMultiple` is the same-shape OCR-only column that does.
    expect(summary.skipped_lower_priority_source.join('\n')).toContain('ipo_details.lotMultiple (OCR-only value; stored row unreadable');
  });
});

describe('OD-97 — only a text read of a same-or-better document outvotes an OCR value (OD-30, §1 DOC)', () => {
  beforeEach(() => upsertIPOMock.mockClear());
  const scrapedOf = () => upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;

  it('a DRHP text read never beats an RHP OCR value: the RHP value is written', async () => {
    const h = makeDeps({
      ocrDocument: { docType: 'RHP', filingDate: '2026-09-01' },
      stored: { priceRangeMax: '83.00' },
      storedDetails: { creditOfSharesDate: '2026-09-17' },
      textReceipts: {
        'ipos.priceRangeMax': [{ value: '83', docType: 'DRHP', filingDate: '2026-05-01' }],
        'ipo_details.creditOfSharesDate': [{ value: '2026-09-17', docType: 'DRHP', filingDate: '2026-05-01' }],
      },
    });
    const summary = await run(realOcrEnvelope(), h, 'RHP');
    expect(scrapedOf().priceRangeMax).toBe(81);
    // #1016: creditOfSharesDate is E-1 — refused from the document path regardless of which
    // document wins OCR-vs-text precedence, so it is never written to ipo_details at all.
    expect((h.detailsUpsert.mock.calls[0]?.[1] as Record<string, unknown> | undefined)?.creditOfSharesDate).toBeUndefined();
    expect(summary.skipped_lower_priority_source.join('\n')).not.toContain('OD-97');
  });

  it('the reverse: an RHP text read beats a DRHP OCR value', async () => {
    const h = makeDeps({
      ocrDocument: { docType: 'DRHP', filingDate: '2026-05-01' },
      stored: { priceRangeMax: '83.00' },
      storedDetails: { creditOfSharesDate: '2026-09-17' },
      textReceipts: {
        'ipos.priceRangeMax': [{ value: '83', docType: 'RHP', filingDate: '2026-09-01' }],
        'ipo_details.creditOfSharesDate': [{ value: '2026-09-17', docType: 'RHP', filingDate: '2026-09-01' }],
      },
    });
    await run(realOcrEnvelope(), h, 'DRHP');
    expect(scrapedOf().priceRangeMax).toBeUndefined();
    expect((h.detailsUpsert.mock.calls[0]?.[1] as Record<string, unknown> | undefined)?.creditOfSharesDate).toBeUndefined();
  });

  it('same type: an earlier filing text read loses to a later OCR filing; a prospectus text read wins', async () => {
    const earlier = makeDeps({
      stored: { priceRangeMax: '83.00' },
      textReceipts: { 'ipos.priceRangeMax': [{ value: '83', docType: 'PRICE_BAND_AD', filingDate: '2026-09-01' }] },
    });
    await run(realOcrEnvelope(), earlier);
    expect(scrapedOf().priceRangeMax).toBe(81);
    upsertIPOMock.mockClear();
    const prospectus = makeDeps({
      stored: { priceRangeMax: '83.00' },
      textReceipts: { 'ipos.priceRangeMax': [{ value: '83', docType: 'PROSPECTUS', filingDate: '2026-09-12' }] },
    });
    await run(realOcrEnvelope(), prospectus);
    expect(scrapedOf().priceRangeMax).toBeUndefined();
  });

  it('a text-receipt read failure on the ipos path withholds the OCR value (fail closed)', async () => {
    const h = makeDeps({ stored: { priceRangeMax: '83.00' } });
    (h.deps.ocrPrecedence as { textReceipts: () => Promise<unknown> }).textReceipts = async () => {
      throw new Error('db down');
    };
    const summary = await run(realOcrEnvelope(), h);
    expect(scrapedOf().priceRangeMax).toBeUndefined();
    expect(summary.skipped_lower_priority_source.join('\n')).toContain(
      'ipos.priceRangeMax (OCR-only value; text reads unreadable, kept the stored value, OD-97)'
    );
  });

  it('an own-document read failure withholds the OCR value too', async () => {
    const h = makeDeps({ stored: { priceRangeMax: '83.00' }, textReceipts: { 'ipos.priceRangeMax': ['83'] } });
    (h.deps.ocrPrecedence as { documentRef: () => Promise<unknown> }).documentRef = async () => {
      throw new Error('db down');
    };
    await run(realOcrEnvelope(), h);
    expect(scrapedOf().priceRangeMax).toBeUndefined();
  });

  it('an OCR date that lost is not written back through the row-date fallback', async () => {
    const h = makeDeps({
      stored: { openDate: '2026-09-10' },
      textReceipts: { 'ipos.openDate': ['2026-09-10'] },
    });
    const summary = await run(realOcrEnvelope(), h);
    expect(summary.skipped_lower_priority_source.join('\n')).toContain("ipos.openDate (OCR-only value '2026-09-09'");
    expect(scrapedOf().openDate).not.toBe('2026-09-09');
  });

  it('provenance confidence carries the OCR page confidence; a text read stays 100', async () => {
    const conf = (h: Harness, field: string) =>
      (h.trackFieldUpdate.mock.calls.map((c) => c[0] as { fieldName: string; confidence: number }).find((c) => c.fieldName === field))
        ?.confidence;
    // #1016: creditOfSharesDate (E-1) is never tracked at all now, so `lotMultiple` — the same
    // fixture's other OCR-marked ipo_details column (page 0, confidence 0.7456) — is the example.
    const ocr = makeDeps({});
    await run(realOcrEnvelope(), ocr);
    expect(conf(ocr, 'lotMultiple')).toBe(75);
    const text = makeDeps({});
    await run(asTextRead(realOcrEnvelope()), text);
    expect(conf(text, 'lotMultiple')).toBe(100);
  });
});

describe('OD-97 — the mark of a value built from several fields', () => {
  const env = (ocr: number[], fields: Record<string, { value: unknown; page?: number | null }>) => ({
    ocr_pages: ocr,
    fields,
  });
  it('OCR only when every contributing field sits on an OCR page', () => {
    expect(fieldsMark(env([0], { a: { value: 1, page: 0 }, b: { value: 2, page: 0 } }), ['a', 'b'])?.sourceText).toBe('OCR');
    expect(fieldsMark(env([0], { a: { value: 1, page: 0 }, b: { value: 2, page: 1 } }), ['a', 'b'])?.sourceText).toBe('MIXED');
    expect(fieldsMark(env([0], { a: { value: 1, page: null } }), ['a'])?.sourceText).toBe('MIXED');
    expect(fieldsMark(env([], { a: { value: 1, page: null } }), ['a'])?.sourceText).toBe('TEXT');
    expect(fieldsMark({ fields: { a: { value: 1, page: 0 } } }, ['a'])).toBeNull();
  });
  it('MIXED and unknown never lose', () => {
    const base = { incomingNormalized: '81', storedNormalized: '83', textValues: ['83'] };
    expect(ocrValueLoses({ ...base, incomingMark: { sourceText: 'MIXED', confidence: null } })).toBe(false);
    expect(ocrValueLoses({ ...base, incomingMark: null })).toBe(false);
    expect(ocrValueLoses({ ...base, incomingMark: { sourceText: 'OCR', confidence: 0.7 } })).toBe(true);
  });
});
