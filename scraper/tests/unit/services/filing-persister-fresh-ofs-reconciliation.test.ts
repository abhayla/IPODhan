/**
 * F-51 (build card item 13) — a fresh/OFS pair is written only when it
 * reconciles with the total ALREADY STORED on `ipos.issue_size`.
 *
 * Before this gate, `filing-persister.ts` computed
 * `offerTotalMn = statedTotalMn ?? (freshMn + ofsMn)` and marked BOTH
 * `ipo_details.freshIssue` and `ipo_details.ofsIssue` the moment a unit was
 * available. A sum compared against itself always agrees, so a digit-wrong
 * fresh leg was published unchallenged.
 *
 * The numbers below are the build card's ARITHMETICALLY VERIFIED rows —
 * Kanohar (`300 + 11,957,915 x 632 / 1e7 = 1055.740228`) and Glass Wall
 * (`60 + 20,213,722 x 182 / 1e7 = 427.8897404`). The card's "6 of 9 live IPOs
 * are wrong" population claim is explicitly UNVERIFIED and is NOT relied on
 * here: what these tests assert is the mechanism (there was no gate), not a
 * count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({ default: loggerMocks }));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b7c1d2e3-4f50-4a61-9c72-8d93ea04b5f6';
const CR = 10_000_000;

/** An RHP-shaped extraction; every value carries a PASSED check. */
function extraction(values: Record<string, unknown>): FilingExtraction {
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    fields[k] = { value: v, page: 1, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'RHP',
    source_doc: 'rhp_fixture.pdf',
    pages: 4,
    extraction_status: 'OK',
    unit: 'crore',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(storedIssueSize: string | null): {
  deps: FilingPersisterDeps;
  detailsUpsert: ReturnType<typeof vi.fn>;
  valuationUpsert: ReturnType<typeof vi.fn>;
} {
  const detailsUpsert = vi.fn(async () => undefined);
  const valuationUpsert = vi.fn(async (r: unknown) => r);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Reconciliation Fixture Limited',
        slug: 'reconciliation-fixture-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE'],
        issueSize: storedIssueSize,
      })),
    },
    financialStatements: {
      upsert: vi.fn(async (r: unknown) => r),
      listByIpo: vi.fn(async () => []),
    },
    ipoValuation: { upsert: valuationUpsert },
    promoters: {
      replacePromoters: vi.fn(async () => []),
      replaceAcquisitionRanges: vi.fn(async () => []),
    },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: vi.fn(async () => ({})),
    },
    ipoDetailsWriter: { upsert: detailsUpsert },
  } as unknown as FilingPersisterDeps;
  return { deps, detailsUpsert, valuationUpsert };
}

async function run(values: Record<string, unknown>, storedIssueSize: string | null) {
  const { deps, detailsUpsert, valuationUpsert } = makeDeps(storedIssueSize);
  const summary = await persistFilingExtraction(
    IPO_ID,
    extraction(values),
    { docType: 'RHP', apply: true },
    deps
  );
  const details = (detailsUpsert.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
  const scraped = (upsertIPOMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
  const valuation = (valuationUpsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
  return { summary, details, scraped, valuation };
}

/** Kanohar's real shape: 11,957,915 OFS shares at a Rs 632 cap. */
const KANOHAR_OFS_SHARES = 11_957_915;
const KANOHAR_CAP = 632;
const KANOHAR_OFS_CR = (KANOHAR_OFS_SHARES * KANOHAR_CAP) / CR; // 755.740228
const KANOHAR_TOTAL_RUPEES = String((300 + KANOHAR_OFS_CR) * CR); // 1055.740228 cr

beforeEach(() => {
  upsertIPOMock.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.info.mockClear();
});

describe('F-51 — fresh + OFS must reconcile with the STORED ipos.issue_size', () => {
  it('withholds BOTH legs when the pair does not reconcile with the stored issue size', async () => {
    // The card's Kanohar defect shape: a digit-wrong fresh leg (60 where the
    // filing says 300). 60 + 755.74 = 815.74 vs the stored 1055.74 — 22.7% out.
    const { summary, details, scraped } = await run(
      {
        fresh_issue_amount: 60,
        ofs_amount_at_cap: KANOHAR_OFS_CR,
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      KANOHAR_TOTAL_RUPEES
    );

    expect(details.freshIssue).toBeUndefined();
    expect(details.ofsIssue).toBeUndefined();
    // and the derived total that failed is not laundered into ipos either
    expect(scraped.issueSize).toBeUndefined();
    expect(
      summary.skipped_failed_check.some(
        (r) => r.includes('withheld TOGETHER (F-51)') && r.includes('stored_issue_size')
      )
    ).toBe(true);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reconciled: false, kind: 'total_mismatch' }),
      expect.stringContaining('F-51')
    );
  });

  it('writes BOTH legs when the same pair reconciles', async () => {
    const { details, scraped } = await run(
      {
        fresh_issue_amount: 300,
        ofs_amount_at_cap: KANOHAR_OFS_CR,
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      KANOHAR_TOTAL_RUPEES
    );

    expect(details.freshIssue).toBe('3000000000');
    expect(details.ofsIssue).toBe(String(KANOHAR_OFS_SHARES * KANOHAR_CAP));
    expect(scraped.issueSize).toBe(Math.round(Number(KANOHAR_TOTAL_RUPEES)));
  });

  it('accepts a delta of EXACTLY 0.5% (the boundary is inclusive)', async () => {
    // stored 100.00cr, pair sums to 100.50cr -> |0.5| / 100 = 0.005 exactly.
    const { details } = await run(
      { fresh_issue_amount: 95, ofs_amount_at_cap: 5.5 },
      String(100 * CR)
    );
    expect(details.freshIssue).toBe('950000000');
    expect(details.ofsIssue).toBe('55000000');
  });

  it('refuses a delta a hair OVER 0.5%', async () => {
    const { details, summary } = await run(
      { fresh_issue_amount: 95, ofs_amount_at_cap: 5.500001 },
      String(100 * CR)
    );
    expect(details.freshIssue).toBeUndefined();
    expect(details.ofsIssue).toBeUndefined();
    expect(summary.skipped_failed_check.some((r) => r.includes('withheld TOGETHER (F-51)'))).toBe(
      true
    );
  });

  it('writes the pair when ipos.issue_size is NULL and the filing states no total (no base, not a zero base)', async () => {
    const { details, summary } = await run(
      { fresh_issue_amount: 60, ofs_amount_at_cap: KANOHAR_OFS_CR },
      null
    );
    expect(details.freshIssue).toBe('600000000');
    expect(details.ofsIssue).toBe(String(Math.round(KANOHAR_OFS_CR * CR)));
    expect(summary.skipped_failed_check.some((r) => r.includes('withheld TOGETHER'))).toBe(false);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'unchecked', reconciled: true }),
      expect.stringContaining('reconciliation')
    );
  });

  it('treats a stored issue size of ZERO as no base, not as a zero total', async () => {
    const { details } = await run(
      { fresh_issue_amount: 60, ofs_amount_at_cap: KANOHAR_OFS_CR },
      '0'
    );
    expect(details.freshIssue).toBe('600000000');
    expect(details.ofsIssue).toBe(String(Math.round(KANOHAR_OFS_CR * CR)));
  });

  it('also reconciles against the total the DOCUMENT prints, alongside the stored one', async () => {
    // Glass Wall's verified shape, with a fresh leg that agrees with neither.
    const glassOfsCr = (20_213_722 * 182) / CR; // 367.8897404
    const { details, summary } = await run(
      {
        fresh_issue_amount: 6,
        ofs_amount_at_cap: glassOfsCr,
        total_offer_amount_at_cap: 60 + glassOfsCr,
      },
      String((60 + glassOfsCr) * CR)
    );
    expect(details.freshIssue).toBeUndefined();
    expect(details.ofsIssue).toBeUndefined();
    expect(summary.skipped_failed_check.some((r) => r.includes('stated_total'))).toBe(true);
  });
});

describe('F-51 — the two forms of OFS must agree before either is trusted', () => {
  it('withholds both legs AND ipo_valuation.ofsShares when ofs_shares x cap disagrees with the rupee figure', async () => {
    const { details, valuation, summary } = await run(
      {
        fresh_issue_amount: 300,
        ofs_amount_at_cap: KANOHAR_OFS_CR, // 755.74cr
        ofs_shares: 5_000_000, // x 632 = 316.00cr — 58% apart
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      KANOHAR_TOTAL_RUPEES
    );

    expect(details.freshIssue).toBeUndefined();
    expect(details.ofsIssue).toBeUndefined();
    expect(valuation.ofsShares).toBeUndefined();
    const reason = summary.skipped_failed_check.find((r) => r.includes('withheld TOGETHER (F-51)'));
    expect(reason).toContain('ofs_amount_at_cap');
    expect(reason).toContain('ofs_shares x priceCap');
    expect(reason).toContain('755.74');
    expect(reason).toContain('316.00');
  });

  it('accepts the pair when the two OFS forms agree, and still stores the share count', async () => {
    const { details, valuation } = await run(
      {
        fresh_issue_amount: 300,
        ofs_amount_at_cap: KANOHAR_OFS_CR,
        ofs_shares: KANOHAR_OFS_SHARES,
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      KANOHAR_TOTAL_RUPEES
    );
    expect(details.ofsIssue).toBe(String(KANOHAR_OFS_SHARES * KANOHAR_CAP));
    expect(valuation.ofsShares).toBe(KANOHAR_OFS_SHARES);
  });

  it('derives ofsIssue from the SHARE form when the filing states no rupee OFS figure', async () => {
    const { details } = await run(
      {
        fresh_issue_amount: 300,
        ofs_shares: KANOHAR_OFS_SHARES,
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      KANOHAR_TOTAL_RUPEES
    );
    expect(details.freshIssue).toBe('3000000000');
    expect(details.ofsIssue).toBe(String(KANOHAR_OFS_SHARES * KANOHAR_CAP));
  });
});

describe('F-51 — absence of a component is not a reconciliation failure', () => {
  it('writes a fresh-issue-only filing untouched (no OFS stated anywhere)', async () => {
    const { details, summary } = await run(
      { fresh_issue_amount: 300, price_band_floor: 601, price_band_cap: KANOHAR_CAP },
      KANOHAR_TOTAL_RUPEES
    );
    expect(details.freshIssue).toBe('3000000000');
    expect(details.ofsIssue).toBeUndefined();
    expect(summary.skipped_failed_check.some((r) => r.includes('withheld TOGETHER'))).toBe(false);
  });

  it('writes a nil-OFS filing (ofs stated as a present zero leg) and reconciles it', async () => {
    const { details, scraped } = await run(
      {
        fresh_issue_amount: 300,
        ofs_amount_at_cap: 0,
        ofs_shares: 0,
        total_offer_amount_at_cap: 300,
        price_band_floor: 601,
        price_band_cap: KANOHAR_CAP,
      },
      String(300 * CR)
    );
    expect(details.freshIssue).toBe('3000000000');
    expect(details.ofsIssue).toBe('0');
    expect(scraped.issueSize).toBe(300 * CR);
  });
});
