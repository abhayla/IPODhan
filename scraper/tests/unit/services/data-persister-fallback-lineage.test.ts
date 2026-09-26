/**
 * #454 — the fallback door (data-persister.ts's `upsertIPO`, taken when
 * consolidation is disabled or throws) writes `ipos` fields via
 * `ipoRepository.update` but recorded NO `field_sources` provenance rows,
 * even though its own ledger claimed `fieldSourcesWritten: false` (honestly
 * — but the class this test guards is that the door wrote published values
 * with NO lineage at all, not just that the ledger under-reported).
 *
 * Spec basis: docs/design/data-sourcing-pull-model.md §1 (`field_sources` is
 * how "which source said so" is tracked for every `ipos` field) and OD-58's
 * ENABLE_SOURCE_TRACKING-gated provenance-per-write requirement — the same
 * requirement the create path already satisfies (P3-11, T-292) and
 * `recordDiscoveredLeadManagers` already satisfies (source: BSE/NSE upsert).
 * The fallback UPDATE path is the last write door with the gap.
 *
 * Class: every `ipos` field the fallback door actually writes (every source,
 * every status/segment, on both prod and staging) — reuses the SAME
 * `bulkTrackFieldUpdates` / row_key '' shape as the create path and
 * `recordDiscoveredLeadManagers`, not a bespoke write. Bookkeeping fields
 * (`lastScrapedAt`, `updatedAt`) are deliberately excluded — they are not
 * "published values", so provenance for them would be noise, not lineage.
 *
 * Proof: this test is the failing-test-first regression guard; the real-data
 * proof (staging cycle read) is owed at merge per the PR body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);
const consolidateIPODataMock = vi.fn().mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));

vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) =>
  await importOriginal<typeof import('@ipodhan/shared/db/schema')>()
);

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: (...args: unknown[]) => bulkTrackFieldUpdatesMock(...args),
      findByField: vi.fn().mockResolvedValue(null),
      findByIPOId: vi.fn().mockResolvedValue([]),
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
    id: 'ipo-454',
    slug: 'manika-plastech-ltd',
    companyName: 'Manika Plastech Ltd',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'UPCOMING',
    issueSize: null,
    listingExchanges: ['BSE'],
    ...overrides,
  } as any;
}

function scrape(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Manika Plastech Ltd',
    listingExchange: 'BSE',
    status: 'UPCOMING',
    issueSize: 123456789,
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

describe('#454 — the fallback door records field_sources provenance for every field it writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));
  });

  it('writes a field_sources row for issueSize (and other published fields) when consolidation throws', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    expect(bulkTrackFieldUpdatesMock).toHaveBeenCalledTimes(1);
    const [ipoId, tableName, fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    expect(ipoId).toBe('ipo-454');
    expect(tableName).toBe('ipos');
    const issueSizeRow = fields.find((f: any) => f.fieldName === 'issueSize');
    expect(issueSizeRow).toBeDefined();
    expect(issueSizeRow.source).toBe('BSE');
  });

  it('never tracks the bookkeeping fields lastScrapedAt / updatedAt as provenanced values', async () => {
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow());

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    const names = fields.map((f: any) => f.fieldName);
    expect(names).not.toContain('lastScrapedAt');
    expect(names).not.toContain('updatedAt');
  });

  it('the ledger stays honest: fieldSourcesWritten reflects that provenance WAS written on this door now', async () => {
    // The door still ran no cross-source consolidation, but it now DOES write
    // lineage rows for what it persisted - the ledger must say so, not claim
    // false the way it did before this fix.
    const src = await import('fs').then((fs) => fs.readFileSync(
      require.resolve('../../../src/services/data-persister.ts'),
      'utf8'
    ));
    expect(src).toMatch(/fieldSourcesWritten:\s*FEATURE_FLAGS\.ENABLE_SOURCE_TRACKING/);
  });
});
