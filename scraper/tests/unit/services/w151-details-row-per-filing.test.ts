/**
 * W-151 — an `ipo_details` row exists for EVERY IPO once any filing is
 * persisted, even when the extraction yields zero writable detail columns.
 *
 * Before this, `persistFilingExtraction` upserted `ipo_details` only when at
 * least one detail field survived extraction + protection. RHP / DRHP /
 * PROSPECTUS extractions rarely yield one (W-147), so prod had 3 rows for 358
 * IPOs and "no row" was indistinguishable from "row with unknown fields" —
 * the gap was invisible to the page and to `audit:coverage`.
 *
 * Design: docs/walks/w151-ipo-details-row-design.md
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: vi.fn(async () => 'ipo-id'),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'w151-ipo-id';

/** An RHP whose extraction carries nothing that maps to an ipo_details column. */
function zeroDetailExtraction(): FilingExtraction {
  return {
    doc_type: 'RHP',
    source_doc: 'w151-rhp.pdf',
    pages: 420,
    extraction_status: 'OK',
    unit: 'rupees',
    fiscal_years: [],
    fields: {},
  };
}

function makeDeps(
  protectionFilter?: FilingPersisterDeps['protectionFilter']
): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'W151 Test Limited',
        slug: 'w151-test-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE', 'BSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { deleteByIPOId: vi.fn(async () => 0), batchCreate: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    ...(protectionFilter ? { protectionFilter } : {}),
  } as unknown as FilingPersisterDeps;
}

const upsertCalls = (deps: FilingPersisterDeps) =>
  (deps.ipoDetailsWriter.upsert as unknown as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    Record<string, unknown>
  ][];

describe('W-151: an ipo_details row per persisted filing', () => {
  it('writes the identity row when the extraction yields no detail column at all', async () => {
    const deps = makeDeps();

    const summary = await persistFilingExtraction(
      IPO_ID,
      zeroDetailExtraction(),
      { docType: 'RHP', documentId: 'doc-1', sourceSha: 'sha-1', extractorVersion: 'v-test', apply: true },
      deps
    );

    const calls = upsertCalls(deps);
    expect(calls).toHaveLength(1);
    const [ipoId, values] = calls[0];
    expect(ipoId).toBe(IPO_ID);
    // Identity columns ONLY — no invented nulls for the optional columns, so
    // the ON CONFLICT UPDATE cannot blank a value another source already set.
    expect(Object.keys(values)).toEqual(['dataSource']);
    expect(values.dataSource).toBeTruthy();
    expect((summary as { written?: Record<string, number> }).written?.ipo_details).toBe(1);
  });

  it('records the row provenance (doc type, document id, extractor version) in field_sources', async () => {
    const deps = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      zeroDetailExtraction(),
      { docType: 'RHP', documentId: 'doc-1', sourceSha: 'sha-1', extractorVersion: 'extract_filing.py@test', apply: true },
      deps
    );

    const track = deps.fieldSources.trackFieldUpdate as unknown as ReturnType<typeof vi.fn>;
    const row = track.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((c) => c.tableName === 'ipo_details' && c.fieldName === 'dataSource');
    expect(row).toBeDefined();
    expect(row!.dataLineage).toMatchObject({
      docType: 'RHP',
      documentId: 'doc-1',
      sourceSha: 'sha-1',
      extractorVersion: 'extract_filing.py@test',
    });
  });

  it('writes nothing in plan mode (apply: false)', async () => {
    const deps = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      zeroDetailExtraction(),
      { docType: 'RHP', apply: false },
      deps
    );

    expect(upsertCalls(deps)).toHaveLength(0);
  });

  it('still writes the row when every extracted detail column is admin-protected', async () => {
    // faceValue is extracted but locked by an admin: the protected column must
    // not reach the writer, and the row must still exist.
    const protectionFilter = vi.fn(
      async (_ipoId: string, _table: string, data: Record<string, unknown>) => {
        const filtered = { ...data };
        delete filtered.faceValue;
        return { filtered };
      }
    ) as unknown as FilingPersisterDeps['protectionFilter'];
    const deps = makeDeps(protectionFilter);

    const extraction = zeroDetailExtraction();
    extraction.fields.face_value = {
      value: 10,
      page: 1,
      check: { name: 'fv', passed: true },
    } as never;

    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', apply: true },
      deps
    );

    const calls = upsertCalls(deps);
    expect(calls).toHaveLength(1);
    const [, values] = calls[0];
    expect(values).not.toHaveProperty('faceValue');
    expect(values.dataSource).toBeTruthy();
  });

  it('merges a later extraction into the existing row instead of replacing it', async () => {
    const deps = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      zeroDetailExtraction(),
      { docType: 'RHP', apply: true },
      deps
    );

    const withField = zeroDetailExtraction();
    withField.doc_type = 'PRICE_BAND_AD';
    withField.fields.face_value = {
      value: 10,
      page: 1,
      check: { name: 'fv', passed: true },
    } as never;

    await persistFilingExtraction(
      IPO_ID,
      withField,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const calls = upsertCalls(deps);
    expect(calls).toHaveLength(2);
    // The second write carries the new column and nothing else — an upsert that
    // sets only the columns it knows, leaving the rest of the row alone.
    expect(calls[1][1].faceValue).toBe('10');
    expect(calls[1][1]).not.toHaveProperty('issueType');
  });
});
