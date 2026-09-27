/**
 * #1229 (refs #70) - a cross-field date rule evaluated on a PARTIAL update.
 *
 * RCA: `sanitizeIpoWriteFields` (validators.ts) ran `sanitizeIpoDates` on the
 * consolidation result alone, which holds only THIS update's fields. The
 * T-309 presence rule ("a near-term listing_date with neither open_date nor
 * close_date is unconfirmable") then nulled a valid listing_date because the
 * STORED open/close were invisible to it.
 *
 * Real case (staging, read 2026-09-27): glass-wall-systems-india-ltd, stored
 * open 2026-09-08, close 2026-09-10, allotment 2026-09-11, listing_date NULL;
 * CHITTORGARH's 2026-09-16 listing date arrives alone and was refused every
 * cycle. It holds a listingDate field_sources row (CHITTORGARH), so the
 * #180 F2 first-touch guard does not apply.
 *
 * Runs the REAL `upsertIPO` update door; only repositories and the
 * consolidation service's return value are mocked (same harness as
 * data-persister-180-sme-fpo-hard-date.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const consolidateIPODataMock = vi.fn();
const resolveRegistrarIdMock = vi.fn().mockReturnValue(null);
const findByFieldMock = vi.fn().mockResolvedValue(null);
// Default: the row HAS some tracked provenance (just not for the field under
// test) — this is the F2 shape. Tests for the "zero provenance at all" case
// override this to [].
const findByIPOIdMock = vi.fn().mockResolvedValue([{ id: 'fs-other', fieldName: 'status', source: 'BSE' }]);

vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) =>
  await importOriginal<typeof import('@ipodhan/shared/db/schema')>()
);

vi.mock('@ipodhan/shared/utils/registrar-matcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/utils/registrar-matcher')>()),
  resolveRegistrarId: (...args: unknown[]) => resolveRegistrarIdMock(...args),
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: vi.fn().mockResolvedValue(1),
      findByField: (...args: unknown[]) => findByFieldMock(...args),
      findByIPOId: (...args: unknown[]) => findByIPOIdMock(...args),
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    RegistrarRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([]),
    })),
  };
});

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => true,
}));

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: consolidateIPODataMock,
  })),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ipo-180',
    slug: 'western-overseas-study-abroad-ltd',
    symbol: 'WOSA',
    companyName: 'Western Overseas Study Abroad Ltd',
    segment: 'SME',
    offeringType: 'FPO',
    openDate: null,
    closeDate: null,
    status: 'UPCOMING',
    listingExchanges: ['BSE'],
    ...overrides,
  } as any;
}

function scrape(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Western Overseas Study Abroad Ltd',
    listingExchange: 'BSE',
    status: 'UPCOMING',
    // offeringType deliberately OMITTED — the real shape of the 3 rows the
    // T-292C checker found (last_scraped_at Dec 2025, zero field_sources rows
    // for offeringType): a scrape that never reports offeringType at all.
    ...overrides,
  } as any;
}

function makeIpoRepository() {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    findByIdUncached: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

function consolidationResult(consolidatedData: Record<string, unknown>) {
  return {
    ipoId: 'ipo-180',
    fieldsProcessed: Object.keys(consolidatedData).length,
    fieldsUpdated: 0,
    conflictsDetected: 0,
    conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
    fieldResults: Object.entries(consolidatedData).map(([fieldName, finalValue]) => ({
      fieldName,
      finalValue,
      chosenSource: 'BSE',
      hadConflict: false,
    })),
    consolidatedData,
    errors: [],
    performanceMs: 1,
  };
}


function glassWallStored(overrides: Record<string, unknown> = {}) {
  return existingRow({
    id: 'ipo-glass-wall',
    slug: 'glass-wall-systems-india-ltd',
    symbol: 'GLASSWALL',
    companyName: 'Glass Wall Systems India Ltd',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'CLOSED',
    openDate: '2026-09-08',
    closeDate: '2026-09-10',
    allotmentDate: '2026-09-11',
    listingDate: null,
    listingExchanges: ['NSE'],
    ...overrides,
  });
}

function listingOnlyScrape(listingDate: string) {
  return {
    companyName: 'Glass Wall Systems India Ltd',
    status: 'CLOSED',
    listingDate,
  } as any;
}

describe('#1229: date rules run on the MERGED record (stored row + this update)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
    findByIPOIdMock.mockResolvedValue([{ id: 'fs-lst', fieldName: 'listingDate', source: 'CHITTORGARH' }]);
    findByFieldMock.mockResolvedValue({ id: 'fs-lst', fieldName: 'listingDate', source: 'CHITTORGARH' });
  });

  it('glass-wall: a listing-only update (2026-09-16) after stored open 09-08 / close 09-10 is WRITTEN, and nothing else is', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ listingDate: '2026-09-16' }));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, listingOnlyScrape('2026-09-16'), 'CHITTORGARH', glassWallStored());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('ipo-glass-wall');
    expect(patch.listingDate).toBe('2026-09-16');
    // Stored dates are context, never re-written as this source's new claims.
    expect(patch).not.toHaveProperty('openDate');
    expect(patch).not.toHaveProperty('closeDate');
    expect(patch).not.toHaveProperty('allotmentDate');
    expect(Object.keys(patch).sort()).toEqual(
      ['lastScrapedAt', 'listingDate', 'listingExchanges', 'updatedAt']
    );
  });

  it('a listing-only update that REALLY violates the merged record (2026-09-03, before stored open 09-08) is still nulled', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ listingDate: '2026-09-03' }));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, listingOnlyScrape('2026-09-03'), 'CHITTORGARH', glassWallStored());

    // Nulled -> equal to the stored NULL -> the no-op diff skips the row write.
    expect(ipoRepository.update).not.toHaveBeenCalled();
  });

  it('a close-only update after a stored open is written (close-after-open rule on the merged record)', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ closeDate: '2026-09-10' }));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      { companyName: 'Glass Wall Systems India Ltd', status: 'CLOSED', closeDate: '2026-09-10' } as any,
      'NSE',
      glassWallStored({ closeDate: null, allotmentDate: null })
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.closeDate).toBe('2026-09-10');
    expect(patch).not.toHaveProperty('openDate');
  });

  it('a close-only update BEFORE the stored open (merged open > close) is nulled, and the stored open is not touched', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ closeDate: '2026-09-05' }));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      { companyName: 'Glass Wall Systems India Ltd', status: 'CLOSED', closeDate: '2026-09-05' } as any,
      'NSE',
      glassWallStored({ closeDate: null, allotmentDate: null })
    );

    expect(ipoRepository.update).not.toHaveBeenCalled();
  });
});
