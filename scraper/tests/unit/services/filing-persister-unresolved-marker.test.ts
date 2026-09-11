/**
 * F-101 — the writer records what only the writer knows.
 *
 * `scripts/lib/row-key-coverage-checks.mjs` cannot tell these two states apart,
 * because before this slice they leave IDENTICAL data behind:
 *
 *   - the flag is OFF, the pipeline working exactly as designed
 *   - the flag is ON, the child-row consolidator failed, and every row was
 *     written with no per-row provenance at all
 *
 * Both left a single catch-all `field_sources` row under `row_key = ''`, from
 * the legacy `trackField(table, 'rows')` call that still sits beside the
 * consolidated writer. No change to the CHECK can separate them — the
 * information is not in the data. So the WRITER records it: every fallback path
 * also files provenance under the sentinel key `unresolved:<reason>`.
 *
 * On the whole-set-replace tables the child row is still WRITTEN on every one
 * of those paths. Dropping a row there deletes a promoter from the live page;
 * losing provenance is by far the cheaper loss.
 *
 * The three-state consequence for the audit check is measured against the REAL
 * classifier in `scripts/tests/row-key-coverage-unresolved-marker.test.mjs`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  persistFilingExtraction,
  unresolvedRowKey,
} from '../../../src/services/filing-persister.js';
import type { FilingPersisterDeps } from '../../../src/services/filing-persister.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';

const IPO_ID = '11111111-2222-3333-4444-555555555555';

const f = (value: unknown) => ({ value, check: { passed: true } });

/** Fills the whole-set-replace tables (promoters / intermediaries / peers). */
const REPLACE_EXTRACTION = {
  unit: 'MILLION',
  fields: {
    promoter_names: f(['Sunil Sharma', 'Kavita Rao']),
    syndicate_members: f([{ name: 'JM Financial Ltd', role: 'SYNDICATE' }]),
    peer_companies: f([{ name: 'Alpha Industries Ltd', pe: 21.5 }]),
  },
} as never;

/**
 * A PRICE_BAND_AD cover: carries a price band (so `ipo_valuation` is written)
 * and the cover wording that decides `ipo_details.issueType`.
 */
const COVER_EXTRACTION = {
  unit: 'MILLION',
  fields: {
    price_band_floor: f(100),
    price_band_cap: f(105),
    issue_price_type: f('BOOK_BUILDING'),
    face_value: f(10),
  },
} as never;

/** Fills financial_statements, whose call site is inline (not the shared helper). */
const FINANCIALS_EXTRACTION = {
  unit: 'MILLION',
  fields: {
    financial_basis: f('restated'),
    revenue_by_fy: f({ '2024': 450 }),
    pat_by_fy: f({ '2024': 20 }),
  },
} as never;

function makeDeps(overrides: Partial<FilingPersisterDeps> = {}) {
  const trackFieldUpdate = vi.fn(async () => undefined);
  const replacePromoters = vi.fn(async () => undefined);
  const financialsUpsert = vi.fn(async () => undefined);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'F101 Fixture Ltd',
        status: 'OPEN',
        registrar: null,
      })),
      update: vi.fn(async () => undefined),
    },
    financialStatements: { upsert: financialsUpsert, listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async () => undefined) },
    promoters: { replacePromoters, replaceAcquisitionRanges: vi.fn(async () => undefined) },
    riskFactors: { replaceForIpo: vi.fn(async () => undefined) },
    intermediaries: { replaceForIpo: vi.fn(async () => undefined) },
    brlmTrackRecord: { upsert: vi.fn(async () => undefined) },
    peerCompanies: { replaceForIpo: vi.fn(async () => undefined) },
    financialData: { upsert: vi.fn(async () => undefined) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    ...overrides,
  } as unknown as FilingPersisterDeps;
  return { deps, trackFieldUpdate, replacePromoters, financialsUpsert };
}

/** Every row_key the persister filed provenance under, in call order. */
const rowKeysWritten = (trackFieldUpdate: any): string[] =>
  trackFieldUpdate.mock.calls.map((c: any[]) => (c[0].rowKey ?? '') as string);

const unresolvedKeys = (trackFieldUpdate: any): string[] =>
  rowKeysWritten(trackFieldUpdate).filter((k: string) => k.startsWith('unresolved:'));

const markerFor = (trackFieldUpdate: any, tableName: string): any[] =>
  trackFieldUpdate.mock.calls
    .map((c: any[]) => c[0])
    .filter(
      (input: any) =>
        input.tableName === tableName && String(input.rowKey ?? '').startsWith('unresolved:')
    );

describe('unresolvedRowKey — the sentinel shape', () => {
  it('GUARD (prefix): distinct from the empty catch-all key and from any derived key', () => {
    const key = unresolvedRowKey('no-consolidator-injected');
    expect(key).toBe('unresolved:no-consolidator-injected');
    expect(key).not.toBe('');
    // A derived key is fiscalYear:basis, a normalized name, or role:name —
    // never prefixed. The check's hasAnyRealKey test is `rk !== ''`, so this
    // key flips a pair into enforcement, which is the whole point.
    expect(key).not.toBe('2024:RESTATED');
  });

  it('GUARD (length): never exceeds field_sources.row_key varchar(200)', () => {
    const key = unresolvedRowKey(`consolidation-threw: ${'x'.repeat(500)}`);
    expect(key.length).toBe(200);
    expect(key.startsWith('unresolved:consolidation-threw: ')).toBe(true);
  });
});

describe('flag OFF — byte-identical to the pre-slice write', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = false;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('GUARD (flag-off silence): writes NO unresolved marker — disabled is not failed', async () => {
    const { deps, trackFieldUpdate, replacePromoters } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: vi.fn() } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      REPLACE_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(replacePromoters).toHaveBeenCalledTimes(1);
    expect(unresolvedKeys(trackFieldUpdate)).toEqual([]);
    // the legacy catch-all rows are still filed, untouched
    expect(rowKeysWritten(trackFieldUpdate)).toContain('');
  });
});

describe('flag ON, whole-set-replace tables — each fallback names its own cause', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('GUARD (no consolidator injected): marker per table, rows still written', async () => {
    const { deps, trackFieldUpdate, replacePromoters } = makeDeps();

    const summary = await persistFilingExtraction(
      IPO_ID,
      REPLACE_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(replacePromoters).toHaveBeenCalledTimes(1); // the rows are NEVER dropped
    expect(markerFor(trackFieldUpdate, 'promoters').map((i) => i.rowKey)).toEqual([
      'unresolved:no-consolidator-injected',
    ]);
    expect(markerFor(trackFieldUpdate, 'peer_companies').map((i) => i.rowKey)).toEqual([
      'unresolved:no-consolidator-injected',
    ]);
    expect(markerFor(trackFieldUpdate, 'promoters')[0]).toMatchObject({
      ipoId: IPO_ID,
      fieldName: 'rows',
      confidence: 0,
    });
    expect(summary.unresolved_child_rows.length).toBeGreaterThan(0);
  });

  it('GUARD (consolidator threw): marker carries the message AND err.cause', async () => {
    const { deps, trackFieldUpdate, replacePromoters } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async () => {
          throw new Error('pool exhausted', { cause: new Error('ECONNREFUSED 5432') });
        }),
      } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      REPLACE_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(replacePromoters).toHaveBeenCalledTimes(1);
    const key = markerFor(trackFieldUpdate, 'promoters')[0].rowKey as string;
    // signal-ownership R6: a failure that cannot be classified from its own
    // line is a defect of the logger.
    expect(key).toContain('consolidation-threw');
    expect(key).toContain('pool exhausted');
    expect(key).toContain('ECONNREFUSED 5432');
  });

  it('GUARD (consolidator reported a skip): one marker per distinct skip reason', async () => {
    const { deps, trackFieldUpdate, replacePromoters } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async (_ipoId, _table, inputs: any[]) => ({
          rowsProcessed: inputs.length,
          rowsUpdated: 0,
          rowsSkipped: inputs.length,
          conflictsDetected: 0,
          rows: inputs.map((i: any) => ({
            rowKey: i.rowKey,
            consolidatedData: {},
            fieldsProcessed: 0,
            fieldsUpdated: 0,
            conflictsDetected: 0,
            skipped: true,
            skipReason: 'LOWER_RANK',
          })),
        })),
      } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      REPLACE_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    // both promoters are skipped, but they share one reason — one marker
    expect(replacePromoters).toHaveBeenCalledTimes(1);
    expect(markerFor(trackFieldUpdate, 'promoters').map((i) => i.rowKey)).toEqual([
      'unresolved:consolidation-skipped: LOWER_RANK',
    ]);
  });

  it('GUARD (success): a resolved row files NO unresolved marker', async () => {
    const { deps, trackFieldUpdate } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async (_ipoId, _table, inputs: any[]) => ({
          rowsProcessed: inputs.length,
          rowsUpdated: inputs.length,
          rowsSkipped: 0,
          conflictsDetected: 0,
          rows: inputs.map((i: any) => ({
            rowKey: i.rowKey,
            consolidatedData: i.data,
            fieldsProcessed: 1,
            fieldsUpdated: 1,
            conflictsDetected: 0,
            skipped: false,
          })),
        })),
      } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      REPLACE_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(unresolvedKeys(trackFieldUpdate)).toEqual([]);
  });

  it('GUARD (marker write failure never loses the data write)', async () => {
    const trackFieldUpdate = vi.fn(async (input: any) => {
      if (String(input.rowKey ?? '').startsWith('unresolved:')) {
        throw new Error('field_sources down');
      }
    });
    const { deps, replacePromoters } = makeDeps({
      fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate } as never,
    });

    await expect(
      persistFilingExtraction(IPO_ID, REPLACE_EXTRACTION, { docType: 'RHP', apply: true }, deps)
    ).resolves.toBeDefined();
    expect(replacePromoters).toHaveBeenCalledTimes(1);
  });
});

describe('flag ON, financial_statements — the inline call site', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('GUARD (no consolidator injected): marker written, row still upserted', async () => {
    const { deps, trackFieldUpdate, financialsUpsert } = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      FINANCIALS_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    expect(financialsUpsert).toHaveBeenCalledTimes(1);
    expect(markerFor(trackFieldUpdate, 'financial_statements').map((i) => i.rowKey)).toEqual([
      'unresolved:no-consolidator-injected',
    ]);
  });

  it('GUARD (consolidator reported a skip): marker written; the stored row is left alone', async () => {
    const { deps, trackFieldUpdate, financialsUpsert } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async (_ipoId, _table, inputs: any[]) => ({
          rowsProcessed: 1,
          rowsUpdated: 0,
          rowsSkipped: 1,
          conflictsDetected: 0,
          rows: [
            {
              rowKey: inputs[0].rowKey,
              consolidatedData: {},
              fieldsProcessed: 0,
              fieldsUpdated: 0,
              conflictsDetected: 0,
              skipped: true,
              skipReason: 'LOWER_RANK',
            },
          ],
        })),
      } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      FINANCIALS_EXTRACTION,
      { docType: 'RHP', apply: true },
      deps
    );

    // financial_statements is an UPSERT table, not a whole-set replace: a
    // skipped row is simply not re-written, so the stored row survives intact.
    // That is pre-existing, reviewed behaviour and is NOT changed here.
    expect(financialsUpsert).not.toHaveBeenCalled();
    expect(markerFor(trackFieldUpdate, 'financial_statements').map((i) => i.rowKey)).toEqual([
      'unresolved:consolidation-skipped: LOWER_RANK',
    ]);
  });
});

describe('flag ON, ipo_details / ipo_valuation — the singleton inline call sites', () => {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = true;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });

  it('GUARD (no consolidator injected): both tables file their own marker', async () => {
    const { deps, trackFieldUpdate } = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      COVER_EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(markerFor(trackFieldUpdate, 'ipo_details').map((i) => i.rowKey)).toEqual([
      'unresolved:no-consolidator-injected',
    ]);
    expect(markerFor(trackFieldUpdate, 'ipo_valuation').map((i) => i.rowKey)).toEqual([
      'unresolved:no-consolidator-injected',
    ]);
  });

  it('GUARD (consolidator reported a skip): both tables name the skip reason', async () => {
    const { deps, trackFieldUpdate } = makeDeps({
      childRowConsolidator: {
        consolidatedUpsertChildRows: vi.fn(async (_ipoId, _table, inputs: any[]) => ({
          rowsProcessed: 1,
          rowsUpdated: 0,
          rowsSkipped: 1,
          conflictsDetected: 0,
          rows: [
            {
              rowKey: inputs[0].rowKey,
              consolidatedData: {},
              fieldsProcessed: 0,
              fieldsUpdated: 0,
              conflictsDetected: 0,
              skipped: true,
              skipReason: 'LOWER_RANK',
            },
          ],
        })),
      } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      COVER_EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(markerFor(trackFieldUpdate, 'ipo_details').map((i) => i.rowKey)).toEqual([
      'unresolved:consolidation-skipped: LOWER_RANK',
    ]);
    expect(markerFor(trackFieldUpdate, 'ipo_valuation').map((i) => i.rowKey)).toEqual([
      'unresolved:consolidation-skipped: LOWER_RANK',
    ]);
  });
});
