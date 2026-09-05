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
  resolveConflict: vi.fn(),
} as unknown as DataConflictsRepository;

function fieldSourceRow(fieldName: string, source: string, value: any, updatedAt = '2026-09-01T00:00:00Z') {
  return {
    ipoId: 'w145', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date(updatedAt), createdAt: new Date(updatedAt),
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

describe('W-145 round 2: evidence-based collapse of an SME row already stored with two exchanges', () => {
  let service: DataConsolidationService;
  const listingRepo = { findByIPO: vi.fn() };

  function makeService() {
    return new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listingRepo.findByIPO.mockResolvedValue(null);
    service = makeService();
  });

  async function run(opts: { sources?: any[]; source?: any; segment?: string } = {}) {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(opts.sources ?? []);
    return service.consolidateIPOData({
      ipoId: 'w145-sme',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, opts.source ?? 'BSE') },
      source: opts.source ?? 'BSE',
      existingData: {
        listingExchanges: ['NSE', 'BSE'],
        segment: opts.segment ?? 'SME',
      } as any,
    });
  }

  it('tier 1 — a listing record for one exchange wins', async () => {
    listingRepo.findByIPO.mockResolvedValue({ exchange: 'NSE' });
    // Provenance points the other way; the listing record still decides.
    const result = await run({
      sources: [fieldSourceRow('listingExchanges', 'BSE', ['BSE'])],
      source: 'BSE',
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
    expect(result.conflictsDetected).toBe(0);
  });

  it('tier 1 — a BOTH listing record is not evidence, so the weaker tiers decide', async () => {
    listingRepo.findByIPO.mockResolvedValue({ exchange: 'BOTH' });
    const result = await run({
      sources: [fieldSourceRow('listingExchanges', 'BSE', ['BSE'])],
      source: 'BSE',
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
  });

  it('tier 2 — provenance from exactly one exchange scraper decides', async () => {
    const result = await run({
      sources: [fieldSourceRow('listingExchanges', 'NSE', ['NSE'])],
      source: 'BSE',
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
  });

  it('tier 2 — provenance from BOTH exchanges is not evidence; tier 3 (this run) decides', async () => {
    const result = await run({
      sources: [
        fieldSourceRow('listingExchanges', 'NSE', ['NSE']),
        fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
      ],
      source: 'BSE',
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
  });

  it('tier 3 — the self-asserting exchange of this run', async () => {
    const result = await run({ source: 'NSE' });
    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
  });

  it('no evidence — the pair is kept AND a CRITICAL conflict row is written', async () => {
    // CHITTORGARH names a board (so the field is actually consolidated) but is
    // not self-asserting, so tier 3 gives nothing either.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
    const result = await service.consolidateIPOData({
      ipoId: 'w145-sme',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource('BSE', 'CHITTORGARH') },
      source: 'CHITTORGARH',
      existingData: { listingExchanges: ['NSE', 'BSE'], segment: 'SME' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE', 'BSE']);
    expect(result.conflictsDetected).toBe(1);
    const conflictRow = vi.mocked(mockConflictsRepo.upsertConflict as any).mock.calls.at(-1)?.[0];
    expect(conflictRow).toMatchObject({
      fieldName: 'listingExchanges',
      resolutionReason: SME_SINGLE_EXCHANGE_CONFLICT_REASON,
      severity: 'CRITICAL',
    });
  });

  it('a MAINBOARD row stored with both exchanges is never collapsed', async () => {
    listingRepo.findByIPO.mockResolvedValue({ exchange: 'NSE' });
    const result = await run({ segment: 'MAINBOARD', source: 'NSE' });

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE', 'BSE']);
    expect(result.conflictsDetected).toBe(0);
  });
});

describe('W-145 round 3: tier-2 evidence quality, conflict cleanup, missing repo', () => {
  const listingRepo = { findByIPO: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    listingRepo.findByIPO.mockResolvedValue(null);
  });

  function run(service: DataConsolidationService, sources: any[], source: any = 'BSE', segment = 'SME') {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(sources);
    return service.consolidateIPOData({
      ipoId: 'w145-sme',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, source) },
      source,
      existingData: { listingExchanges: ['NSE', 'BSE'], segment } as any,
    });
  }

  it('a provenance row whose VALUE does not name its own exchange is not evidence', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
    // An NSE-written row that still holds the wrong PAIR proves nothing; the
    // alphabetic symbol lives in both namespaces, so it proves nothing either.
    const result = await run(
      service,
      [
        fieldSourceRow('listingExchanges', 'NSE', ['NSE', 'BSE']),
        fieldSourceRow('symbol', 'NSE', 'ACME'),
      ],
      'BSE'
    );

    // Falls through to tier 3 — this run's own self-assertion.
    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
  });

  it('a STALE contradicting row does not outvote the freshest evidenced row', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
    const result = await run(
      service,
      [
        fieldSourceRow('listingExchanges', 'NSE', ['NSE'], '2026-01-01T00:00:00Z'),
        fieldSourceRow('listingExchanges', 'BSE', ['BSE'], '2026-09-01T00:00:00Z'),
      ],
      'NSE'
    );

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
  });

  it('the collapse RESOLVES the earlier CRITICAL invariant conflict row', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO as any).mockResolvedValue([
      {
        id: 'conflict-1',
        tableName: 'ipos',
        fieldName: 'listingExchanges',
        resolutionReason: SME_SINGLE_EXCHANGE_CONFLICT_REASON,
      },
    ]);

    const result = await run(service, [fieldSourceRow('listingExchanges', 'NSE', ['NSE'])], 'BSE');

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith('conflict-1', {
      resolvedSource: 'NSE',
      resolutionReason: 'SME_COLLAPSE_FIELD_SOURCE_PROVENANCE',
      resolvedBy: 'SYSTEM',
    });
  });

  it('without a listing repository the weaker tiers still collapse the row', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    const result = await run(service, [], 'NSE');

    expect(listingRepo.findByIPO).not.toHaveBeenCalled();
    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
  });

  it('idempotent: a collapsed row stays single on the next cycle', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'w145-sme',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, 'BSE') },
      source: 'BSE',
      existingData: { listingExchanges: ['BSE'], segment: 'SME' } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE']);
    expect(result.conflictsDetected).toBe(0);
  });

  it('a row with a NULL segment is not an SME row — the pair is left alone', async () => {
    const service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo, listingRepo);
    listingRepo.findByIPO.mockResolvedValue({ exchange: 'NSE' });
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'w145-sme',
      tableName: 'ipos',
      incomingData: { listingExchanges: toListingExchangesForSource(undefined, 'NSE') },
      source: 'NSE',
      existingData: { listingExchanges: ['NSE', 'BSE'], segment: null } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['NSE', 'BSE']);
    expect(listingRepo.findByIPO).not.toHaveBeenCalled();
  });
});
