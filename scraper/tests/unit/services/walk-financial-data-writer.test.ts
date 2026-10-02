// implements: F-233 -- the field-plan walk's consolidated writer for financial_data (one row per IPO).
// Spec: data-sourcing-pull-model.md OD-73 (rank decides; identical value never re-stamped), Appendix A
// financial_data rows (DOC above CHITTORGARH), §2.7 (an ADMIN-held value is never written), #684 (a
// field_sources row only when a source supplied the stored value), OD-160 (clear list).
//
// The walk sends an IPO-level financial_data answer with row key '' (the table's real identity:
// financial_data.ipo_id is UNIQUE). Before this change the writer refused every one of them as
// MISSING_ROW_KEY, so a Chittorgarh answer for an empty field was recorded and never reached the page.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import { SINGLETON_ROW_CHILD_TABLES } from '../../../src/services/consolidated-writer-capability.js';
import { CHILD_ROW_TABLES } from '../../../../packages/shared/src/repositories/child-row-field-writer';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';
import {
  FILING_CLEARABLE_COLUMNS,
  NOT_ONE_TO_ONE_COLUMNS,
  WALK_ONLY_FINANCIAL_DATA_COLUMNS,
} from '../../../src/services/filing-clearable-columns.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

const IPO_ID = '22222222-3333-4444-5555-666666666666';

class FakeFieldSources {
  rows = new Map<string, any>();
  private key(r: any) {
    return `${r.ipoId}|${r.tableName}|${r.rowKey ?? ''}|${r.fieldName}`;
  }
  async findByIPOId(ipoId: string) {
    return [...this.rows.values()].filter((r) => r.ipoId === ipoId);
  }
  async findByField(ipoId: string, tableName: string, fieldName: string, rowKey = '') {
    return this.rows.get(`${ipoId}|${tableName}|${rowKey}|${fieldName}`) ?? null;
  }
  async trackFieldUpdate(input: any) {
    const existing = this.rows.get(this.key(input));
    this.rows.set(this.key(input), {
      ...existing,
      ...input,
      rowKey: input.rowKey ?? '',
      value: input.value ?? existing?.value ?? null,
      updatedAt: new Date(),
    });
    return this.rows.get(this.key(input));
  }
}

class FakeConflicts {
  logged: any[] = [];
  async findByIPOId() {
    return [];
  }
  async create(row: any) {
    this.logged.push(row);
    return row;
  }
  async logConflict(row: any) {
    this.logged.push(row);
    return row;
  }
  async upsertConflict(row: any) {
    this.logged.push(row);
    return row;
  }
  async findOpenConflicts() {
    return [];
  }
  async autoResolveConverged() {
    return 0;
  }
  async resolveConflict() {
    return null;
  }
}

/**
 * The financial_data row as the shared child-row writer sees it: one row per IPO (or none), plus the
 * admin-held column set. Mirrors probeChildRow / writeChildRowFields' contract, including `existing`.
 */
class FakeFinancialDataRows {
  rows: Array<Record<string, unknown>> = [];
  held = new Set<string>();
  writes: Array<Record<string, unknown>> = [];
  async probeChildRow(tableName: string, ipoId: string, rowKey: string, fields: readonly string[]) {
    if (tableName !== 'financial_data') return { writable: false, reason: 'UNKNOWN_CHILD_TABLE' };
    if (rowKey !== '') return { writable: false, reason: 'MALFORMED_ROW_KEY' };
    const heldHit = fields.filter((f) => this.held.has(f));
    if (heldHit.length > 0) return { writable: false, reason: 'CHILD_FIELD_HELD', detail: heldHit.join(',') };
    const mine = this.rows.filter((r) => r.ipoId === ipoId);
    if (mine.length > 1) return { writable: false, reason: 'CHILD_ROW_AMBIGUOUS', detail: String(mine.length) };
    if (mine.length === 0) return { writable: true, exists: false };
    return { writable: true, exists: true, existing: Object.fromEntries(fields.map((f) => [f, mine[0][f] ?? null])) };
  }
  async writeChildRowFields(_t: string, ipoId: string, _k: string, values: Record<string, unknown>) {
    this.writes.push(values);
    const row = this.rows.find((r) => r.ipoId === ipoId);
    if (row) Object.assign(row, values);
    else this.rows.push({ ipoId, ...values });
    return { written: true, mode: row ? 'UPDATE' : 'INSERT', dropped: [] };
  }
}

function make() {
  const fieldSources = new FakeFieldSources();
  const conflicts = new FakeConflicts();
  const repo = new FakeFinancialDataRows();
  const orchestrator = new DataConsolidationOrchestrator(repo as never, fieldSources as never, conflicts as never, null);
  const provenance = (field: string) =>
    [...fieldSources.rows.values()].find((r) => r.tableName === 'financial_data' && r.rowKey === '' && r.fieldName === field);
  const write = (field: string, value: unknown, source: 'CHITTORGARH' | 'DRHP' | 'NSE') =>
    orchestrator.consolidatedUpsertChildRows(IPO_ID, 'financial_data' as never, [{ rowKey: '', data: { [field]: value } }], source, undefined, undefined, {
      writeRow: true,
    });
  return { orchestrator, fieldSources, conflicts, repo, provenance, write };
}

describe('F-233: walk writes financial_data (one row per IPO) through the consolidated child writer', () => {
  const saved = {
    child: FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION,
    cons: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    track: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
    pct: FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE,
    conflicts: FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION,
  };
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = 100;
    (FEATURE_FLAGS as any).ENABLE_CONFLICT_DETECTION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = saved.child;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = saved.cons;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = saved.track;
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = saved.pct;
    (FEATURE_FLAGS as any).ENABLE_CONFLICT_DETECTION = saved.conflicts;
  });

  it('written: a CHITTORGARH answer for an EMPTY field (no row yet) creates the row by ipo_id and files its provenance', async () => {
    const { repo, provenance, write } = make();
    const r = await write('marketCap', 4507.61, 'CHITTORGARH');
    expect(r.rows[0].skipped).toBe(false);
    expect(r.rows[0].rowWrite).toMatchObject({ written: true, mode: 'INSERT' });
    // Units: the writer stores exactly what the fetcher supplied (crore) -- no conversion here.
    expect(repo.rows).toEqual([{ ipoId: IPO_ID, marketCap: 4507.61 }]);
    expect(provenance('marketCap')).toMatchObject({ source: 'CHITTORGARH', rowKey: '' });
  });

  it('written: an existing row with the field empty is UPDATED, other columns untouched', async () => {
    const { repo, provenance, write } = make();
    repo.rows.push({ ipoId: IPO_ID, netWorth: '700.00', roe: null });
    const r = await write('roe', 27.24, 'CHITTORGARH');
    expect(r.rows[0].rowWrite).toMatchObject({ written: true, mode: 'UPDATE' });
    expect(repo.rows).toEqual([{ ipoId: IPO_ID, netWorth: '700.00', roe: 27.24 }]);
    expect(provenance('roe').source).toBe('CHITTORGARH');
  });

  it('witness only: a DOC (DRHP) value already stored is NOT replaced by a different CHITTORGARH value', async () => {
    const { repo, provenance, write } = make();
    await write('netWorth', '768.20', 'DRHP');
    expect(provenance('netWorth').source).toBe('DRHP');
    const r = await write('netWorth', '999.99', 'CHITTORGARH');
    expect(repo.rows[0].netWorth).toBe('768.20');
    expect(provenance('netWorth').source).toBe('DRHP');
    const fr = r.rows[0].fieldResults?.find((f) => f.fieldName === 'netWorth');
    expect(fr?.chosenSource).toBe('DRHP');
  });

  it('witness only: a value stored with NO provenance row is never silently treated as empty (the stored value travels to the consolidator)', async () => {
    const { repo, write } = make();
    repo.rows.push({ ipoId: IPO_ID, totalAssets: '10254.50' });
    const r = await write('totalAssets', '10254.50', 'CHITTORGARH');
    const fr = r.rows[0].fieldResults?.find((f) => f.fieldName === 'totalAssets');
    // Identical value: confirmed, not a new value (OD-73 identical-value rule).
    expect(fr?.conflictReason).toBe('CONFIRMED_UNTRACKED');
    expect(repo.rows[0].totalAssets).toBe('10254.50');
  });

  it('witness only: a DIFFERENT value from a non-rank-1 source never replaces a stored value with no provenance row (owner unknown), and is listed for the admin (OD-168)', async () => {
    const { orchestrator, repo, fieldSources, conflicts } = make();
    repo.rows.push({ ipoId: IPO_ID, netWorth: '768.20' });
    const r = await orchestrator.consolidatedUpsertChildRows(IPO_ID, 'financial_data' as never, [{ rowKey: '', data: { netWorth: '999.99' } }], 'CHITTORGARH', undefined, undefined, {
      writeRow: true,
      keepUntrackedStoredValue: true,
    });
    const fr = r.rows[0].fieldResults?.find((f) => f.fieldName === 'netWorth');
    expect(fr?.rejectedSources?.[0]?.reason).toBe('UNTRACKED_EXISTING_VALUE_KEPT');
    expect(repo.rows[0].netWorth).toBe('768.20');
    expect([...fieldSources.rows.values()].filter((x) => x.fieldName === 'netWorth')).toEqual([]);
    expect(conflicts.logged).toMatchObject([
      { tableName: 'financial_data', rowKey: '', fieldName: 'netWorth', value1: '768.20', value2: '999.99', source2: 'CHITTORGARH', resolutionReason: 'UNTRACKED_STORED_VALUE_DIFFERS' },
    ]);
  });

  it('credited equal: the same value from the source that already holds it is not re-written as a change', async () => {
    const { repo, write } = make();
    await write('ebitdaFy2024', '201.73', 'CHITTORGARH');
    const r = await write('ebitdaFy2024', '201.73', 'CHITTORGARH');
    expect(r.rows[0].fieldsUpdated).toBe(0);
    expect(repo.rows[0].ebitdaFy2024).toBe('201.73');
  });

  it('refused: an ADMIN-held field is refused before any provenance is filed', async () => {
    const { repo, fieldSources, write } = make();
    repo.held.add('marketCap');
    const r = await write('marketCap', 4507.61, 'CHITTORGARH');
    expect(r.rows[0]).toMatchObject({ skipped: true, skipReason: 'CHILD_FIELD_HELD' });
    expect(fieldSources.rows.size).toBe(0);
    expect(repo.rows).toEqual([]);
  });

  it('refused (fail closed): two financial_data rows for one IPO -> CHILD_ROW_AMBIGUOUS, nothing filed', async () => {
    const { repo, fieldSources, write } = make();
    repo.rows.push({ ipoId: IPO_ID }, { ipoId: IPO_ID });
    const r = await write('roe', 27.24, 'CHITTORGARH');
    expect(r.rows[0]).toMatchObject({ skipped: true, skipReason: 'CHILD_ROW_AMBIGUOUS' });
    expect(fieldSources.rows.size).toBe(0);
  });

  it('refused: a non-empty row key on financial_data is malformed (the table has no second key column)', async () => {
    const { orchestrator, fieldSources } = make();
    const r = await orchestrator.consolidatedUpsertChildRows(IPO_ID, 'financial_data' as never, [{ rowKey: '2024', data: { roe: 1 } }], 'CHITTORGARH', undefined, undefined, {
      writeRow: true,
    });
    expect(r.rows[0]).toMatchObject({ skipped: true, skipReason: 'MALFORMED_ROW_KEY' });
    expect(fieldSources.rows.size).toBe(0);
  });
});

describe('F-233 / OD-168 round 2: the stored-value pass-through is financial_data only', () => {
  const saved = {
    child: FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION,
    cons: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    track: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
    pct: FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE,
  };
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = 100;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = saved.child;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = saved.cons;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = saved.track;
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = saved.pct;
  });

  it('ipo_details: an untracked stored value is NOT handed to the consolidator (input as on main), so the incoming value is decided as before', async () => {
    // ipo_details row holding issueType with no field_sources row; the probe reports it (as the shared
    // writer now does for every table). CHITTORGARH is issueType's worst-ranked source, so if the stored
    // value leaked into the consolidator the M-1 rule would KEEP it -- on main the value is written.
    const rows: Record<string, unknown>[] = [{ ipoId: IPO_ID, issueType: 'FIXED_PRICE' }];
    const repo = {
      async probeChildRow(_t: string, _i: string, _k: string, fields: readonly string[]) {
        return { writable: true, exists: true, existing: Object.fromEntries(fields.map((f) => [f, rows[0][f] ?? null])) };
      },
      async writeChildRowFields(_t: string, _i: string, _k: string, values: Record<string, unknown>) {
        Object.assign(rows[0], values);
        return { written: true, mode: 'UPDATE', dropped: [] };
      },
    };
    const orchestrator = new DataConsolidationOrchestrator(repo as never, new FakeFieldSources() as never, new FakeConflicts() as never, null);
    const r = await orchestrator.consolidatedUpsertChildRows(IPO_ID, 'ipo_details', [{ rowKey: '', data: { issueType: 'BOOK_BUILDING' } }], 'CHITTORGARH', undefined, undefined, {
      writeRow: true,
    });
    const fr = r.rows[0].fieldResults?.find((f) => f.fieldName === 'issueType');
    expect(fr?.rejectedSources?.some((x) => x.reason === 'UNTRACKED_EXISTING_VALUE_KEPT') ?? false).toBe(false);
    expect(fr?.finalValue).toBe('BOOK_BUILDING');
    expect(rows[0].issueType).toBe('BOOK_BUILDING');
  });
});

describe('F-233: which child tables take the singleton row key is structural, not a name list', () => {
  /**
   * A table may carry the '' row key exactly when it holds one row per IPO: its `ipo_id` column is
   * UNIQUE in the schema, or (anchor_investors, no unique constraint) its only writer keys the row by
   * ipo_id -- documented in child-row-keys.ts#anchorInvestorsRowKey.
   */
  const WRITER_SINGLETONS = new Set(['anchor_investors']);
  const TABLES: Record<string, any> = {
    ipo_details: schema.ipoDetails,
    financial_statements: schema.financialStatements,
    ipo_valuation: schema.ipoValuation,
    ipo_risk_factors: schema.ipoRiskFactors,
    promoters: schema.promoters,
    anchor_investors: schema.anchorInvestors,
    ipo_intermediaries: schema.ipoIntermediaries,
    peer_companies: schema.peerCompanies,
    financial_data: schema.financialData,
  };

  it('every child-writer table has a schema entry here (a new table fails until classified)', () => {
    expect([...CHILD_ROW_TABLES].sort()).toEqual(Object.keys(TABLES).sort());
  });

  it('SINGLETON_ROW_CHILD_TABLES == tables whose ipo_id is UNIQUE, plus the documented writer singletons', () => {
    const structural = Object.entries(TABLES)
      .filter(([name, t]) => (getTableColumns(t) as any).ipoId.isUnique === true || WRITER_SINGLETONS.has(name))
      .map(([name]) => name)
      .sort();
    expect([...SINGLETON_ROW_CHILD_TABLES].sort()).toEqual(structural);
    expect(structural).toContain('financial_data');
  });
});

describe('F-233 / OD-160: every financial_data column the walk can write is classified for the re-read clear', () => {
  it('each manifest financial_data column is on the clear map, its not-one-to-one map, or the walk-only map', () => {
    const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    const manifest = loadFieldManifest();
    const cols = Object.keys(manifest.fields as Record<string, unknown>)
      .filter((k) => k.startsWith('financial_data.'))
      .map((k) => `financial_data.${toCamel(k.slice('financial_data.'.length))}`);
    expect(cols.length).toBeGreaterThan(20);
    const mapped = new Set(FILING_CLEARABLE_COLUMNS.map((c) => `${c.tableName}.${c.column}`));
    const unclassified = cols.filter((k: string) => !mapped.has(k) && !(k in NOT_ONE_TO_ONE_COLUMNS) && !(k in WALK_ONLY_FINANCIAL_DATA_COLUMNS));
    expect(unclassified).toEqual([]);
    // The walk-only map never overlaps the persister's own two lists.
    expect(Object.keys(WALK_ONLY_FINANCIAL_DATA_COLUMNS).filter((k) => mapped.has(k) || k in NOT_ONE_TO_ONE_COLUMNS)).toEqual([]);
  });
});
