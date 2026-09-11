/**
 * Item 1 slice s5b — the financials CALL SITE.
 *
 * The orchestrator method is proven in
 * `consolidated-child-rows-financials.test.ts`. This file proves the thing that
 * is worth more than any test of the new path: with
 * `ENABLE_CHILD_TABLE_CONSOLIDATION` OFF, `persistFilingExtraction` writes
 * exactly the row it wrote before this slice — same columns, same values, same
 * unit — and never touches the consolidator. And with the flag ON, the value
 * the consolidator RESOLVED is the value that reaches the repository, not the
 * value this extraction carried.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistFilingExtraction } from '../../../src/services/filing-persister.js';
import type { FilingPersisterDeps } from '../../../src/services/filing-persister.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';

const IPO_ID = '99999999-8888-7777-6666-555555555555';

/** `trusted()` reads `fields.<name>.value` and requires `check.passed`. */
const f = (value: unknown) => ({ value, check: { passed: true } });
const EXTRACTION = {
  unit: 'MILLION',
  fields: {
    financial_basis: f('restated'),
    revenue_by_fy: f({ '2024': 450 }),
    pat_by_fy: f({ '2024': 20 }),
  },
} as never;

function makeDeps(overrides: Partial<FilingPersisterDeps> = {}) {
  const upsert = vi.fn(async () => undefined);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({ id: IPO_ID, companyName: 'S5B Fixture Ltd', status: 'OPEN' })),
    },
    financialStatements: { upsert, listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async () => undefined) },
    promoters: {
      replacePromoters: vi.fn(async () => undefined),
      replaceAcquisitionRanges: vi.fn(async () => undefined),
    },
    intermediaries: { replaceForIpo: vi.fn(async () => undefined) },
    brlmTrackRecord: { upsert: vi.fn(async () => undefined) },
    peerCompanies: { replaceForIpo: vi.fn(async () => undefined) },
    financialData: { upsert: vi.fn(async () => undefined) },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: vi.fn(async () => undefined),
    },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    ...overrides,
  } as unknown as FilingPersisterDeps;
  return { deps, upsert };
}

describe('financial_statements call site — flag OFF', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = false;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('writes the pre-slice row and never calls the consolidator', async () => {
    const consolidate = vi.fn();
    const { deps, upsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(IPO_ID, EXTRACTION, { docType: 'RHP', apply: true }, deps);

    expect(consolidate).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      ipoId: IPO_ID,
      fiscalYear: 2024,
      basis: 'RESTATED',
      unit: 'MILLION',
      revenue: '450',
      pat: '20',
    });
  });
});

describe('financial_statements call site — flag ON', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('routes the row through the consolidator with the fiscalYear:basis row key', async () => {
    const consolidate = vi.fn(async () => ({
      rowsProcessed: 1,
      rowsUpdated: 1,
      rowsSkipped: 0,
      conflictsDetected: 0,
      rows: [
        {
          rowKey: '2024:RESTATED',
          consolidatedData: { revenue: '450', pat: '20' },
          fieldsProcessed: 2,
          fieldsUpdated: 2,
          conflictsDetected: 0,
          skipped: false,
        },
      ],
    }));
    const { deps, upsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(IPO_ID, EXTRACTION, { docType: 'RHP', apply: true }, deps);

    expect(consolidate).toHaveBeenCalledTimes(1);
    const [ipoId, tableName, rows, source, docType] = consolidate.mock.calls[0] as any[];
    expect(ipoId).toBe(IPO_ID);
    expect(tableName).toBe('financial_statements');
    expect(rows[0].rowKey).toBe('2024:RESTATED');
    // Only what THIS extraction carries is offered as incoming — a
    // carried-forward prior value must never claim this source's provenance.
    expect(rows[0].data).toEqual({ revenue: '450', pat: '20' });
    expect(source).toBe('DRHP');
    expect(docType).toBe('RHP');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('writes the RESOLVED value, not the extracted one, when consolidation keeps the stored figure', async () => {
    const consolidate = vi.fn(async () => ({
      rowsProcessed: 1,
      rowsUpdated: 0,
      rowsSkipped: 0,
      conflictsDetected: 1,
      rows: [
        {
          rowKey: '2024:RESTATED',
          // The stored DRHP figure won; this extraction's 450 lost.
          consolidatedData: { revenue: '380', pat: '20' },
          fieldsProcessed: 2,
          fieldsUpdated: 0,
          conflictsDetected: 1,
          skipped: false,
        },
      ],
    }));
    const { deps, upsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(IPO_ID, EXTRACTION, { docType: 'RHP', apply: true }, deps);

    expect(upsert.mock.calls[0][0]).toMatchObject({ revenue: '380', pat: '20' });
  });

  it('does NOT write the row when consolidation skipped it', async () => {
    const consolidate = vi.fn(async () => ({
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
          skipReason: 'MISSING_ROW_KEY',
        },
      ],
    }));
    const { deps, upsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    const summary = await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(upsert).not.toHaveBeenCalled();
    expect(summary.skipped_failed_check.join(' | ')).toContain('MISSING_ROW_KEY');
  });

  it('falls back to the unresolved write when the consolidator was never injected', async () => {
    const { deps, upsert } = makeDeps();
    await persistFilingExtraction(IPO_ID, EXTRACTION, { docType: 'RHP', apply: true }, deps);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ revenue: '450' });
  });
});

/**
 * PR #625 follow-up — the financial_statements call site (filing-persister.ts
 * ~1880) had NO exception handling.
 *
 * Before #625 `deps.childRowConsolidator` was always `undefined`, so the
 * `if (!deps.childRowConsolidator)` guard fired and the persist always
 * completed. #625 injects a real consolidator, so a Redis or DB fault inside
 * `consolidatedUpsertChildRows` now PROPAGATES and aborts the whole persist
 * mid-write — every table after this one is skipped. Losing provenance is the
 * cheap loss; losing the rest of the write is not.
 */
describe('financial_statements call site — the consolidator throws', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('still completes the persist and writes the row unresolved', async () => {
    const consolidate = vi.fn(async () => {
      throw new Error('redis connection reset');
    });
    const trackFieldUpdate = vi.fn(async () => undefined);
    const { deps, upsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
      fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate } as never,
    });

    const summary = await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    // The persist COMPLETED — it did not reject.
    expect(summary).toBeDefined();
    // The row is still WRITTEN, carrying this extraction's own (unresolved) value.
    expect(consolidate).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ revenue: '450', pat: '20' });
    // And the rows are MARKED unresolved, with the cause recorded.
    const marker = trackFieldUpdate.mock.calls
      .map((c: any[]) => c[0])
      .find(
        (a: any) =>
          a.tableName === 'financial_statements' && a.dataLineage?.unresolvedReason !== undefined
      );
    expect(marker).toBeDefined();
    expect(String(marker.dataLineage.unresolvedReason)).toContain('consolidation-threw');
    expect(String(marker.dataLineage.unresolvedReason)).toContain('redis connection reset');
  });
});
