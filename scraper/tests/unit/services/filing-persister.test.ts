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

  // W-88 A7: the offer's three share legs each get their own column. The
  // pre-existing shares_at_floor/at_cap keep holding the FRESH leg so readers
  // written before migration 0048 do not silently change meaning.
  it('writes the fresh, OFS and total share legs, and total = fresh + OFS at each price', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.valuation.mock.calls[0][0] as Record<string, number>;
    expect(row.freshSharesAtFloor).toBe(14880952);
    expect(row.freshSharesAtCap).toBe(14124293);
    expect(row.ofsShares).toBe(11848340);
    expect(row.totalSharesAtFloor).toBe(26729292);
    expect(row.totalSharesAtCap).toBe(25972633);
    // Substance, not shape: the stored legs must reconcile.
    expect(row.freshSharesAtFloor + row.ofsShares).toBe(row.totalSharesAtFloor);
    expect(row.freshSharesAtCap + row.ofsShares).toBe(row.totalSharesAtCap);
    // Backward compatibility: the legacy pair still carries the fresh leg.
    expect(row.sharesAtFloor).toBe(row.freshSharesAtFloor);
    expect(row.sharesAtCap).toBe(row.freshSharesAtCap);
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
    // W-88 (migration 0049): the aggregate now lands on its own ipo_details
    // column instead of being reported as a field with nowhere to go.
    expect(summary.skipped_no_column.some((x) => x.startsWith('promoter_shares_held'))).toBe(
      false
    );
    const details = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details.promoterSharesHeld).toBe(40005000);
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
    // 2 BRLMs + registrar + the lead Syndicate Member + 17 sub-syndicate
    // members (W-74 E5 / W-76) + 4 issue banks (W-88 E6).
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.role === 'BRLM').every((r) => r.sebiRegNo === null)).toBe(true);
    const registrar = rows.find((r) => r.role === 'REGISTRAR')!;
    expect(registrar.name).toBe('Bigshare Services Private Limited');
    expect(registrar.sebiRegNo).toBe('INR000001385');
    expect(summary.skipped_no_column.some((x) => x.startsWith('brlm_sebi_regs'))).toBe(true);
  });

  it('W-76: writes the lead Syndicate Member and all 17 sub-syndicate members with correct roles', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const rows = s.replaceIntermediaries.mock.calls[0][1] as Array<Record<string, unknown>>;
    const syndicate = rows.filter((r) => r.role === 'SYNDICATE');
    const subSyndicate = rows.filter((r) => r.role === 'SUB_SYNDICATE');
    expect(syndicate).toHaveLength(1);
    expect(syndicate[0].name).toBe('Emkay Global Financial Services Limited');
    // `intermediary_role` now carries SUB_SYNDICATE (W-76), so all 17
    // sub-syndicate brokers are filed under their own role, not dropped.
    expect(subSyndicate).toHaveLength(17);
    expect(rows.some((r) => r.name === 'Sharekhan Limited')).toBe(true);
    expect(
      summary.skipped_no_column.some((x) => x.startsWith('syndicate_members'))
    ).toBe(false);
  });

  // W-88 E6: sponsor / escrow / public-issue banks reach ipo_intermediaries
  // under their own roles instead of being dropped as having no column.
  it('W-88: writes the sponsor, escrow and public-issue banks under their own roles', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const rows = s.replaceIntermediaries.mock.calls[0][1] as Array<Record<string, unknown>>;
    const named = (role: string) =>
      rows.filter((r) => r.role === role).map((r) => r.name).sort();
    expect(named('SPONSOR_BANK')).toEqual(['HDFC Bank Limited', 'ICICI Bank Limited']);
    expect(named('ESCROW_BANK')).toEqual(['ICICI Bank Limited']);
    expect(named('PUBLIC_ISSUE_BANK')).toEqual(['HDFC Bank Limited']);
    expect(summary.skipped_no_column.some((x) => x.startsWith('issue_banks'))).toBe(false);
  });

  it('W-88: a bank carrying a role outside the enum is skipped, not written', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    (extraction.fields as Record<string, unknown>).issue_banks = {
      value: [
        { name: 'ICICI Bank Limited', role: 'REFUND_BANK' },
        { name: 'HDFC Bank Limited', role: 'SPONSOR_BANK' },
      ],
      check: { passed: true, detail: '2 banks' },
    };
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const rows = s.replaceIntermediaries.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.role === 'REFUND_BANK')).toBe(false);
    expect(rows.filter((r) => r.role === 'SPONSOR_BANK').map((r) => r.name)).toEqual([
      'HDFC Bank Limited',
    ]);
  });

  // W-88 E4: ipo_details already had compliance_officer_phone/_email columns;
  // nothing wrote them because the extractor read only the officer's name.
  it('W-88: writes the compliance officer phone and e-mail off the cover line', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(row.complianceOfficer).toBe('Vandana Modani');
    expect(row.complianceOfficerPhone).toBe('+ 91 76809 62117');
    expect(row.complianceOfficerEmail).toBe('cs@deepajewel.com');
  });

  // W-88 B8: the per-investor-class bid submission windows. NOT ipoMarketTimings
  // - that column is varchar(50) and the NSE scraper fills it with the
  // exchange's trading hours; migration 0049 gave the windows their own jsonb.
  it('W-88: writes the eight bid submission windows to ipo_details.bidWindows', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    const windows = row.bidWindows as { activity: string; window: string }[];
    expect(windows).toHaveLength(8);
    expect(windows[0]).toEqual({
      activity: 'Submission and revision in Bids',
      window: 'Only between 10.00 a.m. and 5.00 p.m. IST',
    });
    expect(windows.every((w) => w.window.includes('IST'))).toBe(true);
    // The NSE trading-hours column must not be touched by this write.
    expect(row.ipoMarketTimings).toBeUndefined();
  });

  it('W-88: a bid window missing its activity or window text is dropped', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    (extraction.fields as Record<string, unknown>).bid_windows = {
      value: [
        { activity: 'Submission and revision in Bids', window: 'Only between 10.00 a.m. IST' },
        { activity: 'Submission of Physical Applications (Bank ASBA)' },
        { window: 'Only between 10.00 a.m. and up to 1.00 p.m. IST' },
      ],
      check: { passed: true, detail: '3 rows' },
    };
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(row.bidWindows).toEqual([
      { activity: 'Submission and revision in Bids', window: 'Only between 10.00 a.m. IST' },
    ]);
  });

  // W-88 D2/A12/D7 (migration 0049): three fields that used to be reported as
  // skipped_no_column now have ipo_details columns.
  it('W-88: writes the aggregate promoter holding, regulation cited and D7 list', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(row.promoterSharesHeld).toBe(40005000);
    expect(row.sebiRegulationCited).toBe('Regulation 6(1)');
    // The ad states there were NO promoter-group transactions since the DRHP -
    // an empty list is that answer, and it is stored, not skipped.
    expect(row.promoterGroupTransactionsSinceDrhp).toEqual([]);
    expect(row.issueType).toBe('BOOK_BUILDING');
    // The aggregate holding is NOT smeared onto a named promoter.
    const promoters = s.replacePromoters.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(promoters.every((r) => r.sharesHeld === null)).toBe(true);
    // ... and it is no longer reported as a field with no column.
    expect(
      summary.skipped_no_column.filter(
        (f) =>
          f.startsWith('promoter_shares_held') ||
          f.startsWith('book_building_regulation') ||
          f.startsWith('promoter_group_transactions_since_drhp')
      )
    ).toEqual([]);
  });

  it('W-88: a promoter-group statement the ad never printed writes no column', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    (extraction.fields as Record<string, unknown>).promoter_group_transactions_since_drhp = {
      value: null,
      check: { passed: true, detail: 'statement_not_found' },
    };
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect('promoterGroupTransactionsSinceDrhp' in row).toBe(false);
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
    // Absent, not null: the payload is assembled from the writable columns only,
    // and sending null would erase whatever the row already held.
    expect(valuation.mcapAtCap).toBeUndefined();

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
    // The payload is now assembled column-by-column from the writable set, so a
    // column the filing could not compute is ABSENT rather than written as null
    // (an upsert that sends null erases whatever the row already held).
    expect(valuation.mcapAtFloor).toBeUndefined();
    expect(valuation.mcapAtCap).toBeUndefined();

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

  it('MINOR-1: a protected openDate with no filing date is absent from the upsertIPO payload', async () => {
    // The filing carries no open_date, so the row's own openDate is only a
    // fallback — but the admin protected ipos.openDate, so the fallback must
    // not ride into the write either (it would re-attribute field_sources to
    // this filing's source for a column the admin owns).
    const s = makeDeps();
    s.deps.protectionFilter = vi.fn(async (_id, table, data: Record<string, unknown>) => {
      if (table !== 'ipos') return { filtered: data };
      const filtered = { ...data };
      delete filtered.openDate;
      return { filtered };
    });
    const extraction = extractionFromOracle('PRICE_BAND_AD');
    delete extraction.fields.open_date;
    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect('openDate' in scraped).toBe(false);
    expect(summary.skipped_protected).toContain('ipos.openDate');
    // Unprotected closeDate (also carried by the filing here) still lands.
    expect(scraped.closeDate).toBe('2026-09-03');
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
      'ipos',
      'ipo_details',
      'ipo_valuation',
      'financial_statements',
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

describe('filing-persister — each stored row keeps its OWN unit (MOD-4)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('agrees when FY2024 is stored in MILLION and FY2025 in CRORE', async () => {
    const s = makeDeps();
    // The unique key is (ipo_id, fiscal_year, basis) and does NOT include the
    // unit, so a table legitimately holds different units per year. Taking
    // row[0]'s unit for the whole set compared FY2025 as if it were millions
    // and reported a 10x disagreement that does not exist.
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2024,
          basis: 'RESTATED',
          unit: 'MILLION',
          revenue: '10245.68',
          pat: '243.47',
          epsBasic: '2.97',
        },
        {
          ipoId: IPO_ID,
          fiscalYear: 2025,
          basis: 'RESTATED',
          unit: 'CRORE',
          // Rs 13,970.10 million === Rs 1,397.010 crore. Same money.
          revenue: '1397.010',
          pat: '40.580',
          epsBasic: '4.95',
        },
      ]);

    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    expect(summary.skipped_cross_document_disagreement).toEqual([]);
    expect(summary.written.financial_statements).toBe(3);
  });

  it('still catches a real disagreement in a row stored in another unit', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2025,
          basis: 'RESTATED',
          unit: 'CRORE',
          // 20% away from the ad's 13,970.10 million once converted.
          revenue: '1676.412',
          pat: '40.580',
          epsBasic: '4.95',
        },
      ]);
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    expect(summary.skipped_cross_document_disagreement.length).toBeGreaterThan(0);
    expect(s.finStmt).not.toHaveBeenCalled();
  });

  it('skips a stored row whose unit cannot be read rather than guessing', async () => {
    const s = makeDeps();
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        {
          ipoId: IPO_ID,
          fiscalYear: 2025,
          basis: 'RESTATED',
          unit: 'TONNES',
          revenue: '1',
          pat: '1',
          epsBasic: '1',
        },
      ]);
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    // Unreadable unit is not comparable at any scale, so it contributes no
    // disagreement - it must not be read as millions and blow the whole block away.
    expect(summary.skipped_cross_document_disagreement).toEqual([]);
  });
});

describe('filing-persister - protected columns never reach a write payload (CRITICAL-1)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  /**
   * WHY THIS BLOCK EXISTS: round 7 asserted only that the gate was CALLED for
   * each table. ipo_valuation computed the filtered set, used it for the
   * emptiness check, and then built the upsert payload from the UNFILTERED
   * object - so the assertion passed while every protected value was still
   * overwritten. These are substance assertions: the protected column must be
   * absent from the payload that actually reaches the writer, and the
   * unprotected columns must still be written.
   */
  function protectFields(protectedCols: Record<string, string[]>) {
    return vi.fn(async (_id: string, table: string, data: Record<string, unknown>) => {
      const filtered = { ...data };
      for (const col of protectedCols[table] ?? []) delete filtered[col];
      return { filtered };
    });
  }

  it('a protected total_shares_at_cap is omitted from the upsert, the other legs still write', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ ipo_valuation: ['totalSharesAtCap'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const row = s.valuation.mock.calls[0][0] as Record<string, unknown>;
    expect('totalSharesAtCap' in row).toBe(false);
    expect(row.totalSharesAtFloor).toBe(26729292);
    expect(row.ofsShares).toBe(11848340);
    expect(summary.skipped_protected).toContain('ipo_valuation.totalSharesAtCap');
  });

  it('ipo_valuation: a protected mcapAtCap is absent from the upsert, the rest still writes', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ ipo_valuation: ['mcapAtCap'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    expect(s.valuation).toHaveBeenCalledTimes(1);
    const row = s.valuation.mock.calls[0][0] as Record<string, unknown>;
    expect('mcapAtCap' in row).toBe(false);
    // Not written as null either - null would erase the admin's value.
    expect(row.mcapAtCap).toBeUndefined();
    // Unprotected columns still land.
    expect(row.mcapAtFloor).not.toBeUndefined();
    expect(row.ipoId).toBe(IPO_ID);
    expect(summary.skipped_protected).toContain('ipo_valuation.mcapAtCap');
  });

  it('ipos: a protected issueSize never reaches upsertIPO, the other scalars do', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ ipos: ['issueSize'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.issueSize).toBeUndefined();
    expect(scraped.priceRangeMin).toBe(168);
    expect(scraped.priceRangeMax).toBe(177);
    expect(summary.ipos_fields).not.toContain('issueSize');
    expect(summary.ipos_fields).toContain('priceRangeMin');
    expect(summary.skipped_protected).toContain('ipos.issueSize');
  });

  it('ipo_details: a protected freshIssue is absent from the details upsert', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ ipo_details: ['freshIssue'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const details = s.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect('freshIssue' in details).toBe(false);
    expect(details.ofsIssue).not.toBeUndefined();
    expect(summary.skipped_protected).toContain('ipo_details.freshIssue');
  });

  it('financial_data: a protected marketCap is absent from the row that is written', async () => {
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ financial_data: ['marketCap'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const fd = s.finData.mock.calls[0][0] as Record<string, unknown>;
    expect('marketCap' in fd).toBe(false);
    expect(fd.peRatio).toBe('13.85');
    expect(summary.skipped_protected).toContain('financial_data.marketCap');
  });

  it('financial_statements: a protected revenue keeps the stored value, never the filing value', async () => {
    const s = makeDeps();
    // The statement row is rewritten WHOLE, so a protected column cannot simply
    // be omitted (that writes null and erases it) - it is pinned to the stored
    // value, which is the admin's.
    // The stored value stays within the cross-document tolerance of the filing's
    // (19266.76) — a wildly different prior would trip the disagreement gate and
    // withhold the whole block, which is a different behaviour from this one.
    (s.deps.financialStatements as unknown as { listByIpo: ReturnType<typeof vi.fn> }).listByIpo =
      vi.fn(async () => [
        { fiscalYear: 2026, basis: 'RESTATED', unit: 'MILLION', revenue: '19270.00', pat: null },
      ]);
    s.deps.protectionFilter = protectFields({ financial_statements: ['revenue'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const fy2026 = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    // The admin's stored value, NOT the filing's 19266.76.
    expect(fy2026.revenue).toBe('19270.00');
    // Unprotected columns of the same row still take the filing's values.
    expect(fy2026.pat).toBe('1047.88');
    expect(summary.skipped_protected).toContain('financial_statements.revenue');
  });

  it('MINOR-2: with no stored financial_statements row, a "protected" revenue still gets the filing value and is not reported skipped', async () => {
    // Protection means "do not overwrite the admin's stored value." With no
    // row at all for this IPO (the default listByIpo() in makeDeps()), there
    // is no admin value to protect, so the insert must carry the filing's
    // revenue rather than a bare null, and skipped_protected must not claim a
    // skip that never actually withheld anything.
    const s = makeDeps();
    s.deps.protectionFilter = protectFields({ financial_statements: ['revenue'] });
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const fy2026 = s.finStmt.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.fiscalYear === 2026)!;
    expect(fy2026.revenue).toBe('19266.76');
    expect(summary.skipped_protected).not.toContain('financial_statements.revenue');
  });
});

describe('filing-persister - issue_size needs BOTH legs (MAJOR-1)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('writes no issueSize when the document carries the fresh leg alone', async () => {
    // The RHP prints fresh_issue_amount and no OFS line. Summing the fresh leg
    // with an assumed zero OFS understated Deepa's offer by Rs 2,097.16 mn - and
    // it is written as source DRHP, which outranks the exchanges' correct value.
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('RHP'),
      { docType: 'RHP', apply: true },
      s.deps
    );
    // The RHP carries no other ipos scalar either, so upsertIPO may not run at
    // all — what matters is that no issue_size is written on any path.
    const scraped =
      (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>] | undefined)?.[1] ??
      {};
    expect(scraped.issueSize).toBeUndefined();
    expect(summary.ipos_fields).not.toContain('issueSize');
    expect(summary.skipped_failed_check.some((x) => x.startsWith('ipos.issueSize'))).toBe(true);
  });

  it('still writes issueSize when both legs are present', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.issueSize).toBe(4_597_160_000);
    expect(summary.ipos_fields).toContain('issueSize');
  });

  it('a pure fresh issue is still writable when the filing states the OFS leg as 0', async () => {
    const s = makeDeps();
    const extraction = extractionFromOracle('RHP', {
      ofs_amount_at_cap: { value: 0, passed: true },
    });
    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', apply: true }, s.deps);
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.issueSize).toBe(2_500_000_000);
  });
});

/**
 * W-73 — the three tables migration 0042 created and the persister never wrote:
 * ipo_risk_factors, promoter_acquisition_ranges (1Y/18M/3Y) and
 * documents.filing_date. Each assertion is on the SUBSTANCE that reaches the
 * repository (seq/heading/body/kpis, one row per period, the date and the doc
 * type it lands on), not on "a call happened".
 */
function withW73Writers(s: ReturnType<typeof makeDeps>) {
  const replaceRiskFactors = vi.fn(async () => []);
  const setFilingDate = vi.fn(async () => 1);
  const bag = s.deps as unknown as Record<string, unknown>;
  bag.riskFactors = { replaceForIpo: replaceRiskFactors };
  bag.documentFilingDateWriter = { setFilingDate };
  return { replaceRiskFactors, setFilingDate };
}

const RISK_FACTORS_FIXTURE = [
  {
    n: 1,
    heading:
      'Our business is concentrated in Southern India and any adverse development in the region could affect our results.',
    body: 'For Fiscals 2026, 2025 and 2024, our revenue from Southern India was 98.12%, 97.44% and 96.81% of total revenue.',
    kpis: { southern_india_revenue_pct_fy2026: 98.12 },
  },
  {
    n: 2,
    heading: 'We depend on a limited number of suppliers for gold procurement.',
  },
  // Not a risk factor: the schema's heading column is NOT NULL.
  { n: 3, heading: '   ' },
];

function w73Extraction(section: 'PRICE_BAND_AD' | 'RHP' = 'RHP'): FilingExtraction {
  const extraction = extractionFromOracle(section);
  const pass = (value: unknown, name: string) => ({
    value,
    page: 23,
    check: { name, passed: true },
  });
  extraction.fields.risk_factors = pass(RISK_FACTORS_FIXTURE, 'risk_factor_headings_complete');
  extraction.fields.waca_last_1y = pass(12.5, 'cap_over_waca_equals_printed_multiple');
  extraction.fields.cap_multiple_last_1y = pass(6.4, 'cap_over_waca_equals_printed_multiple');
  extraction.fields.waca_last_18m = pass(18.75, 'cap_over_waca_equals_printed_multiple');
  extraction.fields.waca_last_3y = pass(20, 'cap_over_waca_equals_printed_multiple');
  extraction.fields.cap_multiple_last_3y = pass(4, 'cap_over_waca_equals_printed_multiple');
  return extraction;
}

describe('filing-persister — W-73 risk factors / acquisition ranges / filing date', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
  });

  it('(1) writes the risk factors with seq, heading, body and kpis from the extraction', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    const summary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction(),
      { docType: 'RHP', apply: true },
      s.deps
    );

    expect(w.replaceRiskFactors).toHaveBeenCalledTimes(1);
    const [ipoIdArg, rows] = w.replaceRiskFactors.mock.calls[0] as unknown as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(ipoIdArg).toBe(IPO_ID);
    // The blank-heading item is dropped, not written as an empty risk factor.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      ipoId: IPO_ID,
      seq: 1,
      heading: RISK_FACTORS_FIXTURE[0].heading,
      body: RISK_FACTORS_FIXTURE[0].body,
      kpis: { southern_india_revenue_pct_fy2026: 98.12 },
    });
    expect(rows[1]).toEqual({
      ipoId: IPO_ID,
      seq: 2,
      heading: RISK_FACTORS_FIXTURE[1].heading,
      body: null,
      kpis: null,
    });
    expect(summary.written.ipo_risk_factors).toBe(2);
  });

  it('(2) refuses the risk-factor replace when a column is admin-protected', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    (s.deps as unknown as Record<string, unknown>).protectionFilter = vi.fn(
      async (_ipoId: string, tableName: string, data: Record<string, unknown>) => {
        if (tableName !== 'ipo_risk_factors') return { filtered: data };
        const { body: _protected, ...rest } = data;
        return { filtered: rest };
      }
    );

    const summary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction(),
      { docType: 'RHP', apply: true },
      s.deps
    );

    // A whole-set replace deletes the stored rows first, so a protected column
    // can only be honoured by refusing the replace outright.
    expect(w.replaceRiskFactors).not.toHaveBeenCalled();
    expect(summary.written.ipo_risk_factors).toBeUndefined();
    expect(summary.skipped_protected).toContain(
      'ipo_risk_factors (whole-row replace refused: body protected)'
    );
  });

  it('(3) writes one acquisition-range row per period the filing prints (1Y/18M/3Y)', async () => {
    const s = makeDeps();
    withW73Writers(s);
    const summary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction(),
      { docType: 'RHP', apply: true },
      s.deps
    );

    expect(s.replaceRanges).toHaveBeenCalledTimes(1);
    const [, rows] = s.replaceRanges.mock.calls[0] as unknown as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(rows.map((r) => r.period)).toEqual(['1Y', '18M', '3Y']);
    expect(rows[0]).toMatchObject({ period: '1Y', waca: '12.5', capMultiple: '6.4' });
    // 18M prints a WACA but no multiple — the multiple stays null, not 0.
    expect(rows[1]).toMatchObject({ period: '18M', waca: '18.75', capMultiple: null });
    expect(rows[2]).toMatchObject({ period: '3Y', waca: '20', capMultiple: '4' });
    // The extractor prints no per-period price range; nothing is invented.
    expect(rows.every((r) => r.priceLow === null && r.priceHigh === null)).toBe(true);
    expect(summary.written.promoter_acquisition_ranges).toBe(3);
  });

  it('(4) sets filing_date on the RHP documents row, from either document', async () => {
    const fromRhp = makeDeps();
    const wRhp = withW73Writers(fromRhp);
    const rhpSummary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction('RHP'),
      { docType: 'RHP', apply: true },
      fromRhp.deps
    );
    expect(wRhp.setFilingDate).toHaveBeenCalledWith({
      ipoId: IPO_ID,
      docType: 'RHP',
      filingDate: '2026-08-25',
    });
    expect(rhpSummary.written.documents).toBe(1);

    // The price-band ad PRINTS the RHP's filing date on its face. It must land
    // on the RHP's row — stamping the ad's own row with it would be wrong.
    const fromAd = makeDeps();
    const wAd = withW73Writers(fromAd);
    await persistFilingExtraction(
      IPO_ID,
      w73Extraction('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', documentId: 'the-ad-document-id', apply: true },
      fromAd.deps
    );
    expect(wAd.setFilingDate).toHaveBeenCalledTimes(1);
    const arg = wAd.setFilingDate.mock.calls[0][0] as { docType: string };
    expect(arg.docType).toBe('RHP');
    expect(arg.docType).not.toBe('PRICE_BAND_AD');
  });

  it('(5) writes none of the three when the IPO row is scraper_locked', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    (s.deps.ipoRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById = vi.fn(
      async () => ({
        id: IPO_ID,
        companyName: 'Deepa Jewellers Limited',
        scraperLocked: true,
        leadManagers: [],
      })
    );

    await expect(
      persistFilingExtraction(IPO_ID, w73Extraction(), { docType: 'RHP', apply: true }, s.deps)
    ).rejects.toThrow(/scraper_locked/);

    expect(w.replaceRiskFactors).not.toHaveBeenCalled();
    expect(s.replaceRanges).not.toHaveBeenCalled();
    expect(w.setFilingDate).not.toHaveBeenCalled();
  });

  it('(6) a dry run writes none of the three but reports all of them', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    const summary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction(),
      { docType: 'RHP' },
      s.deps
    );

    expect(w.replaceRiskFactors).not.toHaveBeenCalled();
    expect(s.replaceRanges).not.toHaveBeenCalled();
    expect(w.setFilingDate).not.toHaveBeenCalled();
    expect(s.trackField).not.toHaveBeenCalled();
    expect(summary.applied).toBe(false);
    expect(summary.written.ipo_risk_factors).toBe(2);
    expect(summary.written.promoter_acquisition_ranges).toBe(3);
    expect(summary.written.documents).toBe(1);
  });

  it('reports the rows instead of dropping them when a writer is not wired', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      w73Extraction(),
      { docType: 'RHP', apply: true },
      s.deps
    );
    expect(summary.written.ipo_risk_factors).toBeUndefined();
    expect(summary.written.documents).toBeUndefined();
    expect(summary.skipped_no_column.some((x) => x.startsWith('risk_factors (2 rows'))).toBe(true);
    expect(summary.skipped_no_column.some((x) => x.startsWith('rhp_filing_date ('))).toBe(true);
  });
});

/**
 * W-82 — NO_COLUMN_FIELDS was stale: it reported fields as having no column
 * although the schema has one. `cin` is the mapped case (ipos.cin, varchar(21));
 * `concentration_kpis` is the conditionally-mapped case (ipo_risk_factors.kpis
 * is jsonb ON a risk-factor row, so it lands only when a matching risk factor
 * is written in the same run).
 */
describe('filing-persister — W-82 cin -> ipos.cin', () => {
  const DEEPA_CIN = 'U74999TG2016PLC109435';

  beforeEach(() => {
    upsertIPOMock.mockClear();
  });

  it('sends the CIN the document prints to ipos.cin via upsertIPO', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );

    const [, scraped, source] = upsertIPOMock.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
      string,
    ];
    expect(scraped.cin).toBe(DEEPA_CIN);
    expect(source).toBe('DRHP');
    expect(summary.ipos_fields).toContain('cin');
    // It must no longer be reported as having no column.
    expect(summary.skipped_no_column.some((x) => x.startsWith('cin ('))).toBe(false);
  });

  it('refuses a value that is not a 21-character CIN instead of overflowing the column', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD', {
        cin: { value: 'Corporate Identity Number: not-a-cin', passed: true },
      }),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.cin).toBeUndefined();
    expect(summary.ipos_fields).not.toContain('cin');
    expect(summary.skipped_failed_check.some((x) => x.startsWith('ipos.cin:'))).toBe(true);
  });

  it('honours field protection on ipos.cin', async () => {
    const s = makeDeps();
    (s.deps as unknown as Record<string, unknown>).protectionFilter = vi.fn(
      async (_ipoId: string, tableName: string, data: Record<string, unknown>) => {
        if (tableName !== 'ipos') return { filtered: data };
        const { cin: _protected, ...rest } = data;
        return { filtered: rest };
      }
    );
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD', apply: true },
      s.deps
    );
    const scraped = (upsertIPOMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(scraped.cin).toBeUndefined();
    expect(summary.ipos_fields).not.toContain('cin');
    expect(summary.skipped_protected).toContain('ipos.cin');
  });

  it('plans but does not write the CIN on a dry run', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionFromOracle('PRICE_BAND_AD'),
      { docType: 'PRICE_BAND_AD' },
      s.deps
    );
    expect(upsertIPOMock).not.toHaveBeenCalled();
    expect(summary.applied).toBe(false);
    expect(summary.ipos_fields).toContain('cin');
  });

  it('writes no CIN at all when the IPO row is scraper_locked', async () => {
    const s = makeDeps();
    (s.deps.ipoRepository as unknown as { findById: unknown }).findById = vi.fn(async () => ({
      id: IPO_ID,
      companyName: 'Deepa Jewellers Limited',
      offeringType: 'IPO',
      status: 'OPEN',
      scraperLocked: true,
    }));
    await expect(
      persistFilingExtraction(
        IPO_ID,
        extractionFromOracle('PRICE_BAND_AD'),
        { docType: 'PRICE_BAND_AD', apply: true },
        s.deps
      )
    ).rejects.toThrow(/scraper_locked/);
    expect(upsertIPOMock).not.toHaveBeenCalled();
  });
});

describe('filing-persister — W-82 concentration_kpis -> ipo_risk_factors.kpis', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
  });

  const KPIS = [
    { label: 'gold procurement', value_pct: 91.4 },
    { label: 'online marketplaces', value_pct: 12.5 },
  ];

  it('attaches each KPI to the risk factor whose heading names it, and reports the rest', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    const extraction = w73Extraction();
    extraction.fields.concentration_kpis = {
      value: KPIS,
      page: 24,
      check: { name: 'concentration_percentages_in_range', passed: true },
    };

    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', apply: true },
      s.deps
    );

    const rows = w.replaceRiskFactors.mock.calls[0][1] as Array<Record<string, unknown>>;
    // 'gold procurement' appears in the supplier risk's heading; that row carried
    // no kpis of its own, so the KPI lands on it as the stored jsonb value.
    const supplier = rows.find((r) => String(r.heading).includes('gold procurement'));
    expect(supplier?.kpis).toEqual([KPIS[0]]);
    // The concentration risk already carries the extractor's own per-risk kpis —
    // untouched.
    const southern = rows.find((r) => String(r.heading).includes('Southern India'));
    expect(southern?.kpis).toEqual({ southern_india_revenue_pct_fy2026: 98.12 });
    // No heading names 'online marketplaces' — reported, never silently dropped.
    expect(
      summary.skipped_no_column.some(
        (x) => x.startsWith('concentration_kpis (') && x.includes('online marketplaces')
      )
    ).toBe(true);
    expect(
      summary.skipped_no_column.some((x) => x.includes('gold procurement'))
    ).toBe(false);
  });

  it('refuses the whole replace (KPIs included) when a risk-factor column is protected', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    (s.deps as unknown as Record<string, unknown>).protectionFilter = vi.fn(
      async (_ipoId: string, tableName: string, data: Record<string, unknown>) => {
        if (tableName !== 'ipo_risk_factors') return { filtered: data };
        const { kpis: _protected, ...rest } = data;
        return { filtered: rest };
      }
    );
    const extraction = w73Extraction();
    extraction.fields.concentration_kpis = {
      value: KPIS,
      page: 24,
      check: { name: 'concentration_percentages_in_range', passed: true },
    };

    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', apply: true },
      s.deps
    );

    expect(w.replaceRiskFactors).not.toHaveBeenCalled();
    expect(summary.written.ipo_risk_factors).toBeUndefined();
    expect(summary.skipped_protected).toContain(
      'ipo_risk_factors (whole-row replace refused: kpis protected)'
    );
  });

  it('plans the KPI attachment on a dry run without writing it', async () => {
    const s = makeDeps();
    const w = withW73Writers(s);
    const extraction = w73Extraction();
    extraction.fields.concentration_kpis = {
      value: KPIS,
      page: 24,
      check: { name: 'concentration_percentages_in_range', passed: true },
    };

    const summary = await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP' }, s.deps);

    expect(w.replaceRiskFactors).not.toHaveBeenCalled();
    expect(summary.applied).toBe(false);
    expect(summary.written.ipo_risk_factors).toBe(2);
  });
});
