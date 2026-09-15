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

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/db/schema')>()),
  ipoDemandGraph: {},
}));

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  // T-307: keep the REAL resolveIpoRow — see data-persister-fuzzy-dedup.test.ts
  // for why a hand-copied mock of the tier logic would be wrong here.
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

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
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
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    // Reached only when the scrape carries a real `symbol`: the dedup pass
    // looks for an existing row with that symbol before inserting. The #654
    // positive controls are the first tests here to supply one.
    findBySymbol: vi.fn().mockResolvedValue(null),
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

  // ---------------------------------------------------------------- #654
  //
  // The insert path built its provenance rows with
  // `.filter(([, value]) => value !== undefined)`, which drops `undefined` but
  // KEEPS `null`. Every Chittorgarh `str()` helper returns `null` for an empty
  // cell (never `undefined`), so a scraper reporting "I looked and there is no
  // NSE symbol" produced a field_sources row at hard-coded confidence 100
  // claiming the field was supplied — while `ipos.symbol` was correctly null.
  //
  // Measured on ipodhan_staging: 61 IPOs carry a field_sources row naming a
  // field whose parent value is null (LISTED 32, CLOSED 21, UPCOMING 5,
  // OPEN 3). Two are live: Quanto Agroworld (OPEN) and Axiom Gas (UPCOMING),
  // and both fail NSE document discovery with `no_symbol` while the provenance
  // ledger says the symbol was sourced.
  //
  // Class: every field_sources row the INSERT path creates whose parent field
  // is null — every table the persister inserts, rows written before this fix
  // and rows it will write after it.
  describe('#654 — provenance is never recorded for a value that never landed', () => {
    it('does not track a field the scrape explicitly reported as null', async () => {
      const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

      await upsertIPO(ipoRepository, makeScrapedIPO({ symbol: null }), 'CHITTORGARH');

      const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
      const names = fields.map((f: any) => f.fieldName);
      expect(names).not.toContain('symbol');
    });

    it('still does not track an absent (undefined) field — the original behaviour is kept', async () => {
      const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

      await upsertIPO(ipoRepository, makeScrapedIPO({ symbol: undefined }), 'CHITTORGARH');

      const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
      expect(fields.map((f: any) => f.fieldName)).not.toContain('symbol');
    });

    it('DOES track a field that carries a real value — the positive control', async () => {
      // Without this, tightening the filter until it dropped everything would
      // pass both tests above and silently stop recording all provenance.
      const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

      await upsertIPO(ipoRepository, makeScrapedIPO({ symbol: 'MOPSHOP' }), 'CHITTORGARH');

      const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
      const symbolRow = fields.find((f: any) => f.fieldName === 'symbol');
      expect(symbolRow).toBeDefined();
      expect(symbolRow.source).toBe('CHITTORGARH');
    });

    it('a field the persister itself rejects is not tracked — the value never reaches the row', async () => {
      // Measured while writing these tests, and it corrects what I first
      // assumed: `issueSize: 0` is NOT a falsy-value bug. `coercePositiveOrNull`
      // turns it into null before `ipoData` is built (an IPO with a zero issue
      // size is meaningless), so `issueSize: safeIssueSize !== null ? ... :
      // undefined` makes it `undefined` and the filter drops it. Not tracking
      // it is CORRECT: no value reached the row, so there is nothing to claim.
      //
      // This is the insert path's version of the #654 rule, and it already
      // holds. The defect was never here — it is in the consolidation write
      // path, where a field null on BOTH sides fell through to the provenance
      // write (see consolidation-null-provenance.test.ts).
      const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'mopshop-distribution-ltd' });

      await upsertIPO(ipoRepository, makeScrapedIPO({ issueSize: 0 }), 'CHITTORGARH');

      const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
      const names = fields.map((f: any) => f.fieldName);
      expect(names).not.toContain('issueSize');
      // And the row that DID land is still tracked, so this is not a
      // everything-dropped false pass.
      expect(names).toContain('companyName');
    });
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

  // T-308F checker finding F1 — "first-sight write": an IPO first ingested
  // at/after listing, with a lone price and NO stored band, must not land
  // min===max on the CREATE path either. The real fix lives in each emitter's
  // parser (a lone price now yields priceRangeMin/Max === undefined — see
  // nse-scraper.ts/nse-api-client.ts/bse-scraper.ts/bse-detail-scraper.ts),
  // so this proves the persister's create path has no fallback that would
  // synthesize a degenerate band from anywhere else (e.g. an issuePrice
  // field) when the scraped payload correctly carries no band.
  it('does not synthesize a degenerate min===max band on a fresh create when the scrape carries no band (post-fix emitter shape)', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'late-listing-ipo-ltd' });

    await upsertIPO(
      ipoRepository,
      makeScrapedIPO({
        companyName: 'Late Listing IPO Ltd.',
        status: 'LISTED',
        priceRangeMin: undefined,
        priceRangeMax: undefined,
      }),
      'NSE'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.priceRangeMin).toBeUndefined();
    expect(created.priceRangeMax).toBeUndefined();
  });

  // A genuinely fixed-price first-sight row (RIGHTS/NCD, or a scraper that
  // legitimately reports a single price) is NOT the bug this rule guards
  // against — min===max is the correct value there, and the create path
  // must not strip it.
  it('still allows a genuine fixed-price band (min===max) through on create — not every equal pair is a collapse', async () => {
    const ipoRepository = makeIpoRepository({ id: 'new-ipo-id', slug: 'fixed-price-rights-ltd' });

    await upsertIPO(
      ipoRepository,
      makeScrapedIPO({
        companyName: 'Fixed Price Rights Ltd.',
        offeringType: 'RIGHTS',
        segment: null,
        priceRangeMin: 42,
        priceRangeMax: 42,
      }),
      'CHITTORGARH'
    );

    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.priceRangeMin).toBe(42);
    expect(created.priceRangeMax).toBe(42);
  });
});
