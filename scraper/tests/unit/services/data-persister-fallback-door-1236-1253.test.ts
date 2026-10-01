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
const findByIPOIdMock = vi.fn().mockResolvedValue([]);
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

const { mergeListingExchangesForSource, dropFallbackNonClaims, fallbackNonClaimTest, guardSmeOfferingTypeWithLookup, IPO_WRITE_GUARDS } = await import(
  '../../../src/services/data-persister.js'
);

const written = (repo: any) => repo.update.mock.calls[0][1] as Record<string, unknown>;

function reset() {
  vi.clearAllMocks();
  (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
  bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  findByFieldMock.mockResolvedValue(null);
  findByIPOIdMock.mockResolvedValue([]);
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

/**
 * #1236 round 3 (re-approach after independent review). RCA: the persister has two write doors and
 * the fallback door ran a SUBSET of the primary door's guards, so any exception on the primary path
 * (including a guard's own provenance lookup THROWING, e.g. the #180 F2 reads) downgraded protection.
 * Structural fix: one ordered guard list (IPO_WRITE_GUARDS) that both doors run; every guard whose own
 * lookup fails keeps the stored value and names the field in provenanceLookupFailed.
 * Spec basis: #180 F2 (a non-authoritative source is never the first to assert a hard date), OD-66,
 * E-1 section 1.2.1, OD-129, OD-131, T-276, section 2.9 (POSTPONED / terminal status), section 9.2 item 19.
 */
describe('#1236 round 3: one guard list, run by both doors', () => {
  beforeEach(reset);
  const facts = () => recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as {
    provenanceLookupFailed: string[]; consolidated: boolean; fields: string[];
  };
  const undated = (overrides: Record<string, unknown> = {}) =>
    existingRow({ segment: 'MAINBOARD', openDate: null, closeDate: null, listingDate: null, issueSize: 100, ...overrides });
  const cgDate = () => scrape({ openDate: '2026-10-05', issueSize: 100, listingExchange: undefined });
  const okConsolidation = (consolidatedData: Record<string, unknown>) =>
    consolidateIPODataMock.mockResolvedValue({
      consolidatedData, fieldResults: [], fieldsUpdated: 0, conflictsDetected: 0, conflictsBySeverity: {},
    });
  const trackedRow = () => findByIPOIdMock.mockResolvedValue([{ fieldName: 'issueSize', source: 'NSE' }]);

  it('the guard list is the full primary guard set, in order', () => {
    expect(IPO_WRITE_GUARDS.map((g: { name: string }) => g.name)).toEqual([
      'source-precedence',
      'offering-type-keeps-classification',
      'sme-offering-type-fpo',
      'hard-date-first-touch-f2',
      'merged-record-validation-w14',
      'degenerate-price-band-t276',
      'non-claims-context-e1',
      'terminal-status-kept',
    ]);
  });

  describe('#180 F2 on the fallback door (consolidation threw)', () => {
    it('uncorroborated CHITTORGARH openDate over a stored null on a tracked row -> not written', async () => {
      trackedRow();
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(facts().consolidated).toBe(false);
      expect(written(repo)).not.toHaveProperty('openDate');
    });

    it('the row lookup (findByIPOId) THREW -> not written, openDate named in provenanceLookupFailed', async () => {
      findByIPOIdMock.mockRejectedValue(new Error('field_sources read failed (simulated)'));
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).not.toHaveProperty('openDate');
      expect(facts().provenanceLookupFailed).toContain('openDate');
    });

    it('the field lookup (findByField) THREW -> not written, flagged', async () => {
      trackedRow();
      findByFieldMock.mockRejectedValue(new Error('field_sources read failed (simulated)'));
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).not.toHaveProperty('openDate');
      expect(facts().provenanceLookupFailed).toContain('openDate');
    });

    it('control: a corroborating prior openDate row exists -> written', async () => {
      trackedRow();
      findByFieldMock.mockImplementation(async (_id: string, _t: string, field: string) =>
        field === 'openDate' ? { source: 'NSE' } : null);
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).toHaveProperty('openDate');
    });

    it('control: an untracked row (no field_sources rows at all) -> written (unknown provenance, as on the primary door)', async () => {
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).toHaveProperty('openDate');
    });

    it('control: an authoritative source (NSE) -> written, no row lookup made', async () => {
      trackedRow();
      const repo = makeIpoRepository();
      await upsertIPO(repo, scrape({ openDate: '2026-10-05', issueSize: 100 }), 'NSE', undated());
      expect(written(repo)).toHaveProperty('openDate');
      expect(findByIPOIdMock).not.toHaveBeenCalled();
    });
  });

  describe('#180 F2 on the primary door: a lookup that THROWS no longer routes the write to a weaker door', () => {
    it('findByIPOId THREW -> the primary door keeps the stored null, flags openDate, and does not fall back', async () => {
      findByIPOIdMock.mockRejectedValue(new Error('field_sources read failed (simulated)'));
      okConsolidation({ openDate: '2026-10-05', issueSize: 200 });
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(written(repo)).not.toHaveProperty('openDate');
      expect(facts().consolidated).toBe(true);
      expect(facts().provenanceLookupFailed).toContain('openDate');
    });

    it('findByField THREW -> same', async () => {
      trackedRow();
      findByFieldMock.mockRejectedValue(new Error('field_sources read failed (simulated)'));
      okConsolidation({ openDate: '2026-10-05', issueSize: 200 });
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).not.toHaveProperty('openDate');
      expect(facts().consolidated).toBe(true);
      expect(facts().provenanceLookupFailed).toContain('openDate');
    });

    it('control: lookups ok, prior row exists -> the primary door writes the date', async () => {
      trackedRow();
      findByFieldMock.mockImplementation(async (_id: string, _t: string, field: string) =>
        field === 'openDate' ? { source: 'BSE' } : null);
      okConsolidation({ openDate: '2026-10-05', issueSize: 200 });
      const repo = makeIpoRepository();
      await upsertIPO(repo, cgDate(), 'CHITTORGARH', undated());
      expect(written(repo)).toHaveProperty('openDate');
    });
  });

  describe('the other guards on the fallback door (consolidation threw)', () => {
    it('offering-type-keeps-classification: a stored RIGHTS is not downgraded to IPO by a scrape', async () => {
      const repo = makeIpoRepository();
      await upsertIPO(repo, scrape({ offeringType: 'IPO', issueSize: 100 }), 'NSE',
        existingRow({ segment: 'MAINBOARD', offeringType: 'RIGHTS', issueSize: 100 }));
      expect(written(repo).offeringType).toBe('RIGHTS');
    });

    it('terminal-status-kept: a stored WITHDRAWN is not overwritten by UPCOMING', async () => {
      const repo = makeIpoRepository();
      await upsertIPO(repo, scrape({ status: 'UPCOMING', issueSize: 100 }), 'NSE',
        existingRow({ segment: 'MAINBOARD', status: 'WITHDRAWN', issueSize: 100 }));
      expect(written(repo).status ?? 'WITHDRAWN').toBe('WITHDRAWN');
    });

    it('admin hold (section 9.2 item 19): a held field dropped by the write is neither reported nor claimed', async () => {
      const repo = makeIpoRepository();
      repo.updateReportingHolds = vi.fn().mockResolvedValue({ dropped: ['issueSize'] });
      await upsertIPO(repo, scrape({ issueSize: 150000000 }), 'BSE', existingRow({ issueSize: 50000000 }));
      expect(repo.updateReportingHolds).toHaveBeenCalledTimes(1);
      expect(facts().fields).not.toContain('issueSize');
      const tracked = (bulkTrackFieldUpdatesMock.mock.calls[0]?.[2] ?? []) as { fieldName: string }[];
      expect(tracked.map((t) => t.fieldName)).not.toContain('issueSize');
    });
  });

  it('MINOR: SME-FPO guard with a failed lookup and NO stored value returns the guarded value, not the incoming FPO', () => {
    expect(guardSmeOfferingTypeWithLookup('SME', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: true }, null)).toBe('IPO');
    expect(guardSmeOfferingTypeWithLookup('SME', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: true }, undefined)).toBe('IPO');
    expect(guardSmeOfferingTypeWithLookup('SME', 'FPO', 'CHITTORGARH', { source: null, lookupFailed: true }, 'FPO')).toBe('FPO');
  });
});

/**
 * #1236 round 3, scope added from the #1363 Tier A re-review: the fallback door wrote a feed's value
 * over a stored one with no field-priority decision, so when consolidation threw on an NSE write,
 * NSE's board could replace a board an offer document set. The door now runs the consolidator's own
 * rank functions (`fallbackDoorMayReplaceStoredValue`) and never accepts what that door would refuse.
 */
describe('#1236 round 3: source precedence on the fallback door (consolidation threw)', () => {
  beforeEach(reset);
  const facts = () => recordDiscoveryStepsMock.mock.calls.at(-1)?.[1] as { provenanceLookupFailed: string[]; consolidated: boolean };
  const holder = (fieldName: string, source: string) => ({ fieldName, source, tableName: 'ipos', rowKey: '' });
  const smeRow = () => existingRow({ segment: 'SME', listingExchanges: ['NSE'], issueSize: 100, status: 'CLOSED' });
  const nseMainboard = () => scrape({ segment: 'MAINBOARD', listingExchange: 'NSE', issueSize: 100, status: 'CLOSED' });

  it('a document-set segment stays when an NSE write falls to the fallback door', async () => {
    findByIPOIdMock.mockResolvedValue([holder('segment', 'DRHP')]);
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseMainboard(), 'NSE', smeRow());
    expect(facts().consolidated).toBe(false);
    expect(written(repo).segment ?? 'SME').toBe('SME');
  });

  it('an ADMIN-held value is never replaced by a scraper on the fallback door', async () => {
    findByIPOIdMock.mockResolvedValue([holder('issueSize', 'ADMIN')]);
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ issueSize: 150000000 }), 'BSE', existingRow({ issueSize: 50000000 }));
    expect(String(written(repo).issueSize ?? '50000000')).toBe('50000000');
  });

  it('the field_sources read THREW -> the stored segment is kept and named in provenanceLookupFailed', async () => {
    findByIPOIdMock.mockRejectedValue(new Error('field_sources read failed (simulated)'));
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseMainboard(), 'NSE', smeRow());
    expect(written(repo).segment ?? 'SME').toBe('SME');
    expect(facts().provenanceLookupFailed).toContain('segment');
  });

  it('control: a lower-ranked holder (CHITTORGARH) is replaced by NSE, as the consolidation door would', async () => {
    findByIPOIdMock.mockResolvedValue([holder('segment', 'CHITTORGARH')]);
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseMainboard(), 'NSE', smeRow());
    expect(written(repo).segment).toBe('MAINBOARD');
  });

  it('control: an untracked stored value is replaced by a source the matrix ranks (the untracked rule)', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, nseMainboard(), 'NSE', smeRow());
    expect(written(repo).segment).toBe('MAINBOARD');
  });

  it('a HIGH_VALUE field on a live IPO is held on the fallback door (the consolidator HOLDs one-sided changes)', async () => {
    findByIPOIdMock.mockResolvedValue([holder('priceRangeMax', 'CHITTORGARH')]);
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ priceRangeMin: 100, priceRangeMax: 130, issueSize: 100 }), 'NSE',
      existingRow({ segment: 'MAINBOARD', status: 'OPEN', priceRangeMin: 100, priceRangeMax: 120, issueSize: 100 }));
    expect(written(repo).priceRangeMax ?? 120).toBe(120);
  });
});

describe('#1236 round 3: merged-record-validation-w14 through the shared list', () => {
  beforeEach(reset);
  const inverted = () => scrape({ priceRangeMin: 200, priceRangeMax: 100, issueSize: 200 });
  const row = () => existingRow({ segment: 'MAINBOARD', status: 'CLOSED', priceRangeMin: 90, priceRangeMax: 100, issueSize: 100 });

  it('consolidation door: a merged winner for a W-14-refused field is not written', async () => {
    consolidateIPODataMock.mockResolvedValue({
      consolidatedData: { priceRangeMin: 200, priceRangeMax: 100, issueSize: 200 },
      fieldResults: [], fieldsUpdated: 0, conflictsDetected: 0, conflictsBySeverity: {},
    });
    const repo = makeIpoRepository();
    await upsertIPO(repo, inverted(), 'NSE', row());
    expect(written(repo)).not.toHaveProperty('priceRangeMin');
    expect(written(repo)).not.toHaveProperty('priceRangeMax');
  });

  it('fallback door: the refused band is not written either', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, inverted(), 'NSE', row());
    expect(written(repo).priceRangeMin ?? 90).toBe(90);
    expect(written(repo).priceRangeMax ?? 100).toBe(100);
  });
});

describe('#1236 round 3: status on the fallback door (consolidation threw)', () => {
  beforeEach(reset);
  it('a BACKWARD status move (LISTED -> OPEN) is kept at the stored value', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ status: 'OPEN', issueSize: 100, listingExchange: 'NSE' }), 'NSE',
      existingRow({ segment: 'MAINBOARD', status: 'LISTED', issueSize: 100, listingExchanges: ['NSE'] }));
    expect(written(repo).status ?? 'LISTED').toBe('LISTED');
  });
  it('control: a forward move (UPCOMING -> OPEN) from the exchange is written', async () => {
    const repo = makeIpoRepository();
    await upsertIPO(repo, scrape({ status: 'OPEN', issueSize: 100, listingExchange: 'NSE' }), 'NSE',
      existingRow({ segment: 'MAINBOARD', status: 'UPCOMING', issueSize: 100, listingExchanges: ['NSE'] }));
    expect(written(repo).status).toBe('OPEN');
  });
});
