/**
 * OD-68 on the scraper's write path: slug computation and the held-create retry rule.
 * Mocks copied from data-persister-ofs-identity-guard.test.ts (real resolveIpoRow kept).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/db/schema')>()),
  ipoDemandGraph: {},
}));

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  // Keep the REAL resolveIpoRow (and its real OFS/IPO identity guard) — a
  // hand-copied mock would defeat the entire point of this test.
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

// Legacy fallback-update path (ENABLE_DATA_CONSOLIDATION: false) is the
// simplest way to observe "existingIPO was found -> update, not create"
// without also mocking the full consolidation service.
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: false,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => false,
}));

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn(),
}));

const { computeIpoIdentitySlug, upsertIPO } = await import('../../../src/services/data-persister.js');
const { IdentityHeldForReviewError } = await import('@ipodhan/shared/repositories');

describe('OD-68: the slug a new row gets is computed from the name with its decoration stripped', () => {
  it('"Rays of Belief Ltd. O" (the 2026-09-01 aggregator shape) gets rays-of-belief-ltd, never -o', () => {
    expect(computeIpoIdentitySlug({ companyName: 'Rays of Belief Ltd. O' })).toBe('rays-of-belief-ltd');
  });

  it('page-title text never reaches the slug', () => {
    expect(computeIpoIdentitySlug({ companyName: "Purple Style Labs Ltd - Pernia's Pop-Up Studio IPO" })).toBe('purple-style-labs-ltd');
  });

  it('an explicit OFS slug keeps its -ofs-<year> identity suffix', () => {
    expect(
      computeIpoIdentitySlug({ companyName: 'Cochin Shipyard Ltd', offeringType: 'OFS', offeringTypeExplicit: true, openDate: '2026-03-10' })
    ).toBe('cochin-shipyard-ltd-ofs-2026');
  });
});

describe('OD-68: a held create is a decision, not a transient failure', () => {
  it('upsertIPO does not retry a create the repository held for review, and creates nothing', async () => {
    const held = new IdentityHeldForReviewError('held', { companyName: 'X', slug: 'x', openDate: null, priceRangeMin: null }, []);
    const ipoRepository = {
      findByIsin: vi.fn().mockResolvedValue(null),
      findBySymbol: vi.fn().mockResolvedValue(null),
      findByNormalizedName: vi.fn().mockResolvedValue(null),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
      findBySlug: vi.fn().mockResolvedValue(null),
      findByFuzzyName: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(held),
      update: vi.fn(),
    } as any;
    await expect(
      upsertIPO(ipoRepository, { companyName: 'Rays of Belief Ltd.', segment: 'MAINBOARD', openDate: '2026-09-15' } as any, 'CHITTORGARH' as any)
    ).rejects.toBeInstanceOf(IdentityHeldForReviewError);
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
  });
});
