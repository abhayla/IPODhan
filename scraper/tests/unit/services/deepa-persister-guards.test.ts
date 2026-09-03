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
    // Round-3 C1: the scrape reports the exchange the row ALREADY has, so the
    // merged exchange list is unchanged too — this is now a genuine no-op end
    // to end. (Previously this scrape reported 'NSE' against a ['BSE'] row, so
    // the payload really did differ and the old fieldsUpdated-based skip was
    // suppressing a write the row needed — the exact C1 bug.)
    await upsertIPO(ipoRepository, nseScrape({ listingExchange: 'BSE' }), 'NSE', existingDeepaRow());

    // consolidatedData is empty and nothing differs from the stored row — a
    // genuine no-op — so the persister skips `ipoRepository.update()` entirely
    // rather than calling it with a patch that happens to omit `cin`.
    expect(ipoRepository.update).not.toHaveBeenCalled();
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

/**
 * W-104 (CRITICAL): both write doors used to regenerate the public slug from
 * companyName on EVERY write, including updates. Live incident on the test DB
 * (2026-09-03): a filing persist (source DRHP) re-ran the slug for an OPEN
 * IPO whose name NSE had changed, turning `rays-of-belief-ltd` into
 * `rays-of-belief-limited-for-profit-social-enterprise` — breaking every
 * stored link, the sitemap, and the search index. Fix: the slug is computed
 * only at CREATE; on the update path the incoming `slug` is dropped before it
 * reaches either write door (consolidation `incomingData` or the
 * non-destructive fallback), except when `source === 'ADMIN'`.
 */
describe('upsertIPO slug regeneration guard (W-104)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  const RENAMED = 'Rays Of Belief Limited For Profit Social Enterprise';

  it('(a) consolidation path: a changed companyName never sends slug into incomingData, and the update payload carries no slug', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 1,
      fieldsUpdated: 1,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [
        { fieldName: 'companyName', finalValue: RENAMED, chosenSource: 'DRHP', hadConflict: false },
      ],
      consolidatedData: { companyName: RENAMED },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape({ companyName: RENAMED }), 'DRHP' as any, existingDeepaRow());

    expect(consolidateIPODataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        incomingData: expect.not.objectContaining({ slug: expect.anything() }),
      })
    );
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('deepa-id');
    expect(patch).not.toHaveProperty('slug');
  });

  it('(a) fallback path: a changed companyName never writes slug into the fallback patch', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation boom'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape({ companyName: RENAMED }), 'NSE', existingDeepaRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('slug');
  });

  it('(b) insert path: a brand-new IPO still gets a generated slug', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'new-id',
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
    ipoRepository.create.mockResolvedValue({ id: 'new-id' });
    await upsertIPO(ipoRepository, nseScrape({ companyName: 'Brand New Ltd' }), 'NSE', null);

    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const [createPayload] = ipoRepository.create.mock.calls[0];
    expect(createPayload.slug).toBe('brand-new-ltd');
  });

  it('(c) ADMIN source: an update MAY change the slug', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 1,
      fieldsUpdated: 1,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [
        { fieldName: 'slug', finalValue: 'rays-of-belief-limited-for-profit-social-enterprise', chosenSource: 'ADMIN', hadConflict: false },
      ],
      consolidatedData: { slug: 'rays-of-belief-limited-for-profit-social-enterprise' },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape({ companyName: RENAMED }), 'ADMIN' as any, existingDeepaRow());

    expect(consolidateIPODataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        incomingData: expect.objectContaining({ slug: 'rays-of-belief-limited-for-profit-social-enterprise' }),
      })
    );
  });

  it('(d) wiring: generateSlug is written into the ipos write payload only on the insert branch (source guard present)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../src/services/data-persister.ts', import.meta.url),
      'utf-8'
    );
    // The create-branch object literal always sets `slug,`; the guard right
    // after it MUST delete that same key on every update except ADMIN.
    expect(source).toMatch(/if \(existingIPO && source !== 'ADMIN'\) \{\s*\n\s*delete \(ipoData as any\)\.slug;/);
  });
});

/**
 * Round-1 gap: the `fieldsUpdated === 0` no-op skip (S-02 §5) had coverage
 * only indirectly, through a `cin`-specific test above. This pins the
 * behaviour directly: a genuine no-op consolidation result must never reach
 * `ipoRepository.update()` (which is also where BaseRepository's cache
 * invalidation happens — not calling it is what proves no cache invalidation
 * fired either), and a real field change must.
 */
describe('upsertIPO — no-op write suppression is persister-level tested (round-1 gap)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('fieldsUpdated: 0 => ipoRepository.update is NOT called (no row write, no cache invalidation)', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 1,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [
        { fieldName: 'status', finalValue: 'OPEN', chosenSource: 'NSE', hadConflict: false },
      ],
      consolidatedData: { status: 'OPEN' },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    // Round-3 C1: 'BSE' is the exchange the row already carries, so the merged
    // exchange list does not change either — nothing at all differs from the
    // stored row. With the previous 'NSE' scrape this row GAINED an exchange,
    // and the old fieldsUpdated-based skip dropped that write (the C1 bug).
    await upsertIPO(ipoRepository, nseScrape({ listingExchange: 'BSE' }), 'NSE', existingDeepaRow());

    expect(ipoRepository.update).not.toHaveBeenCalled();
  });

  it('fieldsUpdated: 1 => ipoRepository.update IS called with the consolidated patch', async () => {
    consolidateIPODataMock.mockResolvedValue({
      ipoId: 'deepa-id',
      fieldsProcessed: 1,
      fieldsUpdated: 1,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [
        { fieldName: 'status', finalValue: 'CLOSED', chosenSource: 'NSE', hadConflict: false },
      ],
      consolidatedData: { status: 'CLOSED' },
      errors: [],
      performanceMs: 1,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, nseScrape(), 'NSE', existingDeepaRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('deepa-id');
    expect(patch.status).toBe('CLOSED');
  });
});
