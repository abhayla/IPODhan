/**
 * W-02 round 2: data-persister.ts's upsertIPO previously wrote
 * `faceValue: scrapedIPO.faceValue || 10` on create — a missing (or
 * fabricated-then-removed) face value from the scraper became a fabricated
 * 10 in the database on the write path itself, making the source-side fix
 * (round 1) ineffective on its own. A missing face value must stay
 * undefined so `ipos.face_value` (a nullable column) gets written NULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipoDemandGraph: {},
}));

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: bulkTrackFieldUpdatesMock,
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    RegistrarRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([]),
    })),
  };
});

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => false,
}));

vi.mock('../../../src/services/data-consolidation-service.js', () => ({
  DataConsolidationService: vi.fn(),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function makeScrapedIPO(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Deepa Jewellers Limited',
    issueSize: 27260000,
    priceRangeMin: 95,
    priceRangeMax: 99,
    openDate: '2026-08-19',
    closeDate: '2026-08-21',
    listingExchange: 'NSE',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'CLOSED',
    ...overrides,
  } as any;
}

function makeIpoRepository(createReturn: any) {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(createReturn),
    update: vi.fn(),
  } as any;
}

describe('upsertIPO faceValue (W-02 round 2 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('writes faceValue undefined (not 10) when the scraped IPO has no face value', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'deepa-jewellers-ltd' });
    await upsertIPO(ipoRepository, makeScrapedIPO(), 'NSE');
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.faceValue).toBeUndefined();
  });

  it('writes a genuine faceValue through untouched', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'deepa-jewellers-ltd' });
    await upsertIPO(ipoRepository, makeScrapedIPO({ faceValue: 2 }), 'BSE');
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.faceValue).toBe(2);
  });
});
