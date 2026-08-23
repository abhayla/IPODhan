/**
 * T-292 P3-11 + P1-1 — create-path coverage for data-persister.upsertIPO
 *
 * Lineage was written only on the UPDATE path (inside consolidation) — a brand-new
 * IPO row got ZERO field_sources entries. And the SME/FPO guard (P1-1) must apply
 * on create too, since a fresh row can be created with the wrong offering_type just
 * as easily as an existing one can be flipped (the Mopshop shape).
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

vi.mock('@ipodhan/shared/repositories', () => ({
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({
    bulkTrackFieldUpdates: bulkTrackFieldUpdatesMock,
  })),
  DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
  RegistrarRepository: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue([]),
  })),
}));

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
    companyName: 'Mopshop Distribution Ltd.',
    issueSize: 27260000,
    priceRangeMin: 138,
    priceRangeMax: 138,
    openDate: '2026-08-19',
    closeDate: '2026-08-21',
    listingExchange: 'BSE',
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
    create: vi.fn().mockResolvedValue(createReturn),
    update: vi.fn(),
  } as any;
}

describe('upsertIPO — create path (T-292)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('writes field_sources lineage rows for a fresh insert (P3-11)', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

    await upsertIPO(ipoRepository, makeScrapedIPO(), 'BSE');

    expect(bulkTrackFieldUpdatesMock).toHaveBeenCalledTimes(1);
    const [ipoId, tableName, fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    expect(ipoId).toBe('new-ipo-id');
    expect(tableName).toBe('ipos');
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    // every tracked field came from this scrape's source, at full confidence,
    // with no previous value (there is no prior row to have had one)
    for (const f of fields) {
      expect(f.source).toBe('BSE');
      expect(f.confidence).toBe(100);
      expect(f.previousValue).toBeNull();
    }
    const fieldNames = fields.map((f: any) => f.fieldName);
    expect(fieldNames).toContain('companyName');
    expect(fieldNames).toContain('offeringType');
  });

  it('rejects an SME-segment row created as FPO — corrects to IPO before insert (P1-1)', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

    // Simulates the Mopshop shape: this cycle's scrape (e.g. Moneycontrol) supplies
    // offeringType=FPO on a row whose segment is SME.
    await upsertIPO(ipoRepository, makeScrapedIPO({ offeringType: 'FPO' }), 'MONEYCONTROL');

    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.offeringType).toBe('IPO');
  });

  it('leaves a MAINBOARD-segment FPO create untouched — genuine FPOs exist there', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'acme-fpo-ltd' });

    await upsertIPO(
      ipoRepository,
      makeScrapedIPO({ companyName: 'Acme FPO Ltd.', segment: 'MAINBOARD', offeringType: 'FPO' }),
      'NSE'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.offeringType).toBe('FPO');
  });

  it('drops uncorroborated hard dates from a non-authoritative source on create (P2-5, Priority Jewels shape)', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'priority-jewels-ltd' });

    await upsertIPO(
      ipoRepository,
      makeScrapedIPO({
        companyName: 'Priority Jewels Ltd.',
        segment: 'MAINBOARD',
        status: 'UPCOMING',
        openDate: '2026-12-01',
        closeDate: '2026-12-04',
      }),
      'MONEYCONTROL'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.openDate).toBeUndefined();
    expect(created.closeDate).toBeUndefined();
    // companyName and other non-date fields are untouched
    expect(created.companyName).toBe('Priority Jewels Ltd.');
  });

  it('keeps hard dates on create when the source is an exchange (NSE/BSE/DRHP/ADMIN)', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

    await upsertIPO(ipoRepository, makeScrapedIPO(), 'BSE');

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.openDate).toBeTruthy();
    expect(created.closeDate).toBeTruthy();
  });
});
