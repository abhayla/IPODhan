/**
 * Item 1 slice s7a — the four whole-row-replace CALL SITES:
 * `promoters`, `ipo_risk_factors`, `ipo_intermediaries`, `peer_companies`.
 *
 * `promoter_acquisition_ranges` and `brlm_track_record` are NOT among item 1's
 * eight tables and keep their whole-row-replace behaviour untouched — asserted
 * here so a later slice cannot quietly pull them in.
 *
 * What is worth more than any test of the new path: with
 * `ENABLE_CHILD_TABLE_CONSOLIDATION` OFF each of the four repositories receives
 * exactly the rows it received before this slice, and the consolidator is never
 * touched. And with the flag ON — these four tables being single-source today,
 * so priority has nothing to resolve — the VALUES written are unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistFilingExtraction } from '../../../src/services/filing-persister.js';
import type { FilingPersisterDeps } from '../../../src/services/filing-persister.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';
import { headingHashForRiskFactor } from '@ipodhan/shared/utils/risk-factor-heading-key';

const IPO_ID = '11111111-2222-3333-4444-555555555555';

const f = (value: unknown) => ({ value, check: { passed: true } });

/** One extraction that fills all four tables at once. */
const EXTRACTION = {
  unit: 'MILLION',
  fields: {
    promoter_names: f(['Sunil Sharma', 'Kavita Rao']),
    promoter_waca: f(12.5),
    risk_factors: f([
      { heading: 'We depend on one customer', body: 'body one' },
      { heading: 'Our plants are concentrated in Raigad', body: 'body two' },
    ]),
    syndicate_members: f([
      { name: 'JM Financial Ltd', role: 'SYNDICATE' },
      { name: 'Anand Rathi Shares', role: 'SUB_SYNDICATE' },
    ]),
    peer_companies: f([
      { name: 'Alpha Industries Ltd', pe: 21.5, eps_basic: 4.2 },
      { name: 'Beta Chemicals Ltd', pe: 18.25, eps_basic: 3.1 },
    ]),
  },
} as never;

type Mocks = ReturnType<typeof makeDeps>;

function makeDeps(overrides: Partial<FilingPersisterDeps> = {}) {
  const replacePromoters = vi.fn(async () => undefined);
  const riskReplace = vi.fn(async () => undefined);
  const intermediariesReplace = vi.fn(async () => undefined);
  const peersReplace = vi.fn(async () => undefined);
  const replaceAcquisitionRanges = vi.fn(async () => undefined);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'S7A Fixture Ltd',
        status: 'OPEN',
        registrar: null,
      })),
    },
    financialStatements: { upsert: vi.fn(async () => undefined), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async () => undefined) },
    promoters: { replacePromoters, replaceAcquisitionRanges },
    riskFactors: { replaceForIpo: riskReplace },
    intermediaries: { replaceForIpo: intermediariesReplace },
    brlmTrackRecord: { upsert: vi.fn(async () => undefined) },
    peerCompanies: { replaceForIpo: peersReplace },
    financialData: { upsert: vi.fn(async () => undefined) },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: vi.fn(async () => undefined),
    },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    ...overrides,
  } as unknown as FilingPersisterDeps;
  return {
    deps,
    replacePromoters,
    riskReplace,
    intermediariesReplace,
    peersReplace,
    replaceAcquisitionRanges,
  };
}

/** A consolidator that echoes back exactly what it was handed. */
function echoConsolidator() {
  return vi.fn(async (_ipoId: string, _table: string, rows: { rowKey: string; data: Record<string, unknown> }[]) => ({
    rowsProcessed: rows.length,
    rowsUpdated: rows.length,
    rowsSkipped: 0,
    conflictsDetected: 0,
    rows: rows.map((r) => ({
      rowKey: r.rowKey,
      consolidatedData: { ...r.data },
      fieldsProcessed: Object.keys(r.data).length,
      fieldsUpdated: Object.keys(r.data).length,
      conflictsDetected: 0,
      skipped: false,
    })),
  }));
}

const run = (deps: FilingPersisterDeps) =>
  persistFilingExtraction(IPO_ID, EXTRACTION, { docType: 'RHP', apply: true }, deps);

function withFlag(value: boolean) {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as never as Record<string, unknown>).ENABLE_CHILD_TABLE_CONSOLIDATION = value;
  });
  afterEach(() => {
    (FEATURE_FLAGS as never as Record<string, unknown>).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });
}

/** The rows the repository received, whatever the flag. */
function repoRows(m: Mocks) {
  return {
    promoters: (m.replacePromoters.mock.calls[0]?.[1] ?? []) as Record<string, unknown>[],
    risk: (m.riskReplace.mock.calls[0]?.[1] ?? []) as Record<string, unknown>[],
    intermediaries: (m.intermediariesReplace.mock.calls[0]?.[1] ?? []) as Record<string, unknown>[],
    peers: (m.peersReplace.mock.calls[0]?.[1] ?? []) as Record<string, unknown>[],
  };
}

describe('s7a — flag OFF is byte-identical to the pre-slice write', () => {
  withFlag(false);

  it('never touches the consolidator, and each repository gets the pre-slice rows', async () => {
    const consolidate = vi.fn();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(m.deps);

    expect(consolidate).not.toHaveBeenCalled();

    const rows = repoRows(m);
    expect(rows.promoters.map((r) => r.name)).toEqual(['Sunil Sharma', 'Kavita Rao']);
    expect(rows.promoters.map((r) => r.normalizedName)).toEqual([
      rowKeyForName('Sunil Sharma'),
      rowKeyForName('Kavita Rao'),
    ]);
    expect(rows.risk.map((r) => r.heading)).toEqual([
      'We depend on one customer',
      'Our plants are concentrated in Raigad',
    ]);
    expect(rows.intermediaries.map((r) => `${r.role}:${r.name}`)).toEqual([
      'SYNDICATE:JM Financial Ltd',
      'SUB_SYNDICATE:Anand Rathi Shares',
    ]);
    expect(rows.peers.map((r) => [r.companyName, r.peRatio])).toEqual([
      ['Alpha Industries Ltd', '21.5'],
      ['Beta Chemicals Ltd', '18.25'],
    ]);
  });
});

describe('s7a — flag ON routes each table through the consolidator', () => {
  withFlag(true);

  it('calls the consolidator once per table with that table\'s verified row key', async () => {
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(m.deps);

    const byTable = new Map<string, { rowKey: string; data: Record<string, unknown> }[]>();
    for (const call of consolidate.mock.calls) {
      byTable.set(call[1] as string, call[2] as never);
    }

    // promoters -> rowKeyForName(name)
    expect(byTable.get('promoters')?.map((r) => r.rowKey)).toEqual([
      rowKeyForName('Sunil Sharma'),
      rowKeyForName('Kavita Rao'),
    ]);
    // ipo_intermediaries -> role + rowKeyForName(name)
    expect(byTable.get('ipo_intermediaries')?.map((r) => r.rowKey)).toEqual([
      `SYNDICATE:${rowKeyForName('JM Financial Ltd')}`,
      `SUB_SYNDICATE:${rowKeyForName('Anand Rathi Shares')}`,
    ]);
    // peer_companies -> rowKeyForName(companyName)
    expect(byTable.get('peer_companies')?.map((r) => r.rowKey)).toEqual([
      rowKeyForName('Alpha Industries Ltd'),
      rowKeyForName('Beta Chemicals Ltd'),
    ]);
    // ipo_risk_factors -> headingHashForRiskFactor(heading), NOT seq
    expect(byTable.get('ipo_risk_factors')?.map((r) => r.rowKey)).toEqual([
      headingHashForRiskFactor('We depend on one customer'),
      headingHashForRiskFactor('Our plants are concentrated in Raigad'),
    ]);

    // The docType and source travel with every call.
    for (const call of consolidate.mock.calls) {
      expect(call[0]).toBe(IPO_ID);
      expect(call[3]).toBe('DRHP');
      expect(call[4]).toBe('RHP');
    }
  });

  it('two rows of one table produce two DISTINCT row keys — the point of the widened key', async () => {
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(m.deps);

    for (const table of ['promoters', 'ipo_risk_factors', 'ipo_intermediaries', 'peer_companies']) {
      const call = consolidate.mock.calls.find((c) => c[1] === table);
      const keys = (call?.[2] as { rowKey: string }[]).map((r) => r.rowKey);
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);
    }
  });

  it('offers every non-identity field for provenance, per row', async () => {
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(m.deps);

    const promoterRows = consolidate.mock.calls.find((c) => c[1] === 'promoters')?.[2] as {
      data: Record<string, unknown>;
    }[];
    expect(Object.keys(promoterRows[0].data).sort()).toEqual(
      ['isPromoterGroup', 'name', 'sharesHeld', 'waca', 'wacaLastYear'].sort()
    );

    const peerRows = consolidate.mock.calls.find((c) => c[1] === 'peer_companies')?.[2] as {
      data: Record<string, unknown>;
    }[];
    expect(peerRows[0].data).toMatchObject({ companyName: 'Alpha Industries Ltd', peRatio: '21.5' });
  });

  it('writes the SAME values as the flag-OFF path — single-source, nothing to resolve', async () => {
    const consolidate = echoConsolidator();
    const on = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(on.deps);
    const onRows = repoRows(on);

    (FEATURE_FLAGS as never as Record<string, unknown>).ENABLE_CHILD_TABLE_CONSOLIDATION = false;
    const off = makeDeps();
    await run(off.deps);
    const offRows = repoRows(off);

    expect(onRows.promoters).toEqual(offRows.promoters);
    expect(onRows.risk).toEqual(offRows.risk);
    expect(onRows.intermediaries).toEqual(offRows.intermediaries);
    // `lastUpdated` is `new Date()` at write time - a clock reading, not a value
    // either path decided.
    const stripClock = (rows: Record<string, unknown>[]) =>
      rows.map(({ lastUpdated, ...rest }) => rest);
    expect(stripClock(onRows.peers)).toEqual(stripClock(offRows.peers));
  });

  it('the RESOLVED value is what reaches the repository (waca), and identity fields are never overwritten', async () => {
    const consolidate = vi.fn(
      async (_i: string, table: string, rows: { rowKey: string; data: Record<string, unknown> }[]) => ({
        rowsProcessed: rows.length,
        rowsUpdated: rows.length,
        rowsSkipped: 0,
        conflictsDetected: 0,
        rows: rows.map((r) => ({
          rowKey: r.rowKey,
          consolidatedData:
            table === 'promoters'
              ? { ...r.data, waca: '99.99', name: 'RESOLVER TRIED TO RENAME ME' }
              : { ...r.data },
          fieldsProcessed: 1,
          fieldsUpdated: 1,
          conflictsDetected: 0,
          skipped: false,
        })),
      })
    );
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await run(m.deps);

    const promoters = repoRows(m).promoters;
    expect(promoters.map((r) => r.waca)).toEqual(['99.99', '99.99']);
    // `name` is half the row's identity — resolving it would desync the row
    // from the key its provenance was filed under.
    expect(promoters.map((r) => r.name)).toEqual(['Sunil Sharma', 'Kavita Rao']);
    expect(promoters.map((r) => r.normalizedName)).toEqual([
      rowKeyForName('Sunil Sharma'),
      rowKeyForName('Kavita Rao'),
    ]);
  });

  it('a consolidator-skipped row is still WRITTEN, unresolved, with the reason recorded', async () => {
    const consolidate = vi.fn(
      async (_i: string, _t: string, rows: { rowKey: string; data: Record<string, unknown> }[]) => ({
        rowsProcessed: 0,
        rowsUpdated: 0,
        rowsSkipped: rows.length,
        conflictsDetected: 0,
        rows: rows.map((r) => ({
          rowKey: r.rowKey,
          consolidatedData: {},
          fieldsProcessed: 0,
          fieldsUpdated: 0,
          conflictsDetected: 0,
          skipped: true,
          skipReason: 'MISSING_ROW_KEY' as const,
        })),
      })
    );
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    const summary = await run(m.deps);

    // Losing provenance must never cost the row: a whole-set replace that drops
    // a promoter deletes it from the live page.
    expect(repoRows(m).promoters.map((r) => r.name)).toEqual(['Sunil Sharma', 'Kavita Rao']);
    // NAMED, never counted (signal-ownership R1): the row key is on the line.
    expect(summary.unresolved_child_rows).toEqual(
      expect.arrayContaining([
        `promoters ${rowKeyForName('Sunil Sharma')} (consolidation skipped: MISSING_ROW_KEY)`,
        `promoters ${rowKeyForName('Kavita Rao')} (consolidation skipped: MISSING_ROW_KEY)`,
      ])
    );
  });

  it('falls back to the unresolved write when no consolidator is injected, naming every row', async () => {
    const m = makeDeps();
    const summary = await run(m.deps);
    expect(repoRows(m).promoters).toHaveLength(2);
    expect(repoRows(m).peers).toHaveLength(2);

    // Every one of the eight rows across the four tables is named with its own
    // row key — an unresolved row has NO field_sources entry, so a count here
    // would leave nothing to act on.
    expect(summary.unresolved_child_rows).toHaveLength(8);
    expect(summary.unresolved_child_rows).toEqual(
      expect.arrayContaining([
        `promoters ${rowKeyForName('Sunil Sharma')} (no childRowConsolidator injected)`,
        `peer_companies ${rowKeyForName('Beta Chemicals Ltd')} (no childRowConsolidator injected)`,
        `ipo_intermediaries SYNDICATE:${rowKeyForName('JM Financial Ltd')} (no childRowConsolidator injected)`,
        `ipo_risk_factors ${headingHashForRiskFactor('We depend on one customer')} (no childRowConsolidator injected)`,
      ])
    );
  });

  it('a consolidation that THROWS names every row it wrote unresolved', async () => {
    const boom = new Error('field_sources unreachable');
    (boom as { cause?: unknown }).cause = new Error('ECONNREFUSED 127.0.0.1:5432');
    const consolidate = vi.fn(async () => {
      throw boom;
    });
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    const summary = await run(m.deps);

    expect(repoRows(m).promoters).toHaveLength(2);
    const named = (summary.unresolved_child_rows ?? []).filter((l) => l.startsWith('promoters '));
    expect(named).toHaveLength(2);
    // The cause travels with the reason (signal-ownership R6).
    expect(named[0]).toContain('field_sources unreachable');
    expect(named[0]).toContain('ECONNREFUSED');
  });

  it('a punctuation-only promoter is keyed by rowKeyForName, not the bare normaliser', async () => {
    // `normalizeCompanyNameForMatching('...')` is '' — the reserved SINGLETON
    // sentinel. Keying on the inner function would file this row's provenance
    // under a key the audit cannot match, and collide it with every other junk
    // name on the IPO. `rowKeyForName` mints `junk:<sha1>` instead.
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await persistFilingExtraction(
      IPO_ID,
      { unit: 'MILLION', fields: { promoter_names: f(['...', 'Kavita Rao']) } } as never,
      { docType: 'RHP', apply: true },
      m.deps
    );

    const keys = (consolidate.mock.calls.find((c) => c[1] === 'promoters')?.[2] as {
      rowKey: string;
    }[]).map((r) => r.rowKey);
    expect(keys[0]).toBe(rowKeyForName('...'));
    expect(keys[0]).toMatch(/^junk:/);
    expect(keys[0]).not.toBe('');
  });

  it('a no-identity name is dropped before the consolidator ever sees it', async () => {
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await persistFilingExtraction(
      IPO_ID,
      {
        unit: 'MILLION',
        fields: { promoter_names: f(['   ', 'Kavita Rao']) },
      } as never,
      { docType: 'RHP', apply: true },
      m.deps
    );

    expect(rowKeyForName('   ')).toBeNull();
    const promoterCall = consolidate.mock.calls.find((c) => c[1] === 'promoters');
    expect((promoterCall?.[2] as { rowKey: string }[]).map((r) => r.rowKey)).toEqual([
      rowKeyForName('Kavita Rao'),
    ]);
    expect(repoRows(m).promoters.map((r) => r.name)).toEqual(['Kavita Rao']);
  });
});

describe('s7a — the two tables item 1 does NOT own stay off the consolidated path', () => {
  withFlag(true);

  it('promoter_acquisition_ranges and brlm_track_record are never sent to the consolidator', async () => {
    const consolidate = echoConsolidator();
    const m = makeDeps({ childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never });
    await persistFilingExtraction(
      IPO_ID,
      {
        unit: 'MILLION',
        fields: {
          promoter_names: f(['Sunil Sharma']),
          promoter_waca_3y: f(9.5),
          rhp_filing_date: f('2026-01-10'),
        },
      } as never,
      { docType: 'RHP', apply: true },
      m.deps
    );

    const tables = consolidate.mock.calls.map((c) => c[1]);
    expect(tables).not.toContain('promoter_acquisition_ranges');
    expect(tables).not.toContain('brlm_track_record');
  });
});
