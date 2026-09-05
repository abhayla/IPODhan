/**
 * W-177 — issueSize plausibility guard on the CREATE and legacy-fallback
 * UPDATE write doors of `upsertIPO`.
 *
 * Root cause: the T-329 segment-floor / shares-x-band plausibility check
 * (`collectImplausibleIssueSizeFields`, data-consolidation-service.ts) was
 * wired only into `consolidateIPOData` (the UPDATE-via-consolidation path).
 * A fresh row created straight from a source's raw share count (CHITTORGARH
 * is the SME matrix winner) skipped the check entirely — prod shape:
 * shanti-inorganics-ltd (issueSize 5,691,200, SME, band 79-83) and
 * ashutosh-fibre-ltd (issueSize 6,124,800, SME, band 87-92), both holding
 * the SHARE COUNT in the rupee issueSize column (~80x low).
 *
 * These tests exercise the SAME `collectImplausibleIssueSizeFields` helper
 * now also invoked at the top of `upsertIPO`, before `ipoData.issueSize` is
 * built — so both the create door and the legacy-fallback update door (which
 * share that single `ipoData` object) are covered by one guard site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);
const consolidateIPODataMock = vi.fn();
const warnMock = vi.fn();

function issueSizeWarnCalls() {
  return warnMock.mock.calls.filter(([, message]) => typeof message === 'string' && message.includes('IssueSizePlausibility'));
}

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() },
}));

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

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => true,
}));

// Keep the REAL collectImplausibleIssueSizeFields / floor constants — only
// the class (consolidateIPOData) is faked, per the deepa-persister-guards
// pattern, so the guard under test runs unmocked.
vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: consolidateIPODataMock,
  })),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function makeIpoRepository() {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'new-ipo-id', slug: 'shanti-inorganics-ltd' }),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

function shantiInorganicsScrape(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Shanti Inorganics Ltd.',
    // The bug shape: SHARE COUNT sitting in the issueSize field.
    issueSize: 5_691_200,
    priceRangeMin: 79,
    priceRangeMax: 83,
    sharesOffered: 68_570,
    segment: 'SME',
    offeringType: 'IPO',
    status: 'OPEN',
    listingExchange: 'BSE',
    ...overrides,
  } as any;
}

function existingSmeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'shanti-id',
    slug: 'shanti-inorganics-ltd',
    companyName: 'Shanti Inorganics Ltd.',
    segment: 'SME',
    offeringType: 'IPO',
    priceRangeMin: 79,
    priceRangeMax: 83,
    listingExchanges: ['BSE'],
    status: 'OPEN',
    ...overrides,
  } as any;
}

describe('upsertIPO — W-177 issueSize plausibility guard (create + legacy-fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('(a) create path: rejects a share-count issueSize below the SME floor — writes undefined, logs a WARN', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, shantiInorganicsScrape(), 'CHITTORGARH');

    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.issueSize).toBeUndefined();

    const calls = issueSizeWarnCalls();
    expect(calls).toHaveLength(1);
    const [payload, message] = calls[0];
    expect(message).toContain('IssueSizePlausibility');
    expect(payload.path).toBe('create');
    expect(payload.rejectedIssueSize).toBe(5_691_200);
    expect(payload.source).toBe('CHITTORGARH');
    expect(payload.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });

  it('(b) legacy-fallback update path: same share-count value is rejected, never written, WARN logged', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, shantiInorganicsScrape(), 'CHITTORGARH', existingSmeRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('shanti-id');
    expect(patch.issueSize).toBeUndefined();

    const calls = issueSizeWarnCalls();
    expect(calls).toHaveLength(1);
    const [payload] = calls[0];
    expect(payload.path).toBe('legacy-fallback-update');
    expect(payload.ipoId).toBe('shanti-id');
    expect(payload.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });

  it('(c) a plausible SME value (Rs 47.2 Cr) is written unchanged on create — no WARN', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      shantiInorganicsScrape({ issueSize: 47_20_00_000, sharesOffered: undefined }),
      'CHITTORGARH'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.issueSize).toBe('472000000');
    expect(issueSizeWarnCalls()).toHaveLength(0);
  });

  it('(d) MAINBOARD floor: a value below Rs10 Cr is rejected on create', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      shantiInorganicsScrape({
        companyName: 'Acme Mainboard Ltd.',
        segment: 'MAINBOARD',
        issueSize: 8_00_00_000, // Rs8 Cr — below the Rs10 Cr mainboard floor
        priceRangeMin: 100,
        priceRangeMax: 110,
        sharesOffered: undefined,
      }),
      'CHITTORGARH'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.issueSize).toBeUndefined();
    const calls = issueSizeWarnCalls();
    expect(calls).toHaveLength(1);
    const [payload] = calls[0];
    expect(payload.segment).toBe('MAINBOARD');
    expect(payload.segmentFloor).toBe(10_00_00_000);
  });

  it('never widens the floor for a source exempt from the shares-x-band check (DRHP) — segment floor still applies', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, shantiInorganicsScrape({ sharesOffered: undefined }), 'DRHP');

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.issueSize).toBeUndefined();
    expect(issueSizeWarnCalls()).toHaveLength(1);
  });
});
