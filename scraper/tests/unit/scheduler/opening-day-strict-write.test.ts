import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Item 7 S4 round 4 (OD-87, spec §2.1 opening-day row: "writes identity,
 * status and the open and close dates, nothing else"). The CORE proof: a
 * dual-listed mainboard row written by the NSE list and then the BSE list
 * keeps every column this job does not own — listingExchanges ['NSE','BSE'],
 * segment 'MAINBOARD', lastScrapedAt, band, lot, size — byte-identical.
 *
 * Real module, real DataConsolidationService / DataConsolidationOrchestrator
 * (the field-priority matrix decides the values); the repository fake applies
 * an update exactly as `IPORepository.update` does (`.set({...data})` merged
 * onto the stored row), so any column in the SET clause shows up here.
 */

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true, ENABLE_CONFLICT_DETECTION: false, ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false, DEBUG_DATA_FLOW: false, ENABLE_EARLY_DETECTION: false, SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 0, CONSOLIDATION_PERCENTAGE: 100, MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100, ENABLED_SCRAPERS: [], ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
}));
vi.mock('../../../src/services/step-ledger.js', () => ({
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));

import { createOpeningDayWriter, selectOpeningToday, runOpeningDayDiscovery } from '../../../src/scheduler/opening-day-discovery.js';
import { fetchCurrentIssueList } from '../../../src/scrapers/nse-api-client.js';
import { fetchBSEBoard } from '../../../src/scrapers/bse-api-scraper.js';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { BSEListRow } from '../../../src/scrapers/bse-api-scraper.js';
import type { ScrapedIPO } from '../../../src/utils/validators.js';

const TODAY = '2026-09-24';

/** Any method on the provenance/conflict repos resolves to nothing (no stored provenance). */
const inert = () =>
  new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : vi.fn(async () => (String(p) === 'findByField' ? null : []))) }) as any;

const STORED_LAST_SCRAPED = new Date('2026-09-20T10:00:00Z');
function storedRow() {
  return {
    id: '00000000-0000-4000-8000-00000000a7s4',
    slug: 'moneyview-limited',
    companyName: 'Moneyview Limited',
    status: 'UPCOMING',
    openDate: '2026-09-24',
    closeDate: '2026-09-28',
    listingExchanges: ['NSE', 'BSE'],
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    priceRangeMin: 100,
    priceRangeMax: 105,
    lotSize: 140,
    issueSize: '5000000000',
    registrar: 'X Registrar',
    symbol: 'MONEYVIEW',
    isin: null,
    lastScrapedAt: STORED_LAST_SCRAPED,
    updatedAt: new Date('2026-09-20T10:00:00Z'),
  } as Record<string, any>;
}

function harness(initial: Record<string, any> | null) {
  let row = initial ? { ...initial } : null;
  const sets: Array<Record<string, any>> = [];
  const ipoRepository = {
    bindSourceKeys: vi.fn(async () => undefined),
    update: vi.fn(async (id: string, data: Record<string, any>) => {
      sets.push({ ...data });
      row = { ...row!, ...data, id };
      return row;
    }),
    create: vi.fn(async (values: Record<string, any>) => {
      sets.push({ ...values });
      row = { ...values, id: 'new-row' };
      return row;
    }),
  };
  const orchestrator = new DataConsolidationOrchestrator(ipoRepository as any, inert(), inert(), null);
  const service = new DataConsolidationService(inert(), inert());
  const collaborators = {
    ipoRepository,
    resolveIpoRow: vi.fn(async () => (row ? { ...row } : null)),
    inferBoundVia: vi.fn(() => 'KEY'),
    withSourceKeyLineage: async <T,>(fn: () => Promise<T>) => fn(),
    noWriteErrorNames: new Set<string>(),
    fieldProtection: {
      isIPOLocked: vi.fn(async () => false),
      filterProtectedFields: vi.fn(async (_i: string, _t: string, data: any) => ({ filtered: { ...data } })),
    },
    // Round-3 collaborator (kept so this test runs, and fails, on the round-3 head).
    consolidatedUpsertIPO: (claim: any, source: any, confidence: number, existing: any, onlyFields: string[]) =>
      orchestrator.consolidatedUpsertIPO(claim, source, confidence, existing, onlyFields),
    // Round-4 collaborator: the field-priority decision only, no write.
    consolidateFields: vi.fn((input: any) => service.consolidateIPOData(input)),
    normalizeName: (n: string) => n.toLowerCase(),
    identitySlug: () => 'moneyview-limited',
    fieldSources: { trackFieldUpdate: vi.fn(async () => undefined) },
    sourceTrackingEnabled: true,
  };
  return { collaborators, sets, get row() { return row; }, ipoRepository };
}

const NSE_ROW = {
  companyName: 'Moneyview Limited', openDate: TODAY, closeDate: '2026-09-28', status: 'OPEN', listingExchange: 'NSE',
  segment: 'MAINBOARD', offeringType: 'IPO', symbol: 'MONEYVIEW',
  sourceKeys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'MONEYVIEW|EQ', attrs: {}, recordOpenDate: TODAY }],
} as unknown as ScrapedIPO;
const BSE_ROW: BSEListRow = {
  Scrip_name: 'Moneyview Limited', Start_Dt: `${TODAY}T00:00:00`, End_Dt: '2026-09-28T00:00:00', Status: 'L',
  IR_flag: 'IPO', IR_FLAG_FULL: 'Book Building', IPO_NO: 8123, Scrip_cd: 0,
} as BSEListRow;

const OWNED = new Set(['companyName', 'status', 'openDate', 'closeDate', 'updatedAt']);

describe('opening-day strict write (OD-87): only name, status and the two dates change', () => {
  it('CORE: a dual-listed mainboard row written by NSE then BSE keeps listingExchanges, segment and every other column', async () => {
    const before = storedRow();
    const h = harness(before);
    const write = createOpeningDayWriter(h.collaborators as any);
    const picked = selectOpeningToday([NSE_ROW], [BSE_ROW], TODAY);
    expect(picked.map((p) => p.source)).toEqual(['NSE', 'BSE']);
    for (const { source, payload } of picked) await write(source, payload);

    const after = h.row!;
    expect(after.listingExchanges).toEqual(['NSE', 'BSE']);
    expect(after.segment).toBe('MAINBOARD');
    for (const k of Object.keys(before)) {
      if (!OWNED.has(k)) expect({ [k]: after[k] }).toEqual({ [k]: before[k] });
    }
    for (const set of h.sets) {
      for (const k of Object.keys(set)) expect(OWNED.has(k)).toBe(true);
    }
    expect(after.status).toBe('OPEN');
  });

  it('a lower-priority stored-date rule is still decided by the matrix: the SET carries only the four fields', async () => {
    const h = harness({ ...storedRow(), openDate: null, status: 'UPCOMING' });
    await createOpeningDayWriter(h.collaborators as any)('NSE', selectOpeningToday([NSE_ROW], [], TODAY)[0].payload);
    expect(h.sets).toHaveLength(1);
    expect(Object.keys(h.sets[0]).every((k) => OWNED.has(k))).toBe(true);
    expect(h.row!.openDate).toBe(TODAY);
  });

  // Creation itself is proven on Postgres with the real IPORepository.create
  // (tests/integration/opening-day-create.integration.test.ts). Here: OD-88.
  it('OD-88: a BSE-only newcomer (no stored row) is not created and nothing is written', async () => {
    const h = harness(null);
    const outcome = await createOpeningDayWriter(h.collaborators as any)('BSE', selectOpeningToday([], [BSE_ROW], TODAY)[0].payload);
    expect(outcome).toBe('deferred');
    expect(h.ipoRepository.create).not.toHaveBeenCalled();
    expect(h.sets).toHaveLength(0);
    expect(h.collaborators.fieldSources.trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('CORE (provenance): NSE then BSE on a stored row, every SET column has its field_sources row from the source that set it', async () => {
    const h = harness({ ...storedRow(), status: 'UPCOMING', openDate: null });
    const write = createOpeningDayWriter(h.collaborators as any);
    for (const { source, payload } of selectOpeningToday([NSE_ROW], [BSE_ROW], TODAY)) await write(source, payload);
    const tracked = (h.collaborators.fieldSources.trackFieldUpdate.mock.calls as any[]).map(([r]) => [r.fieldName, r.source]);
    const setCols = h.sets.flatMap((set) => Object.keys(set));
    expect(tracked.map(([f]) => f).sort()).toEqual(setCols.sort());
    expect(tracked).toEqual([['status', 'NSE'], ['openDate', 'NSE']]);
  });

  it('a locked IPO is checked BEFORE any source key is bound', async () => {
    const h = harness(storedRow());
    h.collaborators.fieldProtection.isIPOLocked = vi.fn(async () => true);
    expect(await createOpeningDayWriter(h.collaborators as any)('NSE', selectOpeningToday([NSE_ROW], [], TODAY)[0].payload)).toBe('skipped');
    expect(h.ipoRepository.bindSourceKeys).not.toHaveBeenCalled();
    expect(h.sets).toHaveLength(0);
  });
});

describe('opening-day strict write: the matrix decision is obeyed', () => {
  it('a value the matrix did not pick for this source (lost priority / rejected) is never in the SET', async () => {
    const h = harness({ ...storedRow(), openDate: '2026-09-23' });
    h.collaborators.consolidateFields = vi.fn(async () => ({
      fieldResults: [
        { fieldName: 'openDate', finalValue: '2026-09-23', rejectedSources: [{ source: 'BSE' }] },
        { fieldName: 'closeDate', finalValue: '2026-09-28' },
        { fieldName: 'companyName', finalValue: 'Moneyview Limited' },
        { fieldName: 'status', finalValue: 'UPCOMING' },
      ],
    })) as any;
    const outcome = await createOpeningDayWriter(h.collaborators as any)('BSE', selectOpeningToday([], [BSE_ROW], TODAY)[0].payload);
    expect(outcome).toBe('unchanged');
    expect(h.sets).toHaveLength(0);
    expect(h.row!.openDate).toBe('2026-09-23');
  });
});

describe('opening-day check: non-IPO NSE offerings are skipped and named (§1.11)', () => {
  it.each(['RIGHTS', 'NCD', 'FPO', 'INVITS', 'REITS'])('%s opening today is not written and is logged with its name and type', async (type) => {
    const row = { ...NSE_ROW, companyName: `X ${type} Issue`, offeringType: type } as unknown as ScrapedIPO;
    const writeRow = vi.fn();
    const s = await runOpeningDayDiscovery(
      { fetchNseList: async () => [row], fetchBseList: async () => [], storedOpeningOn: async () => [], writeRow },
      new Date('2026-09-24T04:45:00Z')
    );
    expect(writeRow).not.toHaveBeenCalled();
    expect(s.skippedNonIpo).toEqual([{ source: 'NSE', companyName: `X ${type} Issue`, offeringType: type }]);
  });
});

describe('opening-day check: two list calls and nothing per row (§7.4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('with ONE row opening today on each list, the whole run (real fetchers + real writer) makes exactly 2 API calls', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u));
      if (u.includes('/api/ipo-current-issue')) {
        return new Response(JSON.stringify([{
          companyName: 'Moneyview Limited', issueStartDate: '24-Sep-2026', issueEndDate: '28-Sep-2026',
          issuePrice: 'Rs.100 to Rs.105', issueSize: '1000000', series: 'EQ', status: 'Active', symbol: 'MONEYVIEW',
        }]), { status: 200 });
      }
      if (u.includes('IPO_HomePageDetail')) return new Response(JSON.stringify({ Table: [BSE_ROW] }), { status: 200 });
      return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'nsit=1; Path=/' } });
    }));
    const h = harness(storedRow());
    const s = await runOpeningDayDiscovery(
      { fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard, storedOpeningOn: async () => [], writeRow: createOpeningDayWriter(h.collaborators as any) },
      new Date('2026-09-24T04:45:00Z')
    );
    expect(s.written.map((w) => w.source).sort()).toEqual(['BSE', 'NSE']);
    const apiCalls = calls.filter((u) => u.includes('/api/') || u.includes('BseIndiaAPI') || u.includes('bseindia'));
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls.filter((u) => u.includes('/api/ipo-current-issue'))).toHaveLength(1);
    expect(apiCalls.filter((u) => u.includes('IPO_HomePageDetail/w'))).toHaveLength(1);
  });
});
