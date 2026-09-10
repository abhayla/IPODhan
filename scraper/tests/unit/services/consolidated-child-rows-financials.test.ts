/**
 * Item 1 slice s5b — the consolidated child-row writer, financials only.
 *
 * Before this slice `financial_statements` was written by a direct
 * `deps.financialStatements.upsert(...)` with NO per-field priority
 * resolution and NO per-row provenance: a CHITTORGARH revenue figure
 * arriving after a DRHP one silently replaced it, and nothing recorded
 * which document supplied which number.
 *
 * This suite pins the four things that must hold:
 *  1. rank, not arrival order, decides the written value;
 *  2. every field earns a `field_sources` row carrying the ROW key
 *     (`2024:RESTATED`), so two fiscal years keep two distinct provenance
 *     rows — impossible before the widened unique key (#559);
 *  3. with the flag OFF nothing is written through the new path at all;
 *  4. a row with no usable key is SKIPPED with a counted reason, never
 *     written under the `''` singleton sentinel where it would collide
 *     with every other keyless row.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import { financialStatementsRowKey } from '../../../src/services/child-row-keys.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';

const IPO_ID = '11111111-2222-3333-4444-555555555555';

/** In-memory field_sources, keyed exactly as the widened DB constraint is. */
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

function makeOrchestrator() {
  const fieldSources = new FakeFieldSources();
  const conflicts = new FakeConflicts();
  const orchestrator = new DataConsolidationOrchestrator(
    {} as never,
    fieldSources as never,
    conflicts as never,
    null
  );
  return { orchestrator, fieldSources, conflicts };
}

function provenance(fieldSources: FakeFieldSources, rowKey: string, field: string) {
  return [...fieldSources.rows.values()].find(
    (r) => r.tableName === 'financial_statements' && r.rowKey === rowKey && r.fieldName === field
  );
}

describe('financialStatementsRowKey', () => {
  it('is fiscalYear:basis — the table own unique key', () => {
    expect(financialStatementsRowKey(2024, 'RESTATED')).toBe('2024:RESTATED');
  });

  it('returns null (never an empty string) when the fiscal year or basis is missing', () => {
    expect(financialStatementsRowKey(null, 'RESTATED')).toBeNull();
    expect(financialStatementsRowKey(2024, null)).toBeNull();
    expect(financialStatementsRowKey(undefined, undefined)).toBeNull();
    expect(financialStatementsRowKey(Number.NaN, 'RESTATED')).toBeNull();
  });
});

describe('consolidatedUpsertChildRows — financial_statements', () => {
  const originalFlag = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  const originalConsolidation = FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION;
  const originalTracking = FEATURE_FLAGS.ENABLE_SOURCE_TRACKING;
  const originalPct = FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE;

  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = true;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = true;
    // NOT incidental: CONSOLIDATION_PERCENTAGE defaults to 0, and 0 routes
    // every consolidation into `fallbackConsolidation` — incoming accepted,
    // zero priority resolution, zero provenance. So ENABLE_CHILD_TABLE_
    // CONSOLIDATION=true on a slot whose CONSOLIDATION_PERCENTAGE is 0
    // changes NOTHING. Pinned as its own case at the bottom of this file.
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = 100;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = originalFlag;
    (FEATURE_FLAGS as any).ENABLE_DATA_CONSOLIDATION = originalConsolidation;
    (FEATURE_FLAGS as any).ENABLE_SOURCE_TRACKING = originalTracking;
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = originalPct;
  });

  it('the higher-ranked source wins on VALUE when the low-ranked one arrives LAST', async () => {
    const { orchestrator, fieldSources } = makeOrchestrator();
    const rowKey = financialStatementsRowKey(2024, 'RESTATED')!;

    await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '450.00' } }],
      'DRHP'
    );
    const second = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '999.00' }, existingData: { revenue: '450.00' } }],
      'CHITTORGARH'
    );

    expect(second.rows[0].consolidatedData.revenue).toBe('450.00');
    expect(provenance(fieldSources, rowKey, 'revenue').source).toBe('DRHP');
  });

  it('the higher-ranked source wins on VALUE when it arrives LAST', async () => {
    const { orchestrator, fieldSources } = makeOrchestrator();
    const rowKey = financialStatementsRowKey(2024, 'RESTATED')!;

    await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '999.00' } }],
      'CHITTORGARH'
    );
    const second = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '450.00' }, existingData: { revenue: '999.00' } }],
      'DRHP'
    );

    expect(second.rows[0].consolidatedData.revenue).toBe('450.00');
    expect(provenance(fieldSources, rowKey, 'revenue').source).toBe('DRHP');
  });

  it('two fiscal years produce two DISTINCT provenance rows for the same field', async () => {
    const { orchestrator, fieldSources } = makeOrchestrator();
    const fy23 = financialStatementsRowKey(2023, 'RESTATED')!;
    const fy24 = financialStatementsRowKey(2024, 'RESTATED')!;

    const result = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [
        { rowKey: fy23, data: { revenue: '300.00', pat: '10.00' } },
        { rowKey: fy24, data: { revenue: '450.00', pat: '20.00' } },
      ],
      'DRHP'
    );

    expect(result.rowsProcessed).toBe(2);
    expect(provenance(fieldSources, fy23, 'revenue')).toBeDefined();
    expect(provenance(fieldSources, fy24, 'revenue')).toBeDefined();
    expect(provenance(fieldSources, fy23, 'revenue').rowKey).toBe('2023:RESTATED');
    expect(provenance(fieldSources, fy24, 'revenue').rowKey).toBe('2024:RESTATED');
    // Four provenance rows: two fields x two rows. Under the pre-#559 key the
    // two years' `revenue` rows were one row.
    const finRows = [...fieldSources.rows.values()].filter(
      (r) => r.tableName === 'financial_statements'
    );
    expect(finRows.length).toBe(4);
  });

  it('does NOT match another row key provenance as its own', async () => {
    const { orchestrator } = makeOrchestrator();
    const fy23 = financialStatementsRowKey(2023, 'RESTATED')!;
    const fy24 = financialStatementsRowKey(2024, 'RESTATED')!;

    await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey: fy23, data: { revenue: '300.00' } }],
      'DRHP'
    );
    // FY2024 has NO stored value; a CHITTORGARH figure must be accepted for it
    // rather than "kept" against FY2023's DRHP row.
    const result = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey: fy24, data: { revenue: '450.00' } }],
      'CHITTORGARH'
    );
    expect(result.rows[0].consolidatedData.revenue).toBe('450.00');
  });

  it('SKIPS a row with no usable key, with a counted reason — never writes it under an empty key', async () => {
    const { orchestrator, fieldSources } = makeOrchestrator();
    const keyless = financialStatementsRowKey(null, 'RESTATED');
    expect(keyless).toBeNull();

    const result = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey: keyless ?? '', data: { revenue: '450.00' } }],
      'DRHP'
    );

    expect(result.rowsSkipped).toBe(1);
    expect(result.rowsProcessed).toBe(0);
    expect(result.rows[0].skipped).toBe(true);
    expect(result.rows[0].skipReason).toBe('MISSING_ROW_KEY');
    expect([...fieldSources.rows.values()]).toHaveLength(0);
  });

  it('refuses to run at all when ENABLE_CHILD_TABLE_CONSOLIDATION is off', async () => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = false;
    const { orchestrator, fieldSources } = makeOrchestrator();
    const result = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey: '2024:RESTATED', data: { revenue: '450.00' } }],
      'DRHP'
    );
    expect(result.rows[0].skipReason).toBe('CHILD_TABLE_CONSOLIDATION_DISABLED');
    expect([...fieldSources.rows.values()]).toHaveLength(0);
  });

  it('with CONSOLIDATION_PERCENTAGE=0 the flag resolves nothing — a rollout precondition, not a bug', async () => {
    (FEATURE_FLAGS as any).CONSOLIDATION_PERCENTAGE = 0;
    const { orchestrator, fieldSources } = makeOrchestrator();
    const rowKey = financialStatementsRowKey(2024, 'RESTATED')!;

    await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '450.00' } }],
      'DRHP'
    );
    const second = await orchestrator.consolidatedUpsertChildRows(
      IPO_ID,
      'financial_statements',
      [{ rowKey, data: { revenue: '999.00' }, existingData: { revenue: '450.00' } }],
      'CHITTORGARH'
    );

    // The low-ranked source wins, and nothing is provenanced: the percentage
    // gate must be non-zero on the slot before this flag means anything.
    expect(second.rows[0].consolidatedData.revenue).toBe('999.00');
    expect([...fieldSources.rows.values()]).toHaveLength(0);
  });
});
