/**
 * T-293F — insert-path coverage for `upsertIPO`'s fuzzy (typo) duplicate
 * check, and the defensive fallback that keeps a fuzzy-check failure from
 * ever blocking a create.
 *
 * This is the hole the T-293C checker found: the pure similarity helper
 * (`company-name-similarity.test.ts`) covers the matching MATH, but nothing
 * exercised `upsertIPO` itself calling `findByFuzzyName` on the create path —
 * which is exactly how the missing mock entry in
 * `data-persister-create-lineage.test.ts` (T-292) slipped through undetected.
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
  // T-307: keep the REAL resolveIpoRow — the tests below assert on
  // upsertIPO's identity-resolution behaviour (findByFuzzyName call counts,
  // create-vs-update), so a hand-copied mock would defeat the point.
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

// T-339: the legacy fallback-update path this file used to lean on
// (ENABLE_DATA_CONSOLIDATION: false) no longer exists — consolidation is the
// only update path. These tests are about IDENTITY resolution (which row did
// the write target?), not about merge semantics, so the consolidation service
// is stubbed to a pass-through that returns the incoming data unchanged.
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: { DEBUG_DATA_FLOW: false },
  shouldUseFeature: () => false,
}));

vi.mock('../../../src/services/data-consolidation-service.js', () => ({
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: vi.fn(async (input: any) => ({
      ipoId: input.ipoId,
      fieldsProcessed: Object.keys(input.incomingData).length,
      fieldsUpdated: Object.keys(input.incomingData).length,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      // Every incoming field carries a decision record, so the T-339
      // write-path guard is satisfied on the honest path.
      fieldResults: Object.keys(input.incomingData).map((fieldName) => ({ fieldName })),
      consolidatedData: { ...input.incomingData },
      errors: [],
      performanceMs: 1,
    })),
  })),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function makeScrapedIPO(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Dhanwel Hybird Seeds Limited',
    issueSize: 5000000,
    priceRangeMin: 100,
    priceRangeMax: 110,
    openDate: '2026-08-19',
    closeDate: '2026-08-21',
    listingExchange: 'BSE',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'CLOSED',
    ...overrides,
  } as any;
}

function makeIpoRepository(overrides: Record<string, any> = {}) {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'new-ipo-id', slug: 'dhanwel-hybird-seeds-limited' }),
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe('upsertIPO — fuzzy (typo) duplicate check on create (T-293)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('(a) catches a Dhanwel-typo-shape duplicate via the fuzzy tier and updates, not creates', async () => {
    const existingIPO = {
      id: 'existing-dhanwel-id',
      slug: 'dhanwel-hybrid-seeds-ltd',
      companyName: 'Dhanwel Hybrid Seeds Ltd.',
      segment: 'SME',
      offeringType: 'IPO',
      listingExchanges: ['BSE'],
      allotmentDate: null,
      listingDate: null,
    };
    const ipoRepository = makeIpoRepository({
      findByFuzzyName: vi.fn().mockResolvedValue(existingIPO),
    });

    const resultId = await upsertIPO(ipoRepository, makeScrapedIPO(), 'BSE');

    expect(ipoRepository.findByFuzzyName).toHaveBeenCalledTimes(1);
    expect(ipoRepository.create).not.toHaveBeenCalled();
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update.mock.calls[0][0]).toBe('existing-dhanwel-id');
    expect(resultId).toBe('existing-dhanwel-id');
  });

  it('(a-negative) does not merge two genuinely distinct companies sharing a first word', async () => {
    // Guards against the fuzzy tier being too eager — Sun/Sunrise-shape
    // insertions must still create a new row (design already proven at the
    // helper level in company-name-similarity.test.ts; this proves upsertIPO
    // still creates when the repository correctly reports no fuzzy match).
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      makeScrapedIPO({ companyName: 'Sunrise Pharmaceutical Industries Ltd.' }),
      'BSE'
    );

    expect(ipoRepository.findByFuzzyName).toHaveBeenCalledTimes(1);
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update).not.toHaveBeenCalled();
  });

  it('(b) a findByFuzzyName SQL failure is non-fatal — the create still succeeds', async () => {
    const ipoRepository = makeIpoRepository({
      findByFuzzyName: vi.fn().mockRejectedValue(new Error('DatabaseError: connection reset')),
    });

    const resultId = await upsertIPO(ipoRepository, makeScrapedIPO(), 'BSE');

    expect(ipoRepository.findByFuzzyName).toHaveBeenCalledTimes(1);
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update).not.toHaveBeenCalled();
    expect(resultId).toBe('new-ipo-id');
  });
});
