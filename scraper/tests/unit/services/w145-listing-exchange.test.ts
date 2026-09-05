/**
 * W-145 — `listingExchanges` as a first-class, source-ranked field.
 *
 * Prod shapes this locks (2026-09-05): SME 107 BSE / 60 NSE / 5 wrongly "both";
 * mainboard 74 both / 63 BSE / 5 NSE. The 5 wrong SME rows came from three
 * sources hard-coding `listingExchange: 'BOTH'` plus a key mismatch
 * (`listingExchange` incoming vs `listingExchanges` stored) that kept the field
 * out of the priority matrix entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import {
  toListingExchangesForSource,
  violatesSmeSingleExchange,
  SME_SINGLE_EXCHANGE_CONFLICT_REASON,
} from '../../../src/services/listing-exchange-resolution.js';
import { getFieldRules, getSourcePriority } from '../../../src/config/field-priority-matrix.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
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

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: 'w145', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

describe('W-145 boundary mapping (toListingExchangesForSource)', () => {
  it('NSE and BSE may assert ONLY themselves — even when the payload says BOTH', () => {
    expect(toListingExchangesForSource('BOTH', 'NSE')).toEqual(['NSE']);
    expect(toListingExchangesForSource('BOTH', 'BSE')).toEqual(['BSE']);
    expect(toListingExchangesForSource('BSE', 'NSE')).toEqual(['NSE']);
    expect(toListingExchangesForSource(undefined, 'BSE')).toEqual(['BSE']);
  });

  it('a page-stating source may report BOTH; an aggregator may not', () => {
    expect(toListingExchangesForSource('BOTH', 'CHITTORGARH')).toEqual(['NSE', 'BSE']);
    expect(toListingExchangesForSource('BOTH', 'MONEYCONTROL')).toBeUndefined();
    expect(toListingExchangesForSource('BOTH', 'API_FALLBACK')).toBeUndefined();
  });

  it('a bottom source may still ADD the one board it names', () => {
    expect(toListingExchangesForSource('BSE', 'MONEYCONTROL')).toEqual(['BSE']);
    expect(toListingExchangesForSource('NSE', 'API_FALLBACK')).toEqual(['NSE']);
  });

  it('unknown stays unknown — never a guessed pair', () => {
    expect(toListingExchangesForSource(undefined, 'MONEYCONTROL')).toBeUndefined();
    expect(toListingExchangesForSource(undefined, 'CHITTORGARH')).toBeUndefined();
  });
});

describe('W-145 matrix entry', () => {
  it('listingExchanges is ranked (not the DEFAULT fallback rule) with exchanges above the aggregators', () => {
    const rules = getFieldRules('listingExchanges');
    expect(rules.description).not.toMatch(/Default rules/);
    expect(getSourcePriority('listingExchanges', 'NSE')).toBeLessThan(
      getSourcePriority('listingExchanges', 'CHITTORGARH')
    );
    expect(getSourcePriority('listingExchanges', 'CHITTORGARH')).toBeLessThan(
      getSourcePriority('listingExchanges', 'MONEYCONTROL')
    );
    // API_FALLBACK is the WORST listed source, so outranksUntrackedValue()
    // denies it a silent replacement of an untracked stored value.
    expect(getSourcePriority('listingExchanges', 'API_FALLBACK')).toBe(rules.sources.length - 1);
  });
});

describe('W-145 SME invariant helper', () => {
  it('fires only for SME rows with more than one exchange', () => {
    expect(violatesSmeSingleExchange('SME', ['NSE', 'BSE'])).toBe(true);
    expect(violatesSmeSingleExchange('SME', ['BSE'])).toBe(false);
    expect(violatesSmeSingleExchange('MAINBOARD', ['NSE', 'BSE'])).toBe(false);
    expect(violatesSmeSingleExchange(null, ['NSE', 'BSE'])).toBe(false);
  });
});

describe('W-145 consolidation of listingExchanges', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('union rule: a mainboard row stored as ["BSE"] gains NSE from an NSE self-assertion', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'w145',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource('BOTH', 'NSE') },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'], segment: 'MAINBOARD' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    expect(result.conflictsDetected).toBe(0);
  });

  it('a lower source cannot overwrite a stored board — an unknown value is dropped at the boundary', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    // What moneycontrol-scraper now emits for an issue whose board it cannot see.
    const incoming = toListingExchangesForSource(undefined, 'MONEYCONTROL');
    expect(incoming).toBeUndefined();

    const result = await service.consolidateIPOData({
      ipoId: 'w145',
      tableName: 'ipos',
      incomingData: { listingExchanges: incoming },
      source: 'MONEYCONTROL',
      existingData: { listingExchanges: ['BSE'], segment: 'SME' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
  });

  it('SME invariant: a second exchange becomes a CRITICAL conflict row, not a write', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'w145',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, 'NSE') },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'], segment: 'SME' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
    expect(result.conflictsDetected).toBe(1);
    expect(result.fieldResults.find((f) => f.fieldName === 'listingExchanges')?.conflictReason).toBe(
      SME_SINGLE_EXCHANGE_CONFLICT_REASON
    );
    const conflictRow = vi.mocked(mockConflictsRepo.upsertConflict as any).mock.calls.at(-1)?.[0];
    expect(conflictRow).toMatchObject({
      fieldName: 'listingExchanges',
      resolutionReason: SME_SINGLE_EXCHANGE_CONFLICT_REASON,
      severity: 'CRITICAL',
    });
  });

  it('the same widening on a MAINBOARD row is a plain union, no conflict', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'w145',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, 'NSE') },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'], segment: 'MAINBOARD' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    expect(result.conflictsDetected).toBe(0);
  });
});

describe('W-145: the three sources that hard-coded BOTH now report unknown', () => {
  it('description-backfill emits no listing exchange', async () => {
    const { buildDescriptionScrapedIPO } = await import(
      '../../../src/services/description-backfill.js'
    );
    const scraped = buildDescriptionScrapedIPO(
      {
        companyName: 'Acme Industries Limited',
        issueSize: 1000,
        segment: 'SME',
        offeringType: 'IPO',
        status: 'LISTED',
      } as any,
      'A long enough company description to pass the plausibility floor.'
    );
    expect(scraped.listingExchange).toBeUndefined();
  });

  it('historical-ipo-assembler emits no listing exchange', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { assembleHistoricalRecord } = await import(
      '../../../src/services/historical-ipo-assembler.js'
    );
    const FX = path.join(process.cwd(), 'tests', 'fixtures', 'historical');
    const reportRow = JSON.parse(
      fs.readFileSync(path.join(FX, 'ather-cg-report118.json'), 'utf-8')
    );
    const detailHtml = fs.readFileSync(path.join(FX, 'ather-cg-detail.html'), 'utf-8');

    const { scraped } = assembleHistoricalRecord({ reportRow, detailHtml });
    expect(scraped.listingExchange).toBeUndefined();
  });

  it('no scraper source hard-codes a BOTH listing exchange any more', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const roots = [path.join(process.cwd(), 'src', 'scrapers'), path.join(process.cwd(), 'src', 'services')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of fs.readdirSync(root)) {
        if (!file.endsWith('.ts')) continue;
        // The rules module itself quotes the dead pattern in its docstring.
        if (file === 'listing-exchange-resolution.ts') continue;
        const text = fs.readFileSync(path.join(root, file), 'utf-8');
        if (/listingExchange:\s*'BOTH'/.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
