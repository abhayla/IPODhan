import { describe, it, expect, vi, beforeEach } from 'vitest';



/**
 * #1236 + #1253 (one file: both are the consolidation-failure fallback door in data-persister.ts).
 *
 * #1236 RCA: when consolidation throws AND the listingExchanges provenance lookup also throws, the
 * lookup helper returned null == "no document claim", so a feed widened a document-held set and the
 * provenance write then recorded the feed as its source (never undone). Class: listing_exchanges of
 * any IPO, any segment, any feed, on the double-failure path. Answer states of the lookup: document
 * row / feed row / no row (never tracked) / THREW - only the last one changes.
 *
 * #1253 RCA: (1) the context / E-1 non-claim rule was written three times; (2) a failed deferred
 * provenance commit never set fallbackProvenanceWriteFailed, so the ledger claimed
 * fieldSourcesWritten: true; (3) the fallback door had no degenerate price-band guard.
 * Class: every write through the fallback door.
 * Spec basis: OD-129 (fallback order: document first, feed only when no document read), E-1 section
 * 1.2.1, OD-66 (context is never a claim), OD-131 (provenance only for stored values), T-276
 * (never collapse a stored real band; FIXED_PRICE exempt).
 */
const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);
const findByFieldMock = vi.fn().mockResolvedValue(null);
const commitDeferredProvenanceMock = vi.fn().mockResolvedValue({ written: 1, refused: [] });
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
      findByField: (...args: unknown[]) => findByFieldMock(...args),
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
    commitDeferredProvenance: (...args: unknown[]) => commitDeferredProvenanceMock(...args),
  })),
}));

const recordDiscoveryStepsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/services/step-ledger-recorders.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/step-ledger-recorders.js')>()),
  recordDiscoverySteps: (...args: unknown[]) => recordDiscoveryStepsMock(...args),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');
const { FEATURE_FLAGS } = await import('../../../src/config/feature-flags.js');

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

const { mergeListingExchangesForSource, dropFallbackNonClaims, fallbackNonClaimTest, guardSmeOfferingTypeWithLookup } = await import(
  '../../../src/services/data-persister.js'
);

const written = (repo: any) => repo.update.mock.calls[0][1] as Record<string, unknown>;

function reset() {
  vi.clearAllMocks();
  (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
  bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  findByFieldMock.mockResolvedValue(null);
  commitDeferredProvenanceMock.mockResolvedValue({ written: 1, refused: [] });
  consolidateIPODataMock.mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));
}

describe('#1236 mergeListingExchangesForSource: a lookup that THREW is unknown, not "no document claim"', () => {
  it('lookup threw + stored [BSE] + NSE feed -> the stored set is kept (fail closed)', () => {
    expect(mergeListingExchangesForSource(['BSE'], 'NSE', undefined, 'MAINBOARD', null, true)).toEqual(['BSE']);
  });
  it('lookup threw + CG naming both -> kept', () => {
    expect(mergeListingExchangesForSource(['NSE'], 'CHITTORGARH', 'BOTH', 'MAINBOARD', null, true)).toEqual(['NSE']);
  });
  it('lookup threw + nothing stored -> the feed still fills an empty set (nothing to protect)', () => {
    expect(mergeListingExchangesForSource([], 'NSE', undefined, 'MAINBOARD', null, true)).toEqual(['NSE']);
  });
  it('lookup threw but the incoming source IS a document -> the document still replaces (OD-129)', () => {
    expect(mergeListingExchangesForSource(['BSE', 'NSE'], 'DRHP', 'BSE', 'MAINBOARD', null, true)).toEqual(['BSE']);
  });
  it('no provenance row (never tracked, lookup did not throw) -> the feed union applies, unchanged', () => {
    expect(mergeListingExchangesForSource(['NSE'], 'BSE', undefined, 'MAINBOARD', null, false)).toEqual(['NSE', 'BSE']);
    expect(mergeListingExchangesForSource(['NSE'], 'BSE', undefined, 'MAINBOARD', null)).toEqual(['NSE', 'BSE']);
  });
});

describe('#1236 through the real fallback door: every answer state of the provenance lookup', () => {
  beforeEach(reset);
  const existing = () => existingRow({ segment: 'MAINBOARD', listingExchanges: ['BSE'], issueSize: 100 });
  const nseScrape = () => scrape({ listingExchange: 'NSE', issueSize: 100 });

  it('lookup THREW -> stored [BSE] is not widened and no listingExchanges provenance row names the feed', async () => {
    findByFieldMock.mockRejectedValue(new Error('field_sources read failed'));
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseScrape(), 'NSE', existing());
    expect(written(repo).listingExchanges).toEqual(['BSE']);
    const tracked = (bulkTrackFieldUpdatesMock.mock.calls[0]?.[2] ?? []).map((f: any) => f.fieldName);
    expect(tracked).not.toContain('listingExchanges');
  });

  it('document row -> not widened (unchanged behaviour)', async () => {
    findByFieldMock.mockResolvedValue({ source: 'DRHP' });
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseScrape(), 'NSE', existing());
    expect(written(repo).listingExchanges).toEqual(['BSE']);
  });

  it('feed row -> the other feed still widens (unchanged behaviour)', async () => {
    findByFieldMock.mockResolvedValue({ source: 'BSE' });
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseScrape(), 'NSE', existing());
    expect(written(repo).listingExchanges).toEqual(['BSE', 'NSE']);
  });

  it('no row at all (never tracked) -> the feed union applies (unchanged behaviour)', async () => {
    findByFieldMock.mockResolvedValue(null);
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseScrape(), 'NSE', existing());
    expect(written(repo).listingExchanges).toEqual(['BSE', 'NSE']);
  });
});

describe('#1253 item 1: the non-claim rule has ONE definition', () => {
  const payload = { status: 'LISTED', listingExchanges: ['NSE'], listingExchange: 'NSE', issueSize: 5, segment: 'SME', companyName: 'X' };
  const cases: Array<[string, string[] | undefined]> = [
    ['DRHP', undefined],
    ['DRHP', ['companyName']],
    ['CHITTORGARH', ['segment']],
    ['NSE', ['listingExchange']],
    ['NSE', ['listingExchanges']],
    ['BSE', undefined],
    ['RHP', ['status', 'listingExchange']],
  ];
  it.each(cases)('drop and the shared test agree for source=%s context=%j', (source, ctx) => {
    const test = fallbackNonClaimTest(source, ctx);
    const { update, refused } = dropFallbackNonClaims(payload, source, ctx);
    for (const key of Object.keys(payload)) {
      expect(refused.includes(key)).toBe(test(key));
      expect(key in update).toBe(!test(key));
    }
  });
  it('both spellings of the listing exchange are context under either declaration', () => {
    expect(fallbackNonClaimTest('NSE', ['listingExchange'])('listingExchanges')).toBe(true);
    expect(fallbackNonClaimTest('NSE', ['listingExchanges'])('listingExchange')).toBe(true);
  });
  it('an E-1 field from a feed is a claim; from a document it is not', () => {
    expect(fallbackNonClaimTest('NSE', undefined)('status')).toBe(false);
    expect(fallbackNonClaimTest('DRHP', undefined)('status')).toBe(true);
  });
});

describe('#1253 item 2: a failed deferred provenance commit is not reported as fieldSourcesWritten', () => {
  beforeEach(reset);
  const deferred = [{ fieldName: 'issueSize', source: 'BSE', value: 150000000 }];
  const run = async () => {
    // The consolidation door decides provenance, defers it, then a later step throws (the ipos
    // update); the fallback door commits it. Each answer state of that commit is asserted below.
    consolidateIPODataMock.mockResolvedValue({
      consolidatedData: { issueSize: 150000000 },
      fieldResults: [],
      fieldsUpdated: 1,
      conflictsDetected: 0,
      conflictsBySeverity: {},
      deferredProvenance: deferred,
    });
    const repo = makeIpoRepository();
    repo.update.mockRejectedValueOnce(new Error('consolidation-door ipos update failed'));
    await upsertIPO(repo, scrape({ issueSize: 150000000 }), 'BSE', existingRow({ issueSize: 50000000 }));
    return recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { fieldSourcesWritten: boolean; consolidated: boolean };
  };

  it('commit throws -> fieldSourcesWritten is false', async () => {
    commitDeferredProvenanceMock.mockRejectedValue(new Error('partial: row 1 of 2 written'));
    const facts = await run();
    expect(commitDeferredProvenanceMock).toHaveBeenCalledTimes(1);
    expect(facts.consolidated).toBe(false);
    expect(facts.fieldSourcesWritten).toBe(false);
  });

  it('control: commit succeeds -> fieldSourcesWritten is true', async () => {
    commitDeferredProvenanceMock.mockResolvedValue({ written: 1, refused: [] });
    const facts = await run();
    expect(commitDeferredProvenanceMock).toHaveBeenCalledTimes(1);
    expect(facts.fieldSourcesWritten).toBe(true);
  });

  it('control: commit succeeds but the #454 bulk track fails -> still false (the existing flag)', async () => {
    commitDeferredProvenanceMock.mockResolvedValue({ written: 1, refused: [] });
    bulkTrackFieldUpdatesMock.mockRejectedValue(new Error('bulk track failed'));
    const facts = await run();
    expect(facts.fieldSourcesWritten).toBe(false);
  });
});

describe('#1253 item 3: the fallback door refuses a degenerate band over a stored real range', () => {
  beforeEach(reset);
  const band = (min: number, max: number, extra: Record<string, unknown> = {}) => ({
    priceRangeMin: min, priceRangeMax: max, ...extra,
  });

  it('incoming min===max over a stored real range (BOOK_BUILDING) -> neither band field is written', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape(band(105, 105, { issueSize: 100 })), 'NSE',
      existingRow({ ...band(100, 110), issueType: 'BOOK_BUILDING', issueSize: 100 }));
    const w = written(repo);
    expect(w).not.toHaveProperty('priceRangeMin');
    expect(w).not.toHaveProperty('priceRangeMax');
  });

  it('control: a real incoming range is written', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape(band(100, 120, { issueSize: 100 })), 'NSE',
      existingRow({ ...band(100, 110), issueType: 'BOOK_BUILDING', issueSize: 100 }));
    expect(written(repo)).toMatchObject({ priceRangeMin: 100, priceRangeMax: 120 });
  });

  it('control: FIXED_PRICE issues legitimately have min===max -> written', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape(band(105, 105, { issueSize: 100, issueType: 'FIXED_PRICE' })), 'NSE',
      existingRow({ ...band(100, 110), issueType: 'FIXED_PRICE', issueSize: 100 }));
    expect(written(repo)).toMatchObject({ priceRangeMin: 105, priceRangeMax: 105 });
  });

  it('control: nothing real stored -> a degenerate band is accepted (genuine fixed-price / first band)', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape(band(105, 105, { issueSize: 100 })), 'NSE',
      existingRow({ priceRangeMin: null, priceRangeMax: null, issueSize: 100 }));
    expect(written(repo)).toMatchObject({ priceRangeMin: 105, priceRangeMax: 105 });
  });
});

describe('#1236 class: the offeringType provenance lookup has the same answer states', () => {
  beforeEach(reset);
  const smeFpo = () => existingRow({ segment: 'SME', offeringType: 'FPO', listingExchanges: ['BSE'], issueSize: 100 });
  const chScrape = () => scrape({ listingExchange: 'BSE', issueSize: 100, offeringType: 'FPO' });

  it('pure guard: lookup FAILED keeps the stored FPO; the four other states are unchanged', () => {
    const g = guardSmeOfferingTypeWithLookup;
    expect(g('SME', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: true }, 'FPO')).toBe('FPO');
    expect(g('SME', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: false }, 'FPO')).toBe('IPO');
    expect(g('SME', 'FPO', 'CHITTORGARH', { source: 'NSE', lookupFailed: false }, 'FPO')).toBe('FPO');
    expect(g('SME', 'FPO', 'CHITTORGARH', { source: 'CHITTORGARH', lookupFailed: false }, 'FPO')).toBe('IPO');
    expect(g('MAINBOARD', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: true }, 'FPO')).toBe('FPO');
    // failed lookup but the guard would not have rewritten anything: unchanged, incoming wins as before
    expect(g('SME', 'IPO', 'CHITTORGARH', { source: null, lookupFailed: true }, 'FPO')).toBe('IPO');
  });

  it('fallback door, lookup THREW -> the exchange-vouched SME FPO is NOT rewritten to IPO, and the ledger names the failure', async () => {
    findByFieldMock.mockRejectedValue(new Error('field_sources read failed'));
    const repo = makeIpoRepository();
    await upsertIPO(repo, chScrape(), 'CHITTORGARH', smeFpo());
    expect(written(repo).offeringType).toBe('FPO');
    const facts = recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { provenanceLookupFailed: string[] };
    expect(facts.provenanceLookupFailed).toEqual(expect.arrayContaining(['offeringType']));
  });

  it('fallback door, exchange row -> FPO kept (unchanged)', async () => {
    findByFieldMock.mockResolvedValue({ source: 'NSE' });
    const repo = makeIpoRepository();
    await upsertIPO(repo, chScrape(), 'CHITTORGARH', smeFpo());
    expect(written(repo).offeringType).toBe('FPO');
  });

  it('fallback door, no row (never tracked, lookup did not throw) -> the guard still rewrites to IPO (unchanged)', async () => {
    findByFieldMock.mockResolvedValue(null);
    const repo = makeIpoRepository();
    await upsertIPO(repo, chScrape(), 'CHITTORGARH', smeFpo());
    expect(written(repo).offeringType).toBe('IPO');
    const facts = recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { provenanceLookupFailed: string[] };
    expect(facts.provenanceLookupFailed).toEqual([]);
  });

  it('consolidation door, lookup THREW -> an incoming FPO on an SME row keeps the stored value (door 1)', async () => {
    findByFieldMock.mockRejectedValue(new Error('field_sources read failed'));
    consolidateIPODataMock.mockResolvedValue({
      consolidatedData: {}, fieldResults: [], fieldsUpdated: 0, conflictsDetected: 0, conflictsBySeverity: {},
    });
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ offeringType: 'FPO', issueSize: 100 }), 'CHITTORGARH', smeFpo());
    const facts = recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { offeringType: string | null };
    expect(facts.offeringType).not.toBe('IPO');
  });
});

describe('#1253 item 1 (N7): the SINGULAR listingExchange context key through the fallback door', () => {
  beforeEach(reset);
  it.each([['listingExchange'], ['listingExchanges']])('context key %s -> the feed never widens the stored set and writes no listingExchanges provenance', async (key) => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ listingExchange: 'NSE', issueSize: 100 }), 'NSE',
      existingRow({ segment: 'MAINBOARD', listingExchanges: ['BSE'], issueSize: 100 }), [key]);
    // context is never a claim: the field is dropped from the update (or left at the stored set)
    expect(written(repo).listingExchanges ?? ['BSE']).toEqual(['BSE']);
    const tracked = (bulkTrackFieldUpdatesMock.mock.calls[0]?.[2] ?? []).map((f: any) => f.fieldName);
    expect(tracked).not.toContain('listingExchanges');
  });
  it('control: no context -> the feed widens', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ listingExchange: 'NSE', issueSize: 100 }), 'NSE',
      existingRow({ segment: 'MAINBOARD', listingExchanges: ['BSE'], issueSize: 100 }));
    expect(written(repo).listingExchanges).toEqual(['BSE', 'NSE']);
  });
});

describe('#1236 class: the consolidation-result door and the pre-consolidation door each keep the stored value', () => {
  beforeEach(reset);
  const smeFpo = () => existingRow({ segment: 'SME', offeringType: 'FPO', listingExchanges: ['BSE'], issueSize: 100 });
  const okConsolidation = (consolidatedData: Record<string, unknown>) =>
    consolidateIPODataMock.mockResolvedValue({
      consolidatedData, fieldResults: [], fieldsUpdated: 0, conflictsDetected: 0, conflictsBySeverity: {},
    });
  const facts = () => recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { provenanceLookupFailed: string[]; offeringType: string | null };

  it('door 2 (consolidated snapshot carries the stored FPO), lookup THREW -> not rewritten to IPO, ledger names it', async () => {
    findByFieldMock.mockRejectedValue(new Error('field_sources read failed'));
    okConsolidation({ offeringType: 'FPO', issueSize: 101 });
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ issueSize: 101 }), 'CHITTORGARH', smeFpo());
    expect(facts().offeringType).toBe('FPO');
    expect(facts().provenanceLookupFailed).toContain('offeringType');
  });

  it('door 2 control: no provenance row (lookup ok) -> the stored FPO is rewritten to IPO, nothing flagged', async () => {
    findByFieldMock.mockResolvedValue(null);
    okConsolidation({ offeringType: 'FPO', issueSize: 101 });
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ issueSize: 101 }), 'CHITTORGARH', smeFpo());
    expect(facts().offeringType).toBe('IPO');
    expect(facts().provenanceLookupFailed).toEqual([]);
  });

  it('door 1 (incoming FPO on an SME row), lookup THREW -> consolidation receives the stored FPO, not IPO', async () => {
    findByFieldMock.mockRejectedValue(new Error('field_sources read failed'));
    okConsolidation({});
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ offeringType: 'FPO', issueSize: 100 }), 'CHITTORGARH', smeFpo());
    expect(consolidateIPODataMock.mock.calls[0][0].incomingData.offeringType).toBe('FPO');
    expect(facts().provenanceLookupFailed).toContain('offeringType');
  });

  it('door 1 control: lookup ok, no row -> consolidation receives IPO', async () => {
    findByFieldMock.mockResolvedValue(null);
    okConsolidation({});
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ offeringType: 'FPO', issueSize: 100 }), 'CHITTORGARH', smeFpo());
    expect(consolidateIPODataMock.mock.calls[0][0].incomingData.offeringType).toBe('IPO');
  });
});
