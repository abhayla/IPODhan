/**
 * T-434 (walk step G4) — filing-persister mapping + write-discipline tests.
 *
 * The fixture is built FROM THE ORACLE (docs/reviews/fixtures/
 * deepa-jewellers-expected.json), which was transcribed by hand from the two
 * Deepa Jewellers documents. Asserting against the oracle rather than against
 * a captured extractor output means these tests fail if the persister starts
 * writing something the DOCUMENT does not say, not merely something the
 * extractor stopped saying.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: upsertIPOMock,
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  toRupees,
  toCrore,
  parseFilingUnit,
  convertUnit,
  scraperSourceForDocType,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

const ORACLE = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../../docs/reviews/fixtures/deepa-jewellers-expected.json'),
    'utf8'
  )
) as Record<string, Record<string, unknown>>;

/** Wrap every oracle value as a PASSING extracted field. */
function extractionFromOracle(
  section: 'PRICE_BAND_AD' | 'RHP',
  overrides: Record<string, { value: unknown; passed: boolean }> = {}
): FilingExtraction {
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(ORACLE[section])) {
    if (k.startsWith('_')) continue;
    fields[k] = { value: v, page: 1, check: { name: `${k}_check`, passed: true } };
  }
  if (section === 'PRICE_BAND_AD') {
    // The oracle records the BRLM track record under _known_gaps rather than as
    // an asserted field (the second row prints "Nil Nil", which is not
    // machine-readable as a count). The extractor DOES emit the numeric row, so
    // the persister must be exercised against it.
    fields.brlm_track_record = {
      value: [
        { brlm: 'Emkay Global Financial Services Limited', issues_3y: 4, closed_below: 2 },
      ],
      page: 3,
      check: { name: 'brlm_rows_reconcile_with_total', passed: true },
    };
  }
  for (const [k, o] of Object.entries(overrides)) {
    fields[k] = { value: o.value, page: 1, check: { name: `${k}_check`, passed: o.passed } };
  }
  return {
    doc_type: section,
    source_doc: 'fixture.pdf',
    pages: 4,
    extraction_status: 'OK',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

interface Spies {
  deps: FilingPersisterDeps;
  finStmt: ReturnType<typeof vi.fn>;
  valuation: ReturnType<typeof vi.fn>;
  replacePromoters: ReturnType<typeof vi.fn>;
  replaceRanges: ReturnType<typeof vi.fn>;
  replaceIntermediaries: ReturnType<typeof vi.fn>;
  brlm: ReturnType<typeof vi.fn>;
  peerDelete: ReturnType<typeof vi.fn>;
  peerCreate: ReturnType<typeof vi.fn>;
  finData: ReturnType<typeof vi.fn>;
  trackField: ReturnType<typeof vi.fn>;
  detailsUpsert: ReturnType<typeof vi.fn>;
}

function makeDeps(): Spies {
  const finStmt = vi.fn(async (row: unknown) => row);
  const valuation = vi.fn(async (row: unknown) => row);
  const replacePromoters = vi.fn(async () => []);
  const replaceRanges = vi.fn(async () => []);
  const replaceIntermediaries = vi.fn(async () => []);
  const brlm = vi.fn(async (row: unknown) => row);
  const peerDelete = vi.fn(async () => 0);
  const peerCreate = vi.fn(async () => []);
  const finData = vi.fn(async (row: unknown) => row);
  const trackField = vi.fn(async () => ({}));
  const detailsUpsert = vi.fn(async () => undefined);

  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Deepa Jewellers Limited',
        slug: 'deepa-jewellers-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'OPEN',
        listingExchanges: ['NSE', 'BSE'],
        openDate: new Date('2026-09-01'),
        closeDate: new Date('2026-09-03'),
        registrar: 'Bigshare Services Private Limited',
        leadManagers: [
          'Emkay Global Financial Services Limited',
          'Valmiki Leela Capital Private Limited',
        ],
      })),
    },
    financialStatements: { upsert: finStmt, listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: valuation },
    promoters: {
      replacePromoters,
      replaceAcquisitionRanges: replaceRanges,
    },
    intermediaries: { replaceForIpo: replaceIntermediaries },
    brlmTrackRecord: { upsert: brlm },
    peerCompanies: { deleteByIPOId: peerDelete, batchCreate: peerCreate },
    financialData: { upsert: finData },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: trackField,
    },
    ipoDetailsWriter: { upsert: detailsUpsert },
  } as unknown as FilingPersisterDeps;

  return {
    deps,
    finStmt,
    valuation,
    replacePromoters,
    replaceRanges,
    replaceIntermediaries,
    brlm,
    peerDelete,
    peerCreate,
    finData,
    trackField,
    detailsUpsert,
  };
}

describe('filing-persister — unit conversion', () => {
  it('converts published units to rupees and crores', () => {
    expect(toRupees(4597.16, 'MILLION')).toBeCloseTo(4_597_160_000, 0);
    expect(toRupees(10, 'CRORE')).toBe(100_000_000);
    expect(toRupees(100, 'LAKH')).toBe(10_000_000);
    expect(toRupees(500, 'RUPEES')).toBe(500);
    expect(toCrore(19266.76, 'MILLION')).toBeCloseTo(1926.676, 3);
    expect(convertUnit(1000, 'MILLION', 'CRORE')).toBe(100);
    expect(convertUnit(100, 'CRORE', 'MILLION')).toBe(1000);
  });

  it('refuses to guess a unit it does not recognise (F1)', () => {
    expect(parseFilingUnit('millions')).toBe('MILLION');
    expect(parseFilingUnit('Crore')).toBe('CRORE');
    expect(parseFilingUnit('rupees')).toBe('RUPEES');
    // The old code defaulted every one of these to millions.
    expect(parseFilingUnit(null)).toBeNull();
    expect(parseFilingUnit(undefined)).toBeNull();
    expect(parseFilingUnit('')).toBeNull();
    expect(parseFilingUnit('billions')).toBeNull();
    expect(parseFilingUnit('INR')).toBeNull();
  });

  it('maps every filing doc type onto the DRHP scraper_source member', () => {
    // scraper_source has no RHP / PRICE_BAND_AD member (no migration in this WP).
    expect(scraperSourceForDocType('PRICE_BAND_AD')).toBe('DRHP');
    expect(scraperSourceForDocType('RHP')).toBe('DRHP');
  });
});

describe('filing-persister — PRICE_BAND_AD mapping (DEEPA oracle)', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
  });

  it('sends the ad total (fresh + OFS at cap) to ipos.issueSize via upsertIPO', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const [, scraped, source] = upsertIPOMock.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
      string,
    ];
    // 2500.00 (fresh) + 2097.16 (OFS at cap) millions = Rs 4,597,160,000.
    expect(scraped.issueSize).toBe(4_597_160_000);
    // It must OUTRANK the exchanges' 3,278,055,045 — that is the whole point
    // of routing through upsertIPO with a source the matrix ranks above NSE.
    expect(source).toBe('DRHP');
    expect(summary.ipos_fields).toContain('issueSize');
  });

  it('maps the ipos scalars the ad carries and nothing else', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.priceRangeMin).toBe(168);
    expect(scraped.priceRangeMax).toBe(177);
    expect(scraped.lotSize).toBe(84);
    expect(scraped.faceValue).toBe(2);
    expect(scraped.openDate).toBe('2026-09-01');
    expect(scraped.closeDate).toBe('2026-09-03');
    expect(scraped.allotmentDate).toBe('2026-09-04');
    expect(scraped.listingDate).toBe('2026-09-08');
  });

  it('writes ipo_details timeline, category split, UPI cut-off and fresh/OFS in rupees', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(s.detailsUpsert).toHaveBeenCalledTimes(1);
    const [, values] = s.detailsUpsert.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(values.basisOfAllotmentDate).toBe('2026-09-04');
    expect(values.initiationOfRefundsDate).toBe('2026-09-07');
    expect(values.creditOfSharesDate).toBe('2026-09-07');
    expect(values.upiCutoffTime).toBe('17:00');
    expect(values.designatedExchange).toBe('BSE');
    expect(values.complianceOfficer).toBe('Vandana Modani');
    expect(values.allocationPct).toEqual({ qib: 50, nii: 15, retail: 35 });
    expect(values.lotMultiple).toBe(84);
    expect(values.preIpoPlacement).toBe(false);
    expect(values.issueType).toBe('BOOK_BUILDING');
    expect(values.dataSource).toBe('DRHP');
    // fresh + ofs MUST sum to the issue_size sent to ipos (GitHub #8 unit rule).
    expect(Number(values.freshIssue) + Number(values.ofsIssue)).toBe(4_597_160_000);
  });

  it('writes one financial_statements row per fiscal year with the oracle figures', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(summary.written.financial_statements).toBe(3);
    const rows = s.finStmt.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const fy2026 = rows.find((r) => r.fiscalYear === 2026)!;
    expect(fy2026.basis).toBe('RESTATED');
    expect(fy2026.unit).toBe('MILLION');
    expect(fy2026.revenue).toBe('19266.76');
    expect(fy2026.pat).toBe('1047.88');
    expect(fy2026.ebitda).toBe('1463.37');
    expect(fy2026.epsBasic).toBe('12.78');
    expect(fy2026.opCashFlow).toBe('-147.3');
    // The ad has no DSCR / rent rows; they must be null, never invented.
    expect(fy2026.dscr).toBeNull();
    expect(fy2026.rentExpense).toBeNull();
  });

  it('writes the PRICE_BAND_AD valuation row with market cap converted to rupees', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.valuation.mock.calls[0][0] as Record<string, unknown>;
    expect(row.pricingEvent).toBe('PRICE_BAND_AD');
    expect(row.priceFloor).toBe('168');
    expect(row.priceCap).toBe('177');
    expect(row.sharesAtFloor).toBe(14880952);
    expect(row.sharesAtCap).toBe(14124293);
    expect(row.mcapAtFloor).toBe('16276000000');
    expect(row.mcapAtCap).toBe('17014000000');
    expect(row.peAtCap).toBe('13.85');
    expect(row.ronwWeighted3y).toBe('45.26');
    expect(row.faceValueMultipleCap).toBe('88.5');
  });

  it('writes one promoter row per named promoter, never the aggregate holding', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const rows = s.replacePromoters.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.name)).toEqual(['Ashish Agarwal', 'Seema Agarwal', 'Dev Agarwal']);
    // 40,005,000 is the AGGREGATE promoter holding — attributing it to any one
    // named promoter would invent a figure the ad never printed.
    expect(rows.every((r) => r.sharesHeld === null)).toBe(true);
    expect(rows.find((r) => r.name === 'Ashish Agarwal')!.waca).toBe('0.5');
    expect(rows.find((r) => r.name === 'Dev Agarwal')!.waca).toBeNull();
    expect(summary.skipped_no_column.some((x) => x.startsWith('promoter_shares_held'))).toBe(true);
  });

  it('writes BRLM + registrar intermediaries and leaves unmapped SEBI regs null', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const rows = s.replaceIntermediaries.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.role === 'BRLM').every((r) => r.sebiRegNo === null)).toBe(true);
    const registrar = rows.find((r) => r.role === 'REGISTRAR')!;
    expect(registrar.name).toBe('Bigshare Services Private Limited');
    expect(registrar.sebiRegNo).toBe('INR000001385');
    expect(summary.skipped_no_column.some((x) => x.startsWith('brlm_sebi_regs'))).toBe(true);
  });

  it('writes the peer table and financial_data in crores', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(summary.written.peer_companies).toBe(5);
    const peers = s.peerCreate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const sky = peers.find((p) => p.companyName === 'Sky Gold and Diamonds Limited')!;
    expect(sky.peRatio).toBe('57.56');
    expect(sky.eps).toBe('13.97');
    expect(sky.nav).toBe('72.02');

    const fd = s.finData.mock.calls[0][0] as Record<string, unknown>;
    // 10,245.68 million = Rs 1,024.57 crore.
    expect(fd.revenueFy2024).toBe('1024.57');
    expect(fd.profitFy2024).toBe('24.35');
    // EPS is per-share and must NOT be unit-scaled.
    expect(fd.eps).toBe('12.78');
    expect(fd.promoterHoldingPreIssue).toBe('48.79');
    expect(fd.promoterHoldingPostIssue).toBe('35.45');
    // FY2025/FY2026 have no columns — reported, not silently dropped.
    expect(summary.skipped_no_column.some((x) => x.includes('financial_data FY2026'))).toBe(true);
  });
});

describe('filing-persister — failed checks are never written', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('drops a field whose arithmetic check failed, and says why', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD', {
      // The extractor read a number but its own consistency check rejected it.
      fresh_issue_amount: { value: 999999, passed: false },
      ofs_amount_at_cap: { value: 2097.16, passed: false },
      // The fallback leg too — otherwise issue_size would be computed from the
      // OFS alone, which understates the offer by the whole fresh component.
      ofs_amount: { value: 1990.52, passed: false },
      upi_cutoff_time: { value: '17:00', passed: false },
      market_cap_at_cap: { value: 17014.0, passed: false },
    });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    // No issue_size at all rather than a wrong one.
    expect(summary.ipos_fields).not.toContain('issueSize');
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.issueSize).toBeUndefined();

    const details = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details.upiCutoffTime).toBeUndefined();
    expect(details.freshIssue).toBeUndefined();

    const valuation = s.valuation.mock.calls[0][0] as Record<string, unknown>;
    expect(valuation.mcapAtCap).toBeNull();

    for (const f of ['fresh_issue_amount', 'upi_cutoff_time', 'market_cap_at_cap']) {
      expect(summary.skipped_failed_check.some((x) => x.startsWith(`${f}:`))).toBe(true);
    }
  });

  it('drops a null-valued field even when its check passed', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    extraction.fields.compliance_officer = {
      value: null,
      check: { name: 'compliance_officer_present', passed: true },
    };
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const details = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details.complianceOfficer).toBeUndefined();
    expect(summary.skipped_failed_check.some((x) => x.startsWith('compliance_officer:'))).toBe(true);
  });

  it('refuses the whole financial_statements block when the unit is not stated', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    extraction.unit = null;
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(s.finStmt).not.toHaveBeenCalled();
    expect(summary.written.financial_statements).toBeUndefined();
    expect(
      summary.skipped_no_unit.some((x) => x.startsWith('financial_statements'))
    ).toBe(true);
  });
});

describe('filing-persister — dry run and idempotency', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('writes nothing in dry-run mode but reports the same plan', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD' },
      s.deps
    );
    expect(summary.applied).toBe(false);
    expect(upsertIPOMock).not.toHaveBeenCalled();
    expect(s.detailsUpsert).not.toHaveBeenCalled();
    expect(s.finStmt).not.toHaveBeenCalled();
    expect(s.peerCreate).not.toHaveBeenCalled();
    expect(s.trackField).not.toHaveBeenCalled();
    expect(summary.written.financial_statements).toBe(3);
    expect(summary.ipos_fields).toContain('issueSize');
  });

  it('re-running updates in place: same natural keys, no extra rows', async () => {
    const s = makeDeps();
    const run = () =>
      persistFilingExtraction(
        IPO_ID,
        extractionFromOracle('PRICE_BAND_AD'),
        { docType: 'PRICE_BAND_AD', apply: true },
        s.deps
      );
    const first = await run();
    const second = await run();

    expect(second.written).toEqual(first.written);

    // financial_statements: 3 rows per run, both runs on the SAME (ipoId, fy,
    // basis) keys — the unique key is what makes the second run an update.
    const keys = s.finStmt.mock.calls.map((c) => {
      const r = c[0] as Record<string, unknown>;
      return `${r.ipoId}|${r.fiscalYear}|${r.basis}`;
    });
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(3);

    // ipo_valuation: same (ipoId, pricingEvent) both times.
    const vkeys = s.valuation.mock.calls.map((c) => {
      const r = c[0] as Record<string, unknown>;
      return `${r.ipoId}|${r.pricingEvent}`;
    });
    expect(new Set(vkeys).size).toBe(1);

    // brlm_track_record: same (brlmName, asOfDate, sourceIpoId) both times.
    const bkeys = s.brlm.mock.calls.map((c) => {
      const r = c[0] as Record<string, unknown>;
      return `${r.brlmName}|${r.asOfDate}|${r.sourceIpoId}`;
    });
    expect(new Set(bkeys).size).toBe(1);

    // Full-replace tables: the second run deletes before inserting, so the row
    // COUNT handed to the repository is identical, never doubled.
    expect(s.replacePromoters.mock.calls[1][1]).toHaveLength(
      (s.replacePromoters.mock.calls[0][1] as unknown[]).length
    );
    expect(s.replaceIntermediaries.mock.calls[1][1]).toHaveLength(
      (s.replaceIntermediaries.mock.calls[0][1] as unknown[]).length
    );
    expect(s.peerDelete).toHaveBeenCalledTimes(2);
    expect(s.peerCreate.mock.calls[1][0]).toHaveLength(
      (s.peerCreate.mock.calls[0][0] as unknown[]).length
    );
  });

  it('records field_sources with the filing source, confidence 100 and doc lineage', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', documentId: 'doc-1', sourceSha: 'sha-1', apply: true },
      s.deps
    );
    const calls = s.trackField.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.source === 'DRHP')).toBe(true);
    expect(calls.every((c) => c.confidence === 100)).toBe(true);
    expect(calls.every((c) => c.ipoId === IPO_ID)).toBe(true);
    const lineage = calls[0].dataLineage as Record<string, unknown>;
    expect(lineage.docType).toBe('PRICE_BAND_AD');
    expect(lineage.documentId).toBe('doc-1');
    expect(lineage.sourceSha).toBe('sha-1');
    expect(calls.some((c) => c.tableName === 'ipo_details')).toBe(true);
    expect(calls.some((c) => c.tableName === 'financial_statements')).toBe(true);
  });
});

describe('filing-persister — RHP', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('keeps a value the earlier filing stored when this one does not carry it', async () => {
    const s = makeDeps();
    // The ad already wrote FY2026 operating cash flow; the RHP has no such row.
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2026,
          basis: 'RESTATED',
          unit: 'MILLION',
          opCashFlow: '-147.3',
          dscr: null,
        },
      ]);
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('RHP'),
      { docType: 'RHP', apply: true },
      s.deps
    );
    const fy2026 = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    expect(fy2026.opCashFlow).toBe('-147.3');
    expect(fy2026.netWorth).toBe('2380.7');
  });

  it('writes the RHP financials as a PROSPECTUS-side statement set', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('RHP');
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', apply: true },
      s.deps
    );
    expect(summary.written.financial_statements).toBe(3);
    const fy2026 = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    expect(fy2026.totalIncome).toBe('19277.25');
    expect(fy2026.netWorth).toBe('2380.7');
    // The RHP states no basis. It is still a SEBI-restated statement set, so it
    // must land on the SAME (ipoId, fy, RESTATED) key as the ad — not a second
    // STANDALONE copy of the same three years.
    expect(fy2026.basis).toBe('RESTATED');
    // The RHP carries no price band, so nothing goes to ipos.issueSize.
    expect(summary.ipos_fields).not.toContain('issueSize');
  });
});

describe('filing-persister — unit safety (F1/F2)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('writes no issue_size, fresh/ofs or market cap when the filing states no unit', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    extraction.unit = null;
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.issueSize).toBeUndefined();
    expect(summary.ipos_fields).not.toContain('issueSize');

    const details = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details.freshIssue).toBeUndefined();
    expect(details.ofsIssue).toBeUndefined();

    const valuation = s.valuation.mock.calls[0][0] as Record<string, unknown>;
    expect(valuation.mcapAtFloor).toBeNull();
    expect(valuation.mcapAtCap).toBeNull();

    // Price band and share counts are NOT unit-dependent and still land.
    expect(scraped.priceRangeMin).toBe(168);
    expect(valuation.sharesAtCap).toBe(14124293);

    for (const f of [
      'ipos.issueSize',
      'ipo_details.freshIssue',
      'ipo_details.ofsIssue',
      'ipo_valuation.mcapAtFloor',
      'ipo_valuation.mcapAtCap',
      'financial_data.marketCap',
      // MIN-8: the per-FY putCrore path is unit-dependent too and was missing
      // from this list, so a regression in it would not have been caught here.
      // (netWorth is asserted on the RHP below - the ad has no net-worth row.)
      'financial_data.revenueFy2024',
      'financial_data.profitFy2024',
      'financial_data.ebitdaFy2024',
      'financial_statements',
    ]) {
      expect(summary.skipped_no_unit.some((x) => x.startsWith(f))).toBe(true);
    }
  });

  it('does not multiply an already-in-rupees amount by a million', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    extraction.unit = 'rupees';
    extraction.fields.fresh_issue_amount = {
      value: 2_500_000_000,
      check: { name: 'fresh_issue_amount_consistent', passed: true },
    };
    extraction.fields.ofs_amount_at_cap = {
      value: 2_097_160_000,
      check: { name: 'ofs_at_cap_consistent', passed: true },
    };
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    // The old millions default made this 4.597e15.
    expect(scraped.issueSize).toBe(4_597_160_000);
  });

  it('converts a later crore filing into the stored million row, keeping one unit (F2)', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2026,
          basis: 'RESTATED',
          unit: 'MILLION',
          revenue: '19266.76',
          opCashFlow: '-147.3',
        },
      ]);
    const extraction = extractionFromOracle('RHP');
    extraction.unit = 'crores';
    // The same FY2026 figures, restated in crores.
    extraction.fields.revenue_by_fy = {
      value: { '2026': 1926.676 },
      check: { name: 'revenue_year_series', passed: true },
    };
    extraction.fields.net_worth_by_fy = {
      value: { '2026': 238.07 },
      check: { name: 'net_worth_year_series', passed: true },
    };
    extraction.fields.eps_basic_by_fy = {
      value: { '2026': 12.78 },
      check: { name: 'eps_year_series', passed: true },
    };
    delete extraction.fields.total_income_by_fy;
    delete extraction.fields.pat_by_fy;
    delete extraction.fields.ebitda_by_fy;

    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', apply: true }, s.deps);

    const row = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    // The STORED unit wins and the incoming crore figures are converted into it.
    expect(row.unit).toBe('MILLION');
    expect(row.revenue).toBe('19266.76');
    expect(row.netWorth).toBe('2380.7');
    // EPS is per-share — it must NOT be unit-converted.
    expect(row.epsBasic).toBe('12.78');
    // And the earlier filing's column survives.
    expect(row.opCashFlow).toBe('-147.3');
  });
});

describe('filing-persister — basis casing (F3)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('classifies a capitalised "Standalone" label as STANDALONE, not RESTATED', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD', {
      financial_basis: { value: 'Standalone', passed: true },
    });
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const bases = new Set(
      s.finStmt.mock.calls.map((c) => (c[0] as Record<string, unknown>).basis)
    );
    expect([...bases]).toEqual(['STANDALONE']);
  });

  it('still reads a mixed-case "Restated Standalone" label as RESTATED', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD', {
      financial_basis: { value: 'Restated Standalone', passed: true },
    });
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const bases = new Set(
      s.finStmt.mock.calls.map((c) => (c[0] as Record<string, unknown>).basis)
    );
    expect([...bases]).toEqual(['RESTATED']);
  });

  it('does not merge a STANDALONE extraction into the stored RESTATED row', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        { ipoId: IPO_ID, fiscalYear: 2026, basis: 'RESTATED', unit: 'MILLION', opCashFlow: '-147.3' },
      ]);
    const extraction = extractionFromOracle('PRICE_BAND_AD', {
      financial_basis: { value: 'Standalone', passed: true },
    });
    extraction.fields.op_cash_flow_by_fy = {
      value: {},
      check: { name: 'op_cash_flow_year_series', passed: true },
    };
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    expect(row.basis).toBe('STANDALONE');
    // The RESTATED row's value must not leak into the STANDALONE one.
    expect(row.opCashFlow).toBeNull();
  });
});

describe('filing-persister — lock and field protection (F5)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('refuses the whole run and writes nothing when the IPO is scraper_locked', async () => {
    const s = makeDeps();
    const findById = s.deps.ipoRepository.findById as unknown as ReturnType<typeof vi.fn>;
    const base = await findById();
    findById.mockResolvedValue({ ...base, scraperLocked: true });

    await expect(
      persistFilingExtraction(
        IPO_ID,
        extractionFromOracle('PRICE_BAND_AD'),
        { docType: 'PRICE_BAND_AD', apply: true },
        s.deps
      )
    ).rejects.toThrow(/scraper_locked/);

    expect(upsertIPOMock).not.toHaveBeenCalled();
    expect(s.detailsUpsert).not.toHaveBeenCalled();
    expect(s.finStmt).not.toHaveBeenCalled();
    expect(s.valuation).not.toHaveBeenCalled();
    expect(s.replacePromoters).not.toHaveBeenCalled();
    expect(s.peerCreate).not.toHaveBeenCalled();
    expect(s.brlm).not.toHaveBeenCalled();
    expect(s.finData).not.toHaveBeenCalled();
  });

  it('never writes an ipo_details column the protection gate removed', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = vi.fn(async (_id, _t, data: Record<string, unknown>) => {
      const filtered = { ...data };
      delete filtered.upiCutoffTime;
      return { filtered };
    });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(s.deps.protectionFilter).toHaveBeenCalledWith(
      IPO_ID,
      'ipo_details',
      expect.any(Object),
      'DRHP'
    );
    const values = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(values.upiCutoffTime).toBeUndefined();
    expect(values.complianceOfficer).toBe('Vandana Modani');
    expect(summary.skipped_protected).toContain('ipo_details.upiCutoffTime');
    const tracked = s.trackField.mock.calls.map((c) => (c[0] as Record<string, unknown>).fieldName);
    expect(tracked).not.toContain('upiCutoffTime');
  });
});

describe('filing-persister — never fabricates a date or an exchange (MAJOR-1, MIN-9)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('writes NO date keys when neither the extraction nor the row has one', async () => {
    const s = makeDeps();
    const findById = s.deps.ipoRepository.findById as unknown as ReturnType<typeof vi.fn>;
    const base = await findById();
    findById.mockResolvedValue({ ...base, openDate: null, closeDate: null });

    const extraction = extractionFromOracle('PRICE_BAND_AD');
    for (const f of ['open_date', 'close_date', 'basis_of_allotment_date', 'listing_date']) {
      delete extraction.fields[f];
    }

    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];

    // The old code wrote TODAY here, as source DRHP at confidence 100 — a
    // fabricated date that outranks every scraped source in the matrix.
    expect('openDate' in scraped).toBe(false);
    expect('closeDate' in scraped).toBe(false);
    expect('allotmentDate' in scraped).toBe(false);
    expect('listingDate' in scraped).toBe(false);
    // And nothing that looks like today's date leaked in under any key.
    const today = new Date().toISOString().slice(0, 10);
    expect(Object.values(scraped)).not.toContain(today);
  });

  it('still falls back to the row own dates, which are real', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    delete extraction.fields.open_date;
    delete extraction.fields.close_date;
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.openDate).toBe('2026-09-01');
    expect(scraped.closeDate).toBe('2026-09-03');
  });

  it('writes no listingExchange when the row lists none (MIN-9)', async () => {
    const s = makeDeps();
    const findById = s.deps.ipoRepository.findById as unknown as ReturnType<typeof vi.fn>;
    const base = await findById();
    findById.mockResolvedValue({ ...base, listingExchanges: [] });
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    // 'BSE' used to be invented here for a row that never named an exchange.
    expect('listingExchange' in scraped).toBe(false);
  });

  it('passes through a single real exchange and BOTH for two', async () => {
    const s = makeDeps();
    const findById = s.deps.ipoRepository.findById as unknown as ReturnType<typeof vi.fn>;
    const base = await findById();
    findById.mockResolvedValue({ ...base, listingExchanges: ['NSE'] });
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(
      (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]
        .listingExchange
    ).toBe('NSE');
  });
});

describe('filing-persister — field protection on EVERY child table (MAJOR-4)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  function protectFields(protectedCols: Record<string, string[]>) {
    return vi.fn(async (_id: string, table: string, data: Record<string, unknown>) => {
      const filtered = { ...data };
      for (const col of protectedCols[table] ?? []) delete filtered[col];
      return { filtered };
    });
  }

  it('keeps an admin-protected financial_data.ronw out of the write', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ financial_data: ['ronw'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const fd = s.finData.mock.calls[0][0] as Record<string, unknown>;
    expect(fd.ronw).toBeUndefined();
    // The rest of the row still lands, and the ipoId is preserved.
    expect(fd.ipoId).toBe(IPO_ID);
    expect(fd.eps).toBe('12.78');
    expect(summary.skipped_protected).toContain('financial_data.ronw');
    const tracked = s.trackField.mock.calls.map((c) => (c[0] as Record<string, unknown>).fieldName);
    expect(tracked).not.toContain('ronw');
  });

  it('runs the gate for every table it writes, not just ipo_details', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({});
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const tables = new Set(
      (s.deps.protectionFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[1] as string
      )
    );
    for (const t of [
      'ipo_details',
      'ipo_valuation',
      'promoters',
      'ipo_intermediaries',
      'brlm_track_record',
      'peer_companies',
      'financial_data',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('refuses a whole-row replace when any field of that table is protected', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ promoters: ['waca'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    // A replace deletes the rows first, so the protected value cannot survive a
    // partial application — the replace is abandoned entirely.
    expect(s.replacePromoters).not.toHaveBeenCalled();
    expect(summary.written.promoters).toBeUndefined();
    expect(
      summary.skipped_protected.some((x) => x.startsWith('promoters (whole-row replace refused'))
    ).toBe(true);
    // Unrelated tables still write.
    expect(s.peerCreate).toHaveBeenCalled();
  });
});

describe('filing-persister — dry run matches apply, and single-doc agreement (MOD-5, MOD-6)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('reads the stored statements in dry-run mode too', async () => {
    const s = makeDeps();
    const listByIpo = (
      s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }
    ).listByIpo;
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD' },
      s.deps
    );
    // Round 3 read priors only when applying, so the dry-run plan was computed
    // from a different starting state than the write it was previewing.
    expect(listByIpo).toHaveBeenCalled();
  });

  it('produces the SAME plan dry and applied when a stored row blocks a write', async () => {
    // A stored row whose unit this code cannot read refuses that fiscal year.
    // If the dry run does not read priors it will not see the refusal, and the
    // preview will promise rows the apply would drop. Asserting the call alone
    // is not enough - MOD-6 reads the same table, which masks the regression.
    const priors = [
      { ipoId: IPO_ID, fiscalYear: 2026, basis: 'RESTATED', unit: 'TONNES', revenue: '1' },
    ];
    const dry = makeDeps();
    (dry.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => priors);
    const applied = makeDeps();
    (applied.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => priors);

    const dryRun = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD' },
      dry.deps
    );
    const applyRun = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      applied.deps
    );

    expect(dryRun.written.financial_statements).toBe(applyRun.written.financial_statements);
    expect(dryRun.skipped_unit_mismatch).toEqual(applyRun.skipped_unit_mismatch);
    expect(dryRun.skipped_unit_mismatch.some((x) => x.includes('FY2026'))).toBe(true);
  });

  it('checks a single document against rows an earlier filing already stored', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2026,
          basis: 'RESTATED',
          unit: 'MILLION',
          revenue: '19266.76',
          // The ad stored a PAT 20% away from what this extraction reports.
          pat: String(1047.88 * 1.2),
          epsBasic: '12.78',
        },
      ]);
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    // MOD-6 + MOD-7: the disagreement condemns the whole financial block, so no
    // statement row is written at all.
    expect(s.finStmt).not.toHaveBeenCalled();
    expect(summary.skipped_cross_document_disagreement.length).toBeGreaterThan(0);
    expect(
      summary.skipped_cross_document_disagreement.some((x) => x.includes('pat_by_fy'))
    ).toBe(true);
  });

  it('persists normally when the stored rows agree', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2026,
          basis: 'RESTATED',
          unit: 'MILLION',
          revenue: '19266.76',
          pat: '1047.88',
          epsBasic: '12.78',
        },
      ]);
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(summary.written.financial_statements).toBe(3);
    expect(summary.skipped_cross_document_disagreement).toEqual([]);
  });
});

describe('filing-persister — MIN-8 net worth is unit-guarded too', () => {
  it('skips financial_data.netWorth when the RHP states no unit', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('RHP');
    extraction.unit = null;
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', apply: true },
      s.deps
    );
    expect(summary.skipped_no_unit.some((x) => x.startsWith('financial_data.netWorth'))).toBe(true);
    // total_income only appears in the RHP, so its putCrore path is asserted here.
    expect(
      summary.skipped_no_unit.some((x) => x.startsWith('financial_data.totalIncomeFy2024'))
    ).toBe(true);
    const fd = s.finData.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(fd?.netWorth).toBeUndefined();
  });
});
