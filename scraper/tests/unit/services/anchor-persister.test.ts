/**
 * T-434 W-51 — anchor allocation report persistence.
 *
 * The fixture is the DEEPA anchor report as the parser reads it: 15 investors,
 * 7,791,789 shares, Rs 137.91 Cr, names OCR-garbled, category Unknown except
 * three mutual funds. The gates are arithmetic — the rows must reconcile with
 * the printed totals — because the numbers are the only part of a scanned
 * report that can be checked at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/services/data-persister.js', () => ({
  createAnchorInvestors: vi.fn(async () => 'anchor-row-id'),
}));

import {
  persistAnchorReport,
  runAnchorChecks,
  isLowConfidenceName,
  type AnchorPersisterDeps,
} from '../../../src/services/anchor-persister';
import type { AnchorInvestorData } from '../../../src/scrapers/anchor-investors-scraper';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';
const COMPANY = 'Deepa Jewellers Limited';

const BID = new Date(Date.UTC(2026, 7, 31));
const LOCK50 = new Date(Date.UTC(2026, 8, 30));
const LOCKREST = new Date(Date.UTC(2026, 10, 29));

/**
 * 15 rows summing EXACTLY to 7,791,789 shares and 137.9147 Cr. Three carry real
 * mutual-fund names and three are the OCR shrapnel the parser actually returns
 * - 3 of 15 (20%), deliberately UNDER the W-81 `NAME_QUALITY_FLOOR`, so this
 * fixture exercises the tolerated-stray-row path. The gate itself (a read where
 * most names are shrapnel) has its own describe block below.
 */
function deepaAnchorFixture(): AnchorInvestorData {
  // Shares sum EXACTLY to the printed 7,791,789; each amount is the row's
  // shares at the Rs 177 cap, in crore (shares * 177 / 1e7).
  const rows = [
    { name: 'ICICI Prudential Mutual Fund', type: 'Mutual Fund', shares: 700000, amount: 12.39 },
    { name: 'SBI Mutual Fund', type: 'Mutual Fund', shares: 600000, amount: 10.62 },
    { name: 'HDFC Mutual Fund', type: 'Mutual Fund', shares: 400000, amount: 7.08 },
    { name: 'Aq u1la G1oba1 Fund L td', type: 'Unknown', shares: 700000, amount: 12.39 },
    { name: 'M0rgan V3ntures PCC', type: 'Unknown', shares: 650000, amount: 11.505 },
    { name: 'Saint Capital Partners', type: 'Unknown', shares: 600000, amount: 10.62 },
    { name: 'Nexus Opportunities', type: 'Unknown', shares: 550000, amount: 9.735 },
    { name: 'Bright$tone Invest', type: 'Unknown', shares: 500000, amount: 8.85 },
    { name: 'Vantage Asset Co', type: 'Unknown', shares: 480000, amount: 8.496 },
    { name: 'Orion Value Fund', type: 'Unknown', shares: 450000, amount: 7.965 },
    { name: 'Ke y st one Alpha', type: 'Unknown', shares: 420000, amount: 7.434 },
    { name: 'Ridgeline Partners', type: 'Unknown', shares: 400000, amount: 7.08 },
    { name: 'Sum mit Cap Ltd', type: 'Unknown', shares: 380000, amount: 6.726 },
    { name: 'Altitude Growth', type: 'Unknown', shares: 360000, amount: 6.372 },
    { name: 'Pinnacle Trust', type: 'Unknown', shares: 601789, amount: 10.6517 },
  ];

  const totalShares = rows.reduce((t, r) => t + r.shares, 0);
  const totalAmount = Number(rows.reduce((t, r) => t + r.amount, 0).toFixed(4));
  return {
    bidDate: BID,
    totalSharesOffered: totalShares,
    totalAmountRaised: totalAmount,
    anchorInvestorsCount: rows.length,
    // The letter's OWN printed figures, read off its Total row and prose —
    // independent of the summed rows, which is what makes the gates real.
    printedTotalShares: 7_791_789,
    printedTotalAmountRaised: 137.9147,
    printedCount: 15,
    percentageCheckPassed: true,
    sharesTimesPriceCheckPassed: true,
    lockIn50PercentDate: LOCK50,
    lockInRemainingDate: LOCKREST,
    investorList: rows.map((r) => ({
      ...r,
      percentOfIssue: Number(((r.shares / totalShares) * 100).toFixed(4)),
    })),
  } as AnchorInvestorData;
}

function makeDeps(
  data: AnchorInvestorData | null,
  ipoRow: { companyName?: string; scraperLocked?: boolean } | null = {
    companyName: COMPANY,
    scraperLocked: false,
  }
): {
  deps: AnchorPersisterDeps;
  persist: ReturnType<typeof vi.fn>;
  scrape: ReturnType<typeof vi.fn>;
} {
  const persist = vi.fn(async () => 'anchor-row-id');
  const scrape = vi.fn(async () => data);
  return {
    persist,
    scrape,
    deps: {
      scrapeAnchorReport: scrape as unknown as AnchorPersisterDeps['scrapeAnchorReport'],
      anchorInvestorRepository: { findByIPOId: vi.fn(), create: vi.fn(), update: vi.fn() },
      ipoRepository: { findById: vi.fn(async () => ipoRow) },
      persist: persist as unknown as AnchorPersisterDeps['persist'],
    },
  };
}

describe('anchor-persister — the DEEPA report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has a fixture that matches the printed totals', () => {
    const d = deepaAnchorFixture();
    expect(d.investorList).toHaveLength(15);
    expect(d.totalSharesOffered).toBe(7_791_789);
    expect(d.totalAmountRaised).toBeCloseTo(137.9147, 4);
  });

  it('writes all 15 investors with the totals intact', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(summary.written).toBe(1);
    expect(summary.investorsWritten).toBe(15);
    expect(summary.totals).toEqual({
      shares: 7_791_789,
      amountCrore: 137.9147,
      count: 15,
    });

    expect(persist).toHaveBeenCalledTimes(1);
    const [, id, payload] = persist.mock.calls[0] as unknown as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe(IPO_ID);
    expect(payload.totalSharesOffered).toBe(7_791_789);
    expect(payload.anchorInvestorsCount).toBe(15);
    expect(payload.bidDate).toBe(BID);
    expect(payload.lockIn50PercentDate).toBe(LOCK50);
    expect(payload.lockInRemainingDate).toBe(LOCKREST);
    expect((payload.investorList as unknown[]).length).toBe(15);
  });

  it('stores garbled names verbatim and reports them, never cleaning them up', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    // anchor_investors has no name-confidence column and investor_list is a
    // typed jsonb the web layer reads, so the marker lives in the summary.
    expect(summary.lowConfidenceNames.length).toBeGreaterThan(0);
    expect(summary.lowConfidenceNames).toContain('Aq u1la G1oba1 Fund L td');
    expect(summary.lowConfidenceNames).not.toContain('SBI Mutual Fund');

    const payload = (persist.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    const names = (payload.investorList as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain('Aq u1la G1oba1 Fund L td');
  });

  it('flags OCR shrapnel and passes clean names', () => {
    expect(isLowConfidenceName('SBI Mutual Fund')).toBe(false);
    expect(isLowConfidenceName('ICICI Prudential Mutual Fund')).toBe(false);
    expect(isLowConfidenceName('S a i n t C a p i t a l')).toBe(true);
    expect(isLowConfidenceName('Bright$tone Invest')).toBe(true);
    expect(isLowConfidenceName('Ab')).toBe(true);
  });

  it('writes nothing in dry-run mode but still reports the plan', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.applied).toBe(false);
    expect(summary.investorsWritten).toBe(15);
  });
});

describe('anchor-persister — a report whose arithmetic does not close writes NOTHING', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses when the investor shares do not sum to the printed total', async () => {
    const bad = deepaAnchorFixture();
    // One digit mis-read by the OCR: 601,789 -> 501,789.
    bad.investorList[14].shares = 501_789;
    const { deps, persist } = makeDeps(bad);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.investorsWritten).toBe(0);
    expect(summary.totals).toBeNull();
    expect(summary.refusedReason).toContain('shares_sum_to_printed_total');
    // The summed rows and the letter's PRINTED total, side by side.
    expect(summary.refusedReason).toContain('7691789');
    expect(summary.refusedReason).toContain('7791789');
  });

  it('refuses when the printed count disagrees with the number of rows', async () => {
    const bad = deepaAnchorFixture();
    (bad as unknown as { printedCount: number }).printedCount = 16;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('count_matches_printed');
  });

  it('refuses when the amounts do not reconcile with the printed total', async () => {
    const bad = deepaAnchorFixture();
    (bad as unknown as { printedTotalAmountRaised: number }).printedTotalAmountRaised = 140.0;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('amounts_sum_to_printed_total');
  });

  it('refuses when a NOT NULL date is missing rather than letting the insert throw', async () => {
    const bad = deepaAnchorFixture();
    bad.lockInRemainingDate = null;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('required_dates_present');
  });

  it('refuses a lock-in date that falls before the bid date', async () => {
    const bad = deepaAnchorFixture();
    bad.lockIn50PercentDate = new Date(Date.UTC(2026, 6, 1));
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('lock_in_after_bid');
  });

  it('reports a missing report instead of throwing', async () => {
    const { deps, persist } = makeDeps(null);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.refusedReason).toContain('no anchor allocation report');
  });

  it('names every failing gate, so a refusal is diagnosable', () => {
    const bad = deepaAnchorFixture();
    bad.investorList[0].shares += 1;
    const failed = runAnchorChecks(bad).filter((c) => !c.passed);
    // Only the printed-vs-summed shares gate fails; the amount still ties out
    // because the row's amount was not touched.
    expect(failed.map((c) => c.name)).toContain('shares_sum_to_printed_total');
  });
});

describe('anchor-persister — the gates compare against the PRINTED figures (MAJOR-2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails when the letter prints a different total from the rows it lists', async () => {
    const bad = deepaAnchorFixture();
    // Rows unchanged and self-consistent; the LETTER's total row says otherwise.
    // Round 3 compared the summed rows with themselves and could never see this.
    (bad as unknown as { printedTotalShares: number }).printedTotalShares = 7_691_789;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.refusedReason).toContain('shares_sum_to_printed_total');
    expect(summary.refusedReason).toContain('7791789');
    expect(summary.refusedReason).toContain('7691789');
  });

  it('accepts an unreadable printed total ONLY when both parser cross-checks passed', async () => {
    const d = deepaAnchorFixture();
    (d as unknown as { printedTotalShares: number | null }).printedTotalShares = null;
    (d as unknown as { printedTotalAmountRaised: number | null }).printedTotalAmountRaised = null;
    (d as unknown as { printedCount: number | null }).printedCount = null;
    const { deps, persist } = makeDeps(d);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    // The three gates are reported as not-checkable, never as clean passes.
    expect(summary.notCheckable.sort()).toEqual([
      'amounts_sum_to_printed_total',
      'count_matches_printed',
      'shares_sum_to_printed_total',
    ]);
  });

  it('refuses an unreadable printed total when a parser cross-check did not pass', async () => {
    const d = deepaAnchorFixture();
    (d as unknown as { printedTotalShares: number | null }).printedTotalShares = null;
    (d as unknown as { printedTotalAmountRaised: number | null }).printedTotalAmountRaised = null;
    (d as unknown as { printedCount: number | null }).printedCount = null;
    (d as unknown as { percentageCheckPassed: boolean }).percentageCheckPassed = false;
    const { deps, persist } = makeDeps(d);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.refusedReason).toContain('REFUSED because the parser cross-checks');
  });

  it('treats a missing printed figure as not-checkable, never as agreement', () => {
    const d = deepaAnchorFixture();
    (d as unknown as { printedTotalShares: number | null }).printedTotalShares = null;
    const check = runAnchorChecks(d).find((c) => c.name === 'shares_sum_to_printed_total')!;
    expect(check.notCheckable).toBe(true);
    expect(check.detail).toContain('could not be read');
  });
});

describe('anchor-persister — a mangled printed total must not refuse a good report (round 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  /** What the parser now emits for DEEPA: the mangled totals nulled out. */
  function deepaWithMangledPrintedTotals() {
    const d = deepaAnchorFixture();
    const x = d as unknown as Record<string, unknown>;
    // The scan printed "77 9 749" / "1 7 9 653.OO"; neither is plausible against
    // the summed rows, so the parser reports them as unreadable rather than as a
    // figure that disagrees.
    x.printedTotalShares = null;
    x.printedTotalAmountRaised = null;
    return d;
  }

  it('(1) accepts DEEPA: printed gates not_checkable, both cross-checks passed', async () => {
    const { deps, persist } = makeDeps(deepaWithMangledPrintedTotals());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(summary.investorsWritten).toBe(15);
    expect(summary.notCheckable.sort()).toEqual([
      'amounts_sum_to_printed_total',
      'shares_sum_to_printed_total',
    ]);
    // Not-checkable is never reported as a clean pass.
    const shares = summary.checks.find((c) => c.name === 'shares_sum_to_printed_total')!;
    expect(shares.notCheckable).toBe(true);
    expect(shares.detail).toContain('could not be read');
  });

  it('(2) refuses the same report when a parser cross-check did not pass', async () => {
    const d = deepaWithMangledPrintedTotals();
    (d as unknown as Record<string, unknown>).percentageCheckPassed = false;
    const { deps, persist } = makeDeps(d);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.refusedReason).toContain('REFUSED because the parser cross-checks');
  });

  it('(3) still hard-FAILS a READABLE printed total that is off by 3%', async () => {
    const d = deepaAnchorFixture();
    // 8,025,542 is plausible (same digit count, well inside a factor of 2) and
    // therefore a real disagreement — exactly the corroboration this mechanism
    // exists for. Loosening this would restore the round-3 x === x hole.
    (d as unknown as Record<string, unknown>).printedTotalShares = 8_025_542;
    const { deps, persist } = makeDeps(d);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.refusedReason).toContain('shares_sum_to_printed_total');
    expect(summary.notCheckable).not.toContain('shares_sum_to_printed_total');
    expect(summary.refusedReason).toContain('8025542');
  });

  it('(4) passes a readable printed total that matches the summed rows', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(summary.notCheckable).toEqual([]);
    const shares = summary.checks.find((c) => c.name === 'shares_sum_to_printed_total')!;
    expect(shares.passed).toBe(true);
    expect(shares.notCheckable).toBeUndefined();
  });
});

describe('anchor-persister — admin field protection (MAJOR-2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses the write when an admin has protected a field', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    // anchor_investors is admin-editable (web/lib/admin/table-map-generator.ts).
    deps.protectionFilter = vi.fn(async (_id, _t, data: Record<string, unknown>) => {
      const filtered = { ...data };
      delete filtered.totalAmountRaised;
      return { filtered };
    });

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    // createAnchorInvestors rewrites the single anchor row whole, so a protected
    // field cannot survive a partial write - nothing is written at all.
    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.investorsWritten).toBe(0);
    expect(summary.refusedReason).toContain('anchor_investors write refused');
    expect(summary.refusedReason).toContain('totalAmountRaised');
  });

  it('asks the gate about the anchor_investors table by name', async () => {
    const { deps } = makeDeps(deepaAnchorFixture());
    deps.protectionFilter = vi.fn(async (_id, _t, data: Record<string, unknown>) => ({
      filtered: data,
    }));
    await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(deps.protectionFilter).toHaveBeenCalledWith(
      IPO_ID,
      'anchor_investors',
      expect.objectContaining({ totalSharesOffered: 7791789 }),
      'DRHP'
    );
  });

  it('writes normally when nothing is protected', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    deps.protectionFilter = vi.fn(async (_id, _t, data: Record<string, unknown>) => ({
      filtered: data,
    }));
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(summary.refusedReason).toBeNull();
  });

  it('refuses BEFORE writing even when the arithmetic gates all pass', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    deps.protectionFilter = vi.fn(async (_id, _t, data: Record<string, unknown>) => {
      const filtered = { ...data };
      delete filtered.investorList;
      return { filtered };
    });
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(summary.checks.every((c) => c.passed)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('investorList');
  });
});

describe('anchor-persister — ipos.scraper_locked (CRITICAL-2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses the whole anchor write for a locked IPO, before it even reads the report', async () => {
    // persistFilingExtraction refuses a locked IPO outright; this door did not
    // check the flag at all, so --doc-type ANCHOR_ALLOCATION_REPORT wrote through
    // an admin lock. The check lives in the persister, not the CLI.
    const { deps, persist, scrape } = makeDeps(deepaAnchorFixture(), {
      companyName: COMPANY,
      scraperLocked: true,
    });

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.investorsWritten).toBe(0);
    expect(summary.refusedReason).toContain('scraper_locked');
    // Same refusal shape as every other refusal on this path — the CLI turns a
    // non-null refusedReason into exit code 1.
    expect(summary.refusedReason).toContain(IPO_ID);
  });

  it('refuses when the IPO row does not exist', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture(), null);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('no IPO row');
  });

  it('writes normally when the row is not locked', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(summary.refusedReason).toBeNull();
  });
});

describe('anchor-persister — blank investor names (W-54)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops a blank-name row before writing and counts it, without touching the arithmetic gates', async () => {
    const bad = deepaAnchorFixture();
    // A whitespace-only OCR read on one row's name. Shares/amount untouched, so
    // the printed-total gates (computed from the fixture's original sums) still
    // agree — names are not an arithmetic gate.
    bad.investorList[5].name = '   ';
    const { deps, persist } = makeDeps(bad);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(summary.checks.every((c) => c.passed || c.notCheckable)).toBe(true);
    expect(summary.skippedBlankNames).toBe(1);
    expect(summary.investorsWritten).toBe(14);
    // Totals still reflect the letter's verified printed figures — unaffected
    // by dropping one unnamed row from the published list.
    expect(summary.totals).toEqual({ shares: 7_791_789, amountCrore: 137.9147, count: 15 });

    expect(persist).toHaveBeenCalledTimes(1);
    const payload = (persist.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    const names = (payload.investorList as Array<{ name: string }>).map((r) => r.name);
    expect(names).toHaveLength(14);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
  });

  it('also drops a truly empty-string name (not just whitespace)', async () => {
    const bad = deepaAnchorFixture();
    bad.investorList[10].name = '';
    const { deps, persist } = makeDeps(bad);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(summary.skippedBlankNames).toBe(1);
    expect(summary.investorsWritten).toBe(14);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('refuses the ENTIRE write when every investor row has a blank name — nothing to publish', async () => {
    const bad = deepaAnchorFixture();
    bad.investorList.forEach((r) => {
      r.name = '  ';
    });
    const { deps, persist } = makeDeps(bad);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.investorsWritten).toBe(0);
    expect(summary.totals).toBeNull();
    expect(summary.skippedBlankNames).toBe(15);
    expect(summary.refusedReason).toContain('blank name');
    expect(summary.refusedReason).toContain('nothing to publish');
  });

  it('still writes a garbled-but-present name as-is and lists it under lowConfidenceNames', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.skippedBlankNames).toBe(0);
    expect(summary.lowConfidenceNames).toContain('Aq u1la G1oba1 Fund L td');

    const payload = (persist.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    const names = (payload.investorList as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain('Aq u1la G1oba1 Fund L td');
  });

  it('leaves normal, fully-named reports unchanged (no blanks, nothing skipped)', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.skippedBlankNames).toBe(0);
    expect(summary.investorsWritten).toBe(15);
    expect(persist).toHaveBeenCalledTimes(1);
    const payload = (persist.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    expect((payload.investorList as unknown[]).length).toBe(15);
  });
});

describe('anchor-persister — the name-quality gate (W-81)', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The DEEPA report as it actually reached the live page: the PDF's own
   * embedded OCR text layer substituted glyphs (M -> "N4", I -> "]", W -> "I\4"),
   * so most investor names are shrapnel. Every number still reconciles, which is
   * exactly why the arithmetic gates let it through before this gate existed.
   */
  function garbledNameFixture() {
    const bad = deepaAnchorFixture();
    const garbled = [
      'N4 OT] LAL OSWAL FINVEST LI I\\4ITE D',
      'WH]TEOAK CAPITAL EQUITY FUND',
      'TAT TATA UNIFI I D N I MUTUAL D I I D A EN C o D N Y S FUND',
      'LRS D S EC U R I TI ES PVT LTD',
      '[4AYBANK SECURITIES PTE LTD . ODI',
      'GIR EQUITY N o N4 IK U RA FUND- S MULTICAP I N GA III PO RE',
      'SERIES 1',
      'NT ACCOU',
    ];
    garbled.forEach((name, i) => {
      bad.investorList[i].name = name;
    });
    return bad;
  }

  it('refuses the ENTIRE write when more than 30% of the investor names are unreadable', async () => {
    const { deps, persist } = makeDeps(garbledNameFixture());

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    // The arithmetic still closes — this is a NAME failure, and it must still stop the write.
    expect(summary.checks.every((c) => c.passed || c.notCheckable)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.written).toBe(0);
    expect(summary.investorsWritten).toBe(0);
    expect(summary.refusedReason).toContain('unreadable');
    expect(summary.lowConfidenceNames).toContain('N4 OT] LAL OSWAL FINVEST LI I\\4ITE D');
  });

  it('counts a blank name as an unreadable one, not as a free pass', async () => {
    const bad = garbledNameFixture();
    // Blank the shrapnel rows: dropping them silently would otherwise leave the
    // published list looking clean while most of the letter was never read.
    bad.investorList.slice(0, 8).forEach((r) => {
      r.name = '   ';
    });
    const { deps, persist } = makeDeps(bad);

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(persist).not.toHaveBeenCalled();
    expect(summary.skippedBlankNames).toBe(8);
    expect(summary.refusedReason).toContain('unreadable');
  });

  it('still publishes a report whose stray garbled names stay under the floor', async () => {
    const { deps, persist } = makeDeps(deepaAnchorFixture());

    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);

    expect(summary.refusedReason).toBeNull();
    expect(summary.lowConfidenceNames).toHaveLength(3);
    expect(summary.investorsWritten).toBe(15);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
