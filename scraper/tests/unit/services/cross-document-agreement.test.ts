/**
 * T-434 W-45 — cross-document agreement gate.
 *
 * The price band advertisement and the RHP are published by the same issuer, on
 * the same day, off the same restated accounts. A disagreement between them
 * means one was mis-parsed and there is no way to tell which, so NEITHER series
 * may be written. These tests pin the tolerance (1%, copied from
 * extract_financials_pdf.py::check_cross_document_agreement) and the
 * withhold-the-whole-series behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  checkCrossDocumentAgreement,
  comparableSeries,
  withholdDisagreeingMetrics,
  expandWithheldMetrics,
  CROSS_DOC_TOLERANCE,
} from '../../../src/services/cross-document-agreement';
import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

const AD_SERIES = {
  revenue_by_fy: { '2026': 19266.76, '2025': 13970.1, '2024': 10245.68 },
  pat_by_fy: { '2026': 1047.88, '2025': 405.8, '2024': 243.47 },
  eps_basic_by_fy: { '2026': 12.78, '2025': 4.95, '2024': 2.97 },
};

function passing(value: unknown) {
  return { value, page: 1, check: { name: 'series', passed: true } };
}

function extractionFrom(series: Record<string, Record<string, number>>): FilingExtraction {
  const fields: FilingExtraction['fields'] = {
    unit: passing('millions'),
    financial_basis: passing('restated_standalone'),
    eps_diluted_by_fy: passing({ '2026': 12.78, '2025': 4.95, '2024': 2.97 }),
  };
  for (const [k, v] of Object.entries(series)) fields[k] = passing(v);
  return {
    doc_type: 'PRICE_BAND_AD',
    source_doc: 'fixture.pdf',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(): { deps: FilingPersisterDeps; finStmt: ReturnType<typeof vi.fn> } {
  const finStmt = vi.fn(async (row: unknown) => row);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Deepa Jewellers Limited',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'OPEN',
        listingExchanges: ['NSE', 'BSE'],
        openDate: new Date('2026-09-01'),
        closeDate: new Date('2026-09-03'),
        registrar: null,
        leadManagers: [],
      })),
    },
    financialStatements: { upsert: finStmt, listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async () => ({})) },
    promoters: {
      replacePromoters: vi.fn(async () => []),
      replaceAcquisitionRanges: vi.fn(async () => []),
    },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async () => ({})) },
    peerCompanies: { deleteByIPOId: vi.fn(async () => 0), batchCreate: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async () => ({})) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
  return { deps, finStmt };
}

describe('cross-document agreement — the check itself', () => {
  it('uses the 1% tolerance of the python original', () => {
    expect(CROSS_DOC_TOLERANCE).toBe(0.01);
  });

  it('agrees when both documents report the same figures', () => {
    const r = checkCrossDocumentAgreement(AD_SERIES, AD_SERIES);
    expect(r.agree).toBe(true);
    expect(r.comparedCount).toBe(9);
    expect(r.disagreeingMetrics).toEqual([]);
  });

  it('reports BOTH values when FY26 PAT differs by 20%', () => {
    const rhp = {
      ...AD_SERIES,
      pat_by_fy: { ...AD_SERIES.pat_by_fy, '2026': 1047.88 * 1.2 },
    };
    const r = checkCrossDocumentAgreement(AD_SERIES, rhp);
    expect(r.agree).toBe(false);
    expect(r.disagreeingMetrics).toEqual(['pat_by_fy']);
    expect(r.disagreements).toHaveLength(1);
    expect(r.disagreements[0].fiscalYear).toBe('2026');
    expect(r.disagreements[0].valueA).toBeCloseTo(1047.88, 2);
    expect(r.disagreements[0].valueB).toBeCloseTo(1257.456, 2);
    expect(r.detail).toContain('1047.88 (PRICE_BAND_AD)');
    expect(r.detail).toContain('(RHP)');
  });

  it('tolerates a rounding-level difference but not a 2% one', () => {
    const within = { pat_by_fy: { '2026': 1047.88 }, };
    const nudged = { pat_by_fy: { '2026': 1047.88 * 1.005 } };
    expect(checkCrossDocumentAgreement(within, nudged).agree).toBe(true);
    const beyond = { pat_by_fy: { '2026': 1047.88 * 1.02 } };
    expect(checkCrossDocumentAgreement(within, beyond).agree).toBe(false);
  });

  it('passes vacuously when the two documents share no metric/year', () => {
    const r = checkCrossDocumentAgreement(
      { revenue_by_fy: { '2026': 1 } },
      { pat_by_fy: { '2025': 2 } }
    );
    expect(r.agree).toBe(true);
    expect(r.comparedCount).toBe(0);
    expect(r.detail).toContain('no overlapping');
  });

  it('ignores a series whose extractor check failed', () => {
    const ex = extractionFrom(AD_SERIES);
    ex.fields.pat_by_fy = { value: AD_SERIES.pat_by_fy, check: { name: 'x', passed: false } };
    expect(Object.keys(comparableSeries(ex)).sort()).toEqual([
      'eps_basic_by_fy',
      'revenue_by_fy',
    ]);
  });

  it('withholds the WHOLE financial block, not just the offending series (MOD-7)', () => {
    const ex = extractionFrom(AD_SERIES);
    const stripped = withholdDisagreeingMetrics(ex, ['pat_by_fy']);
    // Every metric read off the same restated table goes, because if one column
    // was mis-parsed the table was mis-parsed.
    expect(stripped.fields.pat_by_fy).toBeUndefined();
    expect(stripped.fields.revenue_by_fy).toBeUndefined();
    expect(stripped.fields.eps_basic_by_fy).toBeUndefined();
    expect(stripped.fields.eps_diluted_by_fy).toBeUndefined();
    // Non-financial fields are untouched.
    expect(stripped.fields.unit).toBeDefined();
    // The original is untouched.
    expect(ex.fields.pat_by_fy).toBeDefined();
  });

  it('names the whole block, including the metrics it never compared', () => {
    expect(expandWithheldMetrics([])).toEqual([]);
    const expanded = expandWithheldMetrics(['pat_by_fy']);
    for (const m of [
      'total_income_by_fy',
      'ebitda_by_fy',
      'net_worth_by_fy',
      'op_cash_flow_by_fy',
    ]) {
      expect(expanded).toContain(m);
    }
  });
});

describe('cross-document agreement — effect on what gets persisted', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('an agreeing pair persists the full statement rows', async () => {
    const agreement = checkCrossDocumentAgreement(
      comparableSeries(extractionFrom(AD_SERIES)),
      comparableSeries(extractionFrom(AD_SERIES))
    );
    expect(agreement.agree).toBe(true);

    const { deps, finStmt } = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      withholdDisagreeingMetrics(extractionFrom(AD_SERIES), agreement.disagreeingMetrics),
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );
    const fy2026 = finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    expect(fy2026.revenue).toBe('19266.76');
    expect(fy2026.pat).toBe('1047.88');
    expect(fy2026.epsBasic).toBe('12.78');
  });

  it('a pair differing 20% on FY26 PAT persists NO pat/eps figures and reports both values', async () => {
    const ad = extractionFrom(AD_SERIES);
    const rhp = extractionFrom({
      ...AD_SERIES,
      pat_by_fy: { '2026': 1047.88 * 1.2, '2025': 405.8, '2024': 243.47 },
    });

    const agreement = checkCrossDocumentAgreement(comparableSeries(ad), comparableSeries(rhp));
    expect(agreement.agree).toBe(false);
    expect(agreement.disagreeingMetrics).toEqual(['pat_by_fy']);

    for (const ex of [ad, rhp]) {
      const { deps, finStmt } = makeDeps();
      await persistFilingExtraction(
        IPO_ID,
        withholdDisagreeingMetrics(ex, agreement.disagreeingMetrics),
        { docType: 'PRICE_BAND_AD', apply: true },
        deps
      );
      // MOD-7: the whole financial block is withheld, so there is no statement
      // row left to write at all — not even the revenue series that agreed.
      expect(finStmt).not.toHaveBeenCalled();
    }

    // The report carries both values so a human can see which is wrong.
    const reported = agreement.disagreements.map(
      (d) => `${d.metric} FY${d.fiscalYear}: ${d.valueA} (PRICE_BAND_AD) vs ${d.valueB} (RHP)`
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('pat_by_fy FY2026');
    expect(reported[0]).toContain('1047.88');
  });
});

describe('cross-document agreement — units (MAJOR-3)', () => {
  it('agrees when the ad prints lakh and the RHP prints million for the same money', () => {
    // Rs 1,926.676 crore: 192,667.6 lakh === 19,266.76 million.
    const adLakh = { revenue_by_fy: { '2026': 192667.6 }, pat_by_fy: { '2026': 10478.8 } };
    const rhpMillion = { revenue_by_fy: { '2026': 19266.76 }, pat_by_fy: { '2026': 1047.88 } };

    // Without units this is a 10x "disagreement" between two agreeing documents.
    expect(checkCrossDocumentAgreement(adLakh, rhpMillion).agree).toBe(false);

    const withUnits = checkCrossDocumentAgreement(
      adLakh,
      rhpMillion,
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      'LAKH',
      'MILLION'
    );
    expect(withUnits.agree).toBe(true);
    expect(withUnits.comparedCount).toBe(2);
  });

  it('still catches a real disagreement across different units', () => {
    const adLakh = { pat_by_fy: { '2026': 10478.8 } };
    const rhpMillionWrong = { pat_by_fy: { '2026': 1047.88 * 1.2 } };
    const r = checkCrossDocumentAgreement(
      adLakh,
      rhpMillionWrong,
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      'LAKH',
      'MILLION'
    );
    expect(r.agree).toBe(false);
    expect(r.disagreeingMetrics).toEqual(['pat_by_fy']);
  });

  it('never unit-converts a per-share figure', () => {
    // EPS is Rs 12.78 regardless of the table's unit beside it.
    const r = checkCrossDocumentAgreement(
      { eps_basic_by_fy: { '2026': 12.78 } },
      { eps_basic_by_fy: { '2026': 12.78 } },
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      'LAKH',
      'MILLION'
    );
    expect(r.agree).toBe(true);
  });

  it('refuses the comparison when one document has no parseable unit', () => {
    const r = checkCrossDocumentAgreement(
      { pat_by_fy: { '2026': 1047.88 } },
      { pat_by_fy: { '2026': 1047.88 } },
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      null,
      'MILLION'
    );
    expect(r.agree).toBe(false);
    expect(r.skipped_cross_document_unit_unknown).toContain('PRICE_BAND_AD');
    expect(r.comparedCount).toBe(0);
    // Not a disagreement either — there is nothing to blame on a metric.
    expect(r.disagreeingMetrics).toEqual([]);
  });
});
