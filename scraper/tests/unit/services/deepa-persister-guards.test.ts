/**
 * W-16a / W-17 / W-18(i) — Deepa Jewellers per-IPO walk (2026-09-02).
 *
 * Both defects live on the UPDATE half of `upsertIPO`:
 *  - the "unreachable" legacy fallback wrote the raw incoming payload, so an
 *    NSE scrape (which carries no lead managers) nulled `lead_managers` and
 *    replaced `listing_exchanges` ['BSE'] with ['NSE'];
 *  - the post-consolidation re-track wrote `field_sources` rows attributing
 *    every kept value to THIS scrape's source with `previous_value = null`,
 *    which both erased provenance history (W-17) and mis-attributed a BSE
 *    value to NSE — after which the same-source short-circuit in
 *    `resolveConflict` silently dropped the real faceValue conflict (W-18(i)).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);
const consolidateIPODataMock = vi.fn();

// F-1: these mocks used to ENUMERATE their exports, so the moment another
// module started importing a symbol they did not list (S-01 made
// ipo-pipeline-steps-repository import `ipoStatusEnum`), the whole file failed
// to COLLECT — vitest reported "1 failed" while all five guards silently ran
// zero assertions. Spread the real module and override only what must be fake.
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

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: consolidateIPODataMock,
  })),
}));

const { upsertIPO, buildNonDestructiveUpdate } = await import('../../../src/services/data-persister.js');

const LEAD_MANAGERS = [
  'Emkay Global Financial Services Limited',
  'Valmiki Leela Capital Private Limited',
];

function existingDeepaRow() {
  return {
    id: 'deepa-id',
    slug: 'deepa-jewellers-limited',
    symbol: 'DEEPA',
    companyName: 'Deepa Jewellers Limited',
    segment: 'SME',
    offeringType: 'IPO',
    faceValue: 2,
    leadManagers: LEAD_MANAGERS,
    listingExchanges: ['BSE'],
    status: 'OPEN',
  } as any;
}

function nseScrape(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Deepa Jewellers Limited',
    listingExchange: 'NSE',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'OPEN',
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
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

describe('upsertIPO update path — Deepa walk guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('W-17/W-18(i): the consolidation path never re-writes field_sources itself', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 2,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      // Shape produced by the NO_INCOMING_VALUE branch when the field has no
      // provenance row: the value is the stored BSE one, but chosenSource
      // falls back to the incoming source.
      fieldResults: [
        { fieldName: 'faceValue', finalValue: 2, chosenSource: 'NSE', hadConflict: false },
        { fieldName: 'leadManagers', finalValue: LEAD_MANAGERS, chosenSource: 'NSE', hadConflict: false },
      ],
      consolidatedData: { faceValue: 2, leadManagers: LEAD_MANAGERS },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    expect(bulkTrackFieldUpdatesMock).not.toHaveBeenCalled();
  });

  it('W-16a: the fallback update never nulls a present value and merges listing exchanges', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('deepa-id');
    expect(patch.leadManagers ?? LEAD_MANAGERS).toEqual(LEAD_MANAGERS);
    expect(patch.listingExchanges).toEqual(['BSE', 'NSE']);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) {
        expect((existingDeepaRow() as any)[key] ?? null).toBeNull();
      }
    }
  });

  it('W-16a: the fallback still writes values the scrape actually carries', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      nseScrape({ symbol: 'DEEPA', status: 'CLOSED' }),
      'NSE',
      existingDeepaRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.symbol).toBe('DEEPA');
    expect(patch.status).toBe('CLOSED');
    expect(patch.lastScrapedAt).toBeInstanceOf(Date);
  });

  it('M-3: buildNonDestructiveUpdate drops an undefined key rather than passing it to the repository', () => {
    const patch = buildNonDestructiveUpdate(
      { leadManagers: LEAD_MANAGERS, registrar: 'Bigshare', symbol: 'DEEPA' },
      { leadManagers: undefined, registrar: null, symbol: 'DEEPA', status: 'CLOSED' }
    );

    expect(patch).not.toHaveProperty('leadManagers');
    expect(patch).not.toHaveProperty('registrar');
    expect(patch).toMatchObject({ symbol: 'DEEPA', status: 'CLOSED' });
  });

  it('M-3: the fallback patch carries no key for a field this scrape did not report', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('symbol');
    expect(patch).not.toHaveProperty('leadManagers');
  });

  // W-82 round 2: `cin` was validated by ScrapedIPOSchema and sent by the filing
  // persister, but `ipoData` never copied it in, so it reached neither the
  // consolidation write nor the non-destructive fallback. These assert the update
  // PAYLOAD actually carries `cin` on both write paths — not just that upsertIPO's
  // caller passed it in (that half was already covered by filing-persister.test.ts).
  const CIN = 'U74999TG2016PLC109435';

  it('W-82 round 2: the consolidation path carries cin through to the update payload', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 1,
      fieldsUpdated: 1,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [
        { fieldName: 'cin', finalValue: CIN, chosenSource: 'DRHP', hadConflict: false },
      ],
      consolidatedData: { cin: CIN },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape({ cin: CIN }), 'DRHP' as any, existingDeepaRow());

    expect(consolidateIPODataMock).toHaveBeenCalledWith(
      expect.objectContaining({ incomingData: expect.objectContaining({ cin: CIN }) })
    );
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.cin).toBe(CIN);
  });

  it('W-82 round 2: an absent cin is not written on the consolidation path', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 0,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [],
      consolidatedData: {},
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('cin');
  });

  it('W-82 round 2: the fallback path carries cin through to the update payload', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape({ cin: CIN }), 'NSE', existingDeepaRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.cin).toBe(CIN);
  });

  it('W-82 round 2: an absent cin is not written on the fallback path', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('cin');
  });
});
