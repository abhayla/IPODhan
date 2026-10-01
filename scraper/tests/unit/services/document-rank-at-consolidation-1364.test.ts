/**
 * #1364: between two offer documents, consolidation ranks by DOCUMENT TYPE and FILING DATE, never by
 * write time.
 *
 * Spec basis: data-sourcing-pull-model.md §1 "Document type order inside rank 1": price-dependent
 * fields `PRICE_BAND_AD / CORRIGENDUM > RHP > PROSPECTUS > DRHP`; final post-issue facts
 * `PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP`; "an older draft can never overwrite a final
 * advertisement". OD-30: within one document type the later filing date wins.
 *
 * Class: every `ipos` field written from a document (source DRHP) where two documents both state it and
 * the lower-ranked or older-filed one is extracted later. The defect: `upsertIPO` passes the filing
 * lineage (which names the docType) but not `docType`, so `incomingDocumentOutranksStored` got
 * `incomingDocType: undefined` and the newest write won.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';
import {
  compareDocumentsForField,
  PRICE_DEPENDENT_ORDER,
  FINAL_POST_ISSUE_ORDER,
} from '../../../config/document-field-order.mjs';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 100,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

const fieldSources = { findByIPOId: vi.fn(), trackFieldUpdate: vi.fn(), findByField: vi.fn() } as unknown as FieldSourcesRepository;
const conflicts = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

function storedDoc(fieldName: string, value: string, docType: string, documentId: string) {
  const at = new Date('2026-09-02T00:00:00Z');
  return {
    ipoId: 'ipo-1364', tableName: 'ipos', fieldName, source: 'DRHP', value, confidence: 95,
    dataLineage: { method: 'FILING_EXTRACTION', docType, documentId },
    previousValue: null, previousSource: null, updatedAt: at, createdAt: at,
  };
}

/** Exactly what `upsertIPO` builds: lineage names the document, `docType` is NOT passed. */
function fromUpsert(field: string, value: unknown, docType: string, documentId: string, filed?: Record<string, string | null>) {
  return {
    ipoId: 'ipo-1364',
    tableName: 'ipos',
    incomingData: { [field]: value },
    source: 'DRHP' as const,
    incomingLineage: { method: 'FILING_EXTRACTION', docType, documentId },
    ...(filed ? { documentFilingDates: async (ids: string[]) => new Map(ids.map((id) => [id, filed[id] ?? null])) } : {}),
    confidence: 100,
    scrapedAt: new Date('2026-09-06T00:00:00Z'), // always written LATER than the stored row
  };
}

let service: DataConsolidationService;
beforeEach(() => {
  vi.clearAllMocks();
  service = new DataConsolidationService(fieldSources, conflicts);
});

describe('#1364: the upsertIPO path ranks documents by type, not write time', () => {
  it('price field: an RHP extracted after the price band ad does not replace the ad band', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('priceRangeMax', '112', 'PRICE_BAND_AD', 'ad-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('priceRangeMax', 105, 'RHP', 'rhp-1') as never);
    expect(Number(r.consolidatedData.priceRangeMax)).toBe(112);
  });

  it('price field: a price band ad extracted after the RHP does replace the RHP band (control)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('priceRangeMax', '105', 'RHP', 'rhp-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('priceRangeMax', 112, 'PRICE_BAND_AD', 'ad-1') as never);
    expect(Number(r.consolidatedData.priceRangeMax)).toBe(112);
  });

  it('OD-30: an older-FILED RHP extracted later does not replace a newer-filed RHP', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('lotSize', '150', 'RHP', 'rhp-new')] as never);
    const r = await service.consolidateIPOData(
      fromUpsert('lotSize', 120, 'RHP', 'rhp-old', { 'rhp-new': '2026-09-10', 'rhp-old': '2026-08-20' }) as never
    );
    expect(Number(r.consolidatedData.lotSize)).toBe(150);
  });

  it('OD-30: a newer-filed RHP does replace an older-filed one (control)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('lotSize', '120', 'RHP', 'rhp-old')] as never);
    const r = await service.consolidateIPOData(
      fromUpsert('lotSize', 150, 'RHP', 'rhp-new', { 'rhp-new': '2026-09-10', 'rhp-old': '2026-08-20' }) as never
    );
    expect(Number(r.consolidatedData.lotSize)).toBe(150);
  });

  it('a DRHP extracted after the RHP never replaces it, for a non-price field (both orders agree)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('registrar', 'KFin Technologies', 'RHP', 'rhp-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('registrar', 'Bigshare Services', 'DRHP', 'drhp-1') as never);
    expect(r.consolidatedData.registrar).toBe('KFin Technologies');
  });

  it('OD-154: a non-price field stored from an RHP IS replaced by a disagreeing PROSPECTUS value (post-issue order)', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('registrar', 'KFin Technologies', 'RHP', 'rhp-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('registrar', 'Bigshare Services', 'PROSPECTUS', 'pro-1') as never);
    expect(r.consolidatedData.registrar).toBe('Bigshare Services');
  });

  it('OD-154: a non-price field stored from a PROSPECTUS is kept against a later RHP value', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('registrar', 'KFin Technologies', 'PROSPECTUS', 'pro-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('registrar', 'Bigshare Services', 'RHP', 'rhp-1') as never);
    expect(r.consolidatedData.registrar).toBe('KFin Technologies');
  });

  it('OD-154: a price field keeps PRICE_BAND_AD first even against a PROSPECTUS value', async () => {
    vi.mocked(fieldSources.findByIPOId).mockResolvedValue([storedDoc('priceRangeMax', '112', 'PRICE_BAND_AD', 'ad-1')] as never);
    const r = await service.consolidateIPOData(fromUpsert('priceRangeMax', 105, 'PROSPECTUS', 'pro-1') as never);
    expect(Number(r.consolidatedData.priceRangeMax)).toBe(112);
  });
});

describe('#1364: compareDocumentsForField, the one comparator', () => {
  it('the post-issue order is the PRECEDENCE table restricted to the offer documents', () => {
    const byRank = (o: Record<string, number>) => Object.keys(o).sort((a, b) => o[b] - o[a]);
    expect(byRank(FINAL_POST_ISSUE_ORDER)).toEqual(['PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD', 'RHP', 'DRHP']);
    expect(PRICE_DEPENDENT_ORDER.PRICE_BAND_AD).toBe(PRICE_DEPENDENT_ORDER.CORRIGENDUM);
    expect(byRank(PRICE_DEPENDENT_ORDER).slice(2)).toEqual(['RHP', 'PROSPECTUS', 'DRHP']);
  });

  it.each([
    // [order, stored, incoming, expected]
    ['PRICE', { docType: 'PRICE_BAND_AD' }, { docType: 'PROSPECTUS' }, false],
    ['PRICE', { docType: 'RHP' }, { docType: 'PRICE_BAND_AD' }, true],
    ['POST_ISSUE', { docType: 'RHP' }, { docType: 'PROSPECTUS' }, true],
    ['POST_ISSUE', { docType: 'DRHP' }, { docType: 'RHP' }, true],
    ['POST_ISSUE', { docType: 'RHP', filingDate: '2026-09-01' }, { docType: 'RHP', filingDate: '2026-09-02' }, true],
    ['PRICE', { docType: 'RHP', filingDate: '2026-09-02' }, { docType: 'RHP', filingDate: '2026-09-01' }, false],
    ['PRICE', { docType: 'RHP', filingDate: null }, { docType: 'RHP', filingDate: '2026-09-01' }, null],
    ['PRICE', { docType: 'RHP', documentId: 'd' }, { docType: 'RHP', documentId: 'd' }, null],
    ['PRICE', { docType: 'SOMETHING_NEW' }, { docType: 'RHP' }, null],
    ['PRICE', { docType: undefined }, { docType: 'RHP' }, null],
  ] as const)('%s %o -> %o = %s', (order, stored, incoming, expected) => {
    expect(compareDocumentsForField(stored as never, incoming as never, order).outranks).toBe(expected);
  });
});
