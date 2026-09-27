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

describe('#454 round 1 (OD-73 CRITICAL) — the fallback door tracks only fields whose value actually changed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));
  });

  it('an IDENTICAL incoming value is never tracked — no re-stamp of a settled field with a new source', async () => {
    // Reviewer probe shape: CHITTORGARH resends the SAME stored issueSize.
    // Before the fix this re-stamped issueSize as CHITTORGARH, silently
    // demoting whatever previously owned it (e.g. DOC) to CHITTORGARH.
    const ipoRepository = makeIpoRepository();
    const existing = existingRow({ issueSize: 123456789 });

    await upsertIPO(ipoRepository, scrape({ issueSize: 123456789 }), 'CHITTORGARH', existing);

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0] ?? [null, null, []];
    const names = (fields ?? []).map((f: any) => f.fieldName);
    expect(names).not.toContain('issueSize');
    // companyName/status are also unchanged in this probe (same values in
    // scrape() and existingRow()) — none of them should be re-stamped either.
    expect(names).not.toContain('companyName');
    expect(names).not.toContain('status');
  });

  it('a CHANGED value is still tracked, naming the incoming source — the positive control', async () => {
    const ipoRepository = makeIpoRepository();
    const existing = existingRow({ issueSize: 20000000 });

    await upsertIPO(ipoRepository, scrape({ issueSize: 50000000 }), 'CHITTORGARH', existing);

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    const row = fields.find((f: any) => f.fieldName === 'issueSize');
    expect(row).toBeDefined();
    expect(row.source).toBe('CHITTORGARH');
    expect(row.previousValue).toBe('20000000');
  });

  it('a type-only difference (stored NUMERIC string vs incoming JS number) is NOT a change — mirrors valuesEqualForWrite, not raw String()', async () => {
    const ipoRepository = makeIpoRepository();
    // Postgres NUMERIC often round-trips as a string; a raw String()
    // comparison of two DIFFERENTLY-TYPED-but-equal values would report a
    // false change. valuesEqualForWrite normalizes both to numbers first.
    const existing = existingRow({ issueSize: '123456789.00' as any });

    await upsertIPO(ipoRepository, scrape({ issueSize: 123456789 }), 'CHITTORGARH', existing);

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0] ?? [null, null, []];
    const names = (fields ?? []).map((f: any) => f.fieldName);
    expect(names).not.toContain('issueSize');
  });
});

describe('#454 round 1 (MAJOR) — the fallback door honours contextFields/lineage and never throws past the committed update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));
  });

  // Filing-persister call shape: source DRHP, contextFields naming the
  // identity-resolution fields it had to supply but is not claiming.
  function filingPersisterCall(ipoRepository: any, overrides: Record<string, unknown> = {}) {
    const existing = existingRow({
      segment: 'MAINBOARD',
      companyName: 'Manika Plastech Ltd',
      status: 'UPCOMING',
      listingExchanges: ['BSE'],
      issueSize: 100,
      ...overrides,
    });
    return upsertIPO(
      ipoRepository,
      scrape({
        companyName: 'Manika Plastech Ltd', // same value — context, not a claim
        status: 'LISTED', // DIFFERENT value but declared context — must not be tracked
        listingExchange: 'BSE', // context, singular spelling
        issueSize: 150000000, // the actual claim this write is making (MAINBOARD-plausible)
      }),
      'DRHP',
      existing,
      ['companyName', 'status', 'listingExchange'],
      { method: 'filing', docType: 'RHP', documentId: 'doc-1' }
    );
  }

  it('never re-stamps a contextFields field, even under the singular "listingExchange" spelling and even when its value changed', async () => {
    const ipoRepository = makeIpoRepository();

    await filingPersisterCall(ipoRepository);

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0] ?? [null, null, []];
    const names = (fields ?? []).map((f: any) => f.fieldName);
    expect(names).not.toContain('companyName');
    expect(names).not.toContain('status');
    expect(names).not.toContain('listingExchanges');
  });

  it('excludes an E-1 exchange-stated field for a document source even when NOT declared as context (the repository would otherwise throw)', async () => {
    // status is E-1 and was declared context above; use a call that does NOT
    // declare it context but still changes it, to prove the guard is a
    // SEPARATE, independent exclusion — not merely inferred from context.
    const ipoRepository = makeIpoRepository();
    const existing = existingRow({ segment: 'MAINBOARD', status: 'UPCOMING' });

    await upsertIPO(
      ipoRepository,
      scrape({ status: 'LISTED', issueSize: 150000000 }),
      'DRHP',
      existing,
      ['companyName'], // status NOT declared context this time
      null
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1); // the ipos write still succeeds
    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0] ?? [null, null, []];
    const names = (fields ?? []).map((f: any) => f.fieldName);
    expect(names).not.toContain('status');
    expect(names).toContain('issueSize'); // the non-E-1 claim still gets tracked
  });

  it('passes this write\'s lineage through to the tracked field(s) (#993)', async () => {
    const ipoRepository = makeIpoRepository();

    await filingPersisterCall(ipoRepository);

    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    const row = fields.find((f: any) => f.fieldName === 'issueSize');
    expect(row).toBeDefined();
    expect(row.dataLineage).toEqual({ method: 'filing', docType: 'RHP', documentId: 'doc-1' });
  });

  it('a provenance-write failure never propagates past the already-committed ipos update', async () => {
    const ipoRepository = makeIpoRepository();
    bulkTrackFieldUpdatesMock.mockRejectedValueOnce(
      new Error("E-1 field 'status' may not be written from the document path (source=DRHP).")
    );

    await expect(
      upsertIPO(ipoRepository, scrape({ issueSize: 50000000 }), 'CHITTORGARH', existingRow({ issueSize: 20000000 }))
    ).resolves.toBe('ipo-454');

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
  });
});

describe('#454 remainder — the fallback door never PUBLISHES a context field or a document-path E-1 field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation throws (simulated) - forces the fallback door'));
  });

  const written = (ipoRepository: any) => ipoRepository.update.mock.calls[0][1] as Record<string, unknown>;

  it('(a) a CHANGED, non-E-1 context field from a feed source is not written to ipos (OD-66)', async () => {
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ segment: 'SME', issueSize: 150000000 }),
      'CHITTORGARH',
      existingRow({ segment: 'MAINBOARD', issueSize: 100 }),
      ['segment'],
      null
    );
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    expect(written(ipoRepository)).not.toHaveProperty('segment');
    expect(Number(written(ipoRepository).issueSize)).toBe(150000000); // the claim still publishes // the claim still publishes
  });

  it('(a) a CHANGED context field from a document source is not written either (companyName, listingExchange spelling)', async () => {
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ companyName: 'Manika Plastech Limited', listingExchange: 'NSE', issueSize: 150000000 }),
      'DRHP',
      existingRow({ segment: 'MAINBOARD', issueSize: 100, listingExchanges: ['BSE'] }),
      ['companyName', 'listingExchange'],
      { method: 'filing', docType: 'RHP', documentId: 'doc-1' }
    );
    const w = written(ipoRepository);
    expect(w).not.toHaveProperty('companyName');
    expect(w).not.toHaveProperty('listingExchanges');
    expect(Number(w.issueSize)).toBe(150000000);
  });

  it('(b) an E-1 field from a DOCUMENT source is not written to ipos even when not declared context (§1.2.1)', async () => {
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ status: 'OPEN', openDate: new Date('2026-10-05T00:00:00Z'), issueSize: 150000000 }),
      'DRHP',
      existingRow({ segment: 'MAINBOARD', status: 'UPCOMING', openDate: new Date('2026-10-01T00:00:00Z'), issueSize: 100 }),
      ['companyName'],
      null
    );
    const w = written(ipoRepository);
    expect(w).not.toHaveProperty('status');
    expect(w).not.toHaveProperty('openDate');
    expect(Number(w.issueSize)).toBe(150000000);
  });

  it('(b) the same E-1 fields from the EXCHANGE are claims: written to ipos and given provenance', async () => {
    const ipoRepository = makeIpoRepository();
    const newOpen = new Date('2026-10-05T00:00:00Z');
    await upsertIPO(
      ipoRepository,
      scrape({ status: 'OPEN', openDate: newOpen, listingExchange: 'NSE' }),
      'NSE',
      existingRow({ segment: 'MAINBOARD', status: 'UPCOMING', openDate: new Date('2026-10-01T00:00:00Z'), listingExchanges: ['NSE'] }),
      undefined,
      null
    );
    const w = written(ipoRepository);
    expect(w.status).toBe('OPEN');
    expect(new Date(w.openDate as any).toISOString()).toBe(newOpen.toISOString());
    const [, , fields] = bulkTrackFieldUpdatesMock.mock.calls[0];
    const names = fields.map((f: any) => f.fieldName);
    expect(names).toContain('status');
    expect(names).toContain('openDate');
    expect(fields.find((f: any) => f.fieldName === 'status').source).toBe('NSE');
  });

  it('(c) ledger: fieldSourcesWritten is true after a successful provenance write, and fields name only what was written', async () => {
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ status: 'OPEN', issueSize: 150000000 }),
      'DRHP',
      existingRow({ segment: 'MAINBOARD', status: 'UPCOMING', issueSize: 100 }),
      ['companyName'],
      null
    );
    expect(recordDiscoveryStepsMock).toHaveBeenCalledTimes(1);
    const facts = recordDiscoveryStepsMock.mock.calls[0][1];
    expect(facts.consolidated).toBe(false);
    expect(facts.fieldSourcesWritten).toBe(true);
    expect(facts.fields).toContain('issueSize');
    expect(facts.fields).not.toContain('status');
    expect(facts.fields).not.toContain('companyName');
  });

  it('(c) ledger: fieldSourcesWritten is false when the provenance write failed after the ipos update', async () => {
    const ipoRepository = makeIpoRepository();
    bulkTrackFieldUpdatesMock.mockRejectedValueOnce(new Error('field_sources write failed (simulated)'));
    await upsertIPO(ipoRepository, scrape({ issueSize: 50000000 }), 'CHITTORGARH', existingRow({ issueSize: 20000000 }));
    const facts = recordDiscoveryStepsMock.mock.calls[0][1];
    expect(facts.fieldSourcesWritten).toBe(false);
  });

  it('(c) ledger: fieldSourcesWritten is false when source tracking is off (nothing was written)', async () => {
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = false;
    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape({ issueSize: 50000000 }), 'CHITTORGARH', existingRow({ issueSize: 20000000 }));
    expect(bulkTrackFieldUpdatesMock).not.toHaveBeenCalled();
    const facts = recordDiscoveryStepsMock.mock.calls[0][1];
    expect(facts.fieldSourcesWritten).toBe(false);
  });
});
