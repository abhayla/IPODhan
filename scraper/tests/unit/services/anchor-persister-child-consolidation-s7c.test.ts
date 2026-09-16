/**
 * Item 1 slice s7c — `anchor_investors`, the eighth and last child table of the
 * item-1 contract, onto `consolidatedUpsertChildRows`.
 *
 * The valuable half of this file is the flag-OFF half: with
 * `ENABLE_CHILD_TABLE_CONSOLIDATION` off, `persistAnchorReport` must write
 * exactly the row it wrote before this slice and must never touch the
 * consolidator. The flag-ON half proves the row is keyed with the singleton
 * sentinel (`anchor_investors` declares NO unique constraint; `''` is the
 * identity its writer actually uses — see `anchorInvestorsRowKey`), that the
 * WRITTEN VALUES ARE UNMOVED by consolidation (this row's columns are one
 * arithmetic unit, so no column is merged back in isolation), and that every
 * failure mode still WRITES the anchor row while filing an `unresolved:` marker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/services/data-persister.js', () => ({
  createAnchorInvestors: vi.fn(async () => 'anchor-row-id'),
}));
vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordLiveStep: vi.fn(async () => undefined),
}));

import { persistAnchorReport, type AnchorPersisterDeps } from '../../../src/services/anchor-persister';
import { anchorInvestorsRowKey } from '../../../src/services/child-row-keys';
import { UNRESOLVED_ROW_KEY_PREFIX } from '../../../src/services/child-row-unresolved-noter';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags';
import type { AnchorInvestorData } from '../../../src/scrapers/anchor-investors-scraper';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';
const COMPANY = 'Deepa Jewellers Limited';

const BID = new Date(Date.UTC(2026, 7, 31));
const LOCK50 = new Date(Date.UTC(2026, 8, 30));
const LOCKREST = new Date(Date.UTC(2026, 10, 29));

/** Three rows whose shares and amounts reconcile with the printed totals. */
function anchorFixture(): AnchorInvestorData {
  const rows = [
    { name: 'ICICI Prudential Mutual Fund', type: 'Mutual Fund', shares: 600000, amount: 10.62 },
    { name: 'SBI Mutual Fund', type: 'Mutual Fund', shares: 300000, amount: 5.31 },
    { name: 'HDFC Mutual Fund', type: 'Mutual Fund', shares: 100000, amount: 1.77 },
  ];
  const totalShares = rows.reduce((t, r) => t + r.shares, 0);
  const totalAmount = Number(rows.reduce((t, r) => t + r.amount, 0).toFixed(4));
  return {
    bidDate: BID,
    totalSharesOffered: totalShares,
    totalAmountRaised: totalAmount,
    anchorInvestorsCount: rows.length,
    printedTotalShares: totalShares,
    printedTotalAmountRaised: totalAmount,
    printedCount: rows.length,
    percentageCheckPassed: true,
    sharesTimesPriceCheckPassed: true,
    lockIn50PercentDate: LOCK50,
    lockInRemainingDate: LOCKREST,
    investorList: rows.map((r) => ({
      ...r,
      percentOfIssue: Number(((r.shares / totalShares) * 100).toFixed(4)),
    })),
  } as AnchorInvestorData;
}

/** One resolved row, shaped like `ConsolidatedChildRowsResult`. */
const resolvedRow = (rowKey: string, consolidatedData: Record<string, unknown>) => ({
  rowsProcessed: 1,
  rowsUpdated: 1,
  rowsSkipped: 0,
  conflictsDetected: 0,
  rows: [
    {
      rowKey,
      consolidatedData,
      fieldsProcessed: Object.keys(consolidatedData).length,
      fieldsUpdated: Object.keys(consolidatedData).length,
      conflictsDetected: 0,
      skipped: false,
    },
  ],
});

function makeDeps(overrides: Partial<AnchorPersisterDeps> = {}) {
  const persist = vi.fn(async () => 'anchor-row-id');
  const consolidatedUpsertChildRows = vi.fn(async () => resolvedRow(anchorInvestorsRowKey(), {}));
  const trackFieldUpdate = vi.fn(async () => undefined);
  const deps = {
    scrapeAnchorReport: vi.fn(async () => anchorFixture()),
    anchorInvestorRepository: { findByIPOId: vi.fn(), create: vi.fn(), update: vi.fn() },
    ipoRepository: { findById: vi.fn(async () => ({ companyName: COMPANY, scraperLocked: false })) },
    persist,
    childRowConsolidator: { consolidatedUpsertChildRows },
    fieldSources: { trackFieldUpdate },
    ...overrides,
  } as unknown as AnchorPersisterDeps;
  return { deps, persist, consolidatedUpsertChildRows, trackFieldUpdate };
}

/** The payload the repository write actually received. */
function writtenPayload(persist: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = persist.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>];
  return call[2];
}

describe('anchor_investors row key', () => {
  it('is the singleton sentinel, because the writer resolves the row by ipo_id alone', () => {
    expect(anchorInvestorsRowKey()).toBe('');
  });
});

describe('s7c — flag OFF is byte-identical to the pre-s7c write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (FEATURE_FLAGS as { ENABLE_CHILD_TABLE_CONSOLIDATION: boolean }).ENABLE_CHILD_TABLE_CONSOLIDATION =
      false;
  });

  it('never calls the consolidator and writes the extraction values', async () => {
    const { deps, persist, consolidatedUpsertChildRows, trackFieldUpdate } = makeDeps();
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(summary.written).toBe(1);
    expect(consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(trackFieldUpdate).not.toHaveBeenCalled();
    expect(summary.unresolvedChildRows).toBeUndefined();

    const payload = writtenPayload(persist);
    expect(payload.totalSharesOffered).toBe(1_000_000);
    expect(payload.anchorInvestorsCount).toBe(3);
    expect(payload.investorList).toHaveLength(3);
  });
});

describe('s7c — flag ON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (FEATURE_FLAGS as { ENABLE_CHILD_TABLE_CONSOLIDATION: boolean }).ENABLE_CHILD_TABLE_CONSOLIDATION =
      true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as { ENABLE_CHILD_TABLE_CONSOLIDATION: boolean }).ENABLE_CHILD_TABLE_CONSOLIDATION =
      false;
  });

  it('sends every column of the anchor row under the singleton row key', async () => {
    const { deps, consolidatedUpsertChildRows } = makeDeps();
    await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(consolidatedUpsertChildRows).toHaveBeenCalledTimes(1);
    const [ipoId, tableName, rows, source, docType] = consolidatedUpsertChildRows.mock
      .calls[0] as unknown as [string, string, { rowKey: string; data: Record<string, unknown> }[], string, string];
    expect(ipoId).toBe(IPO_ID);
    expect(tableName).toBe('anchor_investors');
    expect(source).toBe('DRHP');
    expect(docType).toBe('ANCHOR_ALLOCATION_REPORT');
    expect(rows).toHaveLength(1);
    expect(rows[0].rowKey).toBe('');
    expect(Object.keys(rows[0].data).sort()).toEqual([
      'anchorInvestorsCount',
      'bidDate',
      'investorList',
      'lockIn50PercentDate',
      'lockInRemainingDate',
      'totalAmountRaised',
      'totalSharesOffered',
    ]);
  });

  it('leaves the written values UNMOVED even when the consolidator resolves others', async () => {
    // A resolver that hands back a DIFFERENT total for every arithmetic column.
    // Merging any one of them back would publish a row whose investor rows no
    // longer sum to its totals, so none of them is merged back.
    const { deps, persist } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async () =>
          resolvedRow('', {
            totalSharesOffered: 42,
            totalAmountRaised: 9.99,
            anchorInvestorsCount: 99,
            bidDate: new Date(Date.UTC(1999, 0, 1)),
            investorList: [],
          })
        ),
      },
    } as unknown as Partial<AnchorPersisterDeps>);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(summary.written).toBe(1);

    const payload = writtenPayload(persist);
    expect(payload.totalSharesOffered).toBe(1_000_000);
    expect(payload.totalAmountRaised).toBeCloseTo(17.7, 4);
    expect(payload.anchorInvestorsCount).toBe(3);
    expect(payload.bidDate).toBe(BID);
    expect(payload.investorList).toHaveLength(3);
  });

  it('still WRITES the row when no consolidator was injected, and marks it unresolved', async () => {
    const { deps, persist, trackFieldUpdate } = makeDeps({
      childRowConsolidator: undefined,
    } as unknown as Partial<AnchorPersisterDeps>);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.written).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(writtenPayload(persist).investorList).toHaveLength(3);
    expect(summary.unresolvedChildRows).toEqual([
      'anchor_investors  (no childRowConsolidator injected)',
    ]);

    expect(trackFieldUpdate).toHaveBeenCalledTimes(1);
    const marker = trackFieldUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(marker.tableName).toBe('anchor_investors');
    expect(String(marker.rowKey)).toBe(`${UNRESOLVED_ROW_KEY_PREFIX}no-consolidator-injected`);
    expect(marker.updatedBy).toBe('ANCHOR_PERSISTER');
    expect(marker.confidence).toBe(0);
  });

  it('still WRITES the row when the consolidator throws, recording the cause', async () => {
    const boom = new Error('redis down');
    (boom as { cause?: unknown }).cause = new Error('ECONNREFUSED');
    const { deps, persist, trackFieldUpdate } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async () => {
          throw boom;
        }),
      },
    } as unknown as Partial<AnchorPersisterDeps>);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.written).toBe(1);
    expect(writtenPayload(persist).investorList).toHaveLength(3);
    expect(summary.unresolvedChildRows?.[0]).toContain('redis down <- ECONNREFUSED');

    const marker = trackFieldUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(String(marker.rowKey)).toContain('consolidation-threw: redis down <- ECONNREFUSED');
    const lineage = marker.dataLineage as Record<string, unknown>;
    expect(lineage.docType).toBe('ANCHOR_ALLOCATION_REPORT');
  });

  it('still WRITES the row when the consolidator SKIPS it', async () => {
    const { deps, persist, trackFieldUpdate } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async () => ({
          rowsProcessed: 0,
          rowsUpdated: 0,
          rowsSkipped: 1,
          conflictsDetected: 0,
          rows: [
            {
              rowKey: '',
              consolidatedData: {},
              fieldsProcessed: 0,
              fieldsUpdated: 0,
              conflictsDetected: 0,
              skipped: true,
              skipReason: 'CHILD_TABLE_CONSOLIDATION_DISABLED',
            },
          ],
        })),
      },
    } as unknown as Partial<AnchorPersisterDeps>);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.written).toBe(1);
    expect(writtenPayload(persist).investorList).toHaveLength(3);
    expect(summary.unresolvedChildRows?.[0]).toContain(
      'consolidation skipped: CHILD_TABLE_CONSOLIDATION_DISABLED'
    );
    expect(String(trackFieldUpdate.mock.calls[0][0].rowKey)).toContain(
      'consolidation-skipped: CHILD_TABLE_CONSOLIDATION_DISABLED'
    );
  });

  it('does not consolidate on a dry run — nothing was written to have provenance about', async () => {
    const { deps, persist, consolidatedUpsertChildRows, trackFieldUpdate } = makeDeps();
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: false }, deps);

    expect(summary.applied).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(trackFieldUpdate).not.toHaveBeenCalled();
  });

  it('does not consolidate a REFUSED write — a refused run writes no row', async () => {
    const broken = anchorFixture();
    // The printed total disagrees with the summed rows: the arithmetic gate
    // refuses the whole filing, so there is no row to file provenance for.
    (broken as { printedTotalShares: number }).printedTotalShares = 12345;
    const { deps, persist, consolidatedUpsertChildRows } = makeDeps({
      scrapeAnchorReport: vi.fn(async () => broken),
    } as unknown as Partial<AnchorPersisterDeps>);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedKind).toBe('arithmetic');
    expect(persist).not.toHaveBeenCalled();
    expect(consolidatedUpsertChildRows).not.toHaveBeenCalled();
  });
});

/**
 * DETECTION UPGRADE (the check that should have caught this slice's existence).
 *
 * `anchor_investors` sat in the `ChildConsolidationTable` union — item 1's
 * stated eight-table contract — for seven slices with NO call site anywhere,
 * and nothing said so: every test asserted about the tables that WERE routed.
 * A table listed in the contract but never passed to the consolidator is the
 * class, and this reads the source for it rather than trusting a list someone
 * remembers to update.
 */
describe('every item-1 child table has a consolidator call site', () => {
  const readSource = async (rel: string) => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    return readFile(join(here, '../../../src/services', rel), 'utf8');
  };

  it('routes all eight, so a contract table with no writer fails here', async () => {
    const orchestrator = await readSource('data-consolidation-orchestrator.ts');
    const union = orchestrator.slice(
      orchestrator.indexOf('export type ChildConsolidationTable'),
      orchestrator.indexOf(';', orchestrator.indexOf('export type ChildConsolidationTable'))
    );
    const contractTables = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    // Positive control: the union parse itself must find eight names, or the
    // "every table is routed" verdict below would be vacuously true.
    expect(contractTables).toHaveLength(8);
    expect(contractTables).toContain('anchor_investors');

    const callSites = [
      await readSource('filing-persister.ts'),
      await readSource('anchor-persister.ts'),
    ].join('\n');
    // Both shapes: `consolidateChildRows('table'` (the multi-row helper) and
    // `consolidatedUpsertChildRows(ipoId, 'table'` (the singleton call sites).
    const routed = new Set(
      [
        ...callSites.matchAll(/consolidateChildRows\(\s*'([a-z_]+)'/g),
        ...callSites.matchAll(/consolidatedUpsertChildRows\(\s*\w+,\s*'([a-z_]+)'/g),
      ].map((m) => m[1])
    );

    const unrouted = contractTables.filter((t) => !routed.has(t));
    expect(unrouted).toEqual([]);
  });
});
