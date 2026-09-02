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
 * mutual-fund names; the rest are the OCR shrapnel the parser actually returns.
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
    { name: 'S a i n t C a p i t a l', type: 'Unknown', shares: 600000, amount: 10.62 },
    { name: 'Nex us 0pportunit1es', type: 'Unknown', shares: 550000, amount: 9.735 },
    { name: 'Bright$tone Invest', type: 'Unknown', shares: 500000, amount: 8.85 },
    { name: 'Vant4ge Asset Co', type: 'Unknown', shares: 480000, amount: 8.496 },
    { name: 'Ori0n Value Fund', type: 'Unknown', shares: 450000, amount: 7.965 },
    { name: 'Ke y st one Alpha', type: 'Unknown', shares: 420000, amount: 7.434 },
    { name: 'Ridge1ine Partners', type: 'Unknown', shares: 400000, amount: 7.08 },
    { name: 'Sum mit Cap Ltd', type: 'Unknown', shares: 380000, amount: 6.726 },
    { name: 'Alt1tude Growth', type: 'Unknown', shares: 360000, amount: 6.372 },
    { name: 'Pinn4cle Trust', type: 'Unknown', shares: 601789, amount: 10.6517 },
  ];

  const totalShares = rows.reduce((t, r) => t + r.shares, 0);
  const totalAmount = Number(rows.reduce((t, r) => t + r.amount, 0).toFixed(4));
  return {
    bidDate: BID,
    totalSharesOffered: totalShares,
    totalAmountRaised: totalAmount,
    anchorInvestorsCount: rows.length,
    lockIn50PercentDate: LOCK50,
    lockInRemainingDate: LOCKREST,
    investorList: rows.map((r) => ({
      ...r,
      percentOfIssue: Number(((r.shares / totalShares) * 100).toFixed(4)),
    })),
  } as AnchorInvestorData;
}

function makeDeps(data: AnchorInvestorData | null): {
  deps: AnchorPersisterDeps;
  persist: ReturnType<typeof vi.fn>;
} {
  const persist = vi.fn(async () => 'anchor-row-id');
  return {
    persist,
    deps: {
      scrapeAnchorReport: vi.fn(async () => data),
      anchorInvestorRepository: { findByIPOId: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    expect(summary.refusedReason).toContain('shares_sum_to_total');
    expect(summary.refusedReason).toContain('7691789');
    expect(summary.refusedReason).toContain('7791789');
  });

  it('refuses when the printed count disagrees with the number of rows', async () => {
    const bad = deepaAnchorFixture();
    bad.anchorInvestorsCount = 16;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('count_matches_rows');
  });

  it('refuses when the amounts do not reconcile with the printed total', async () => {
    const bad = deepaAnchorFixture();
    bad.totalAmountRaised = 140.0;
    const { deps, persist } = makeDeps(bad);
    const summary = await persistAnchorReport(IPO_ID, { companyName: COMPANY, apply: true }, deps);
    expect(persist).not.toHaveBeenCalled();
    expect(summary.refusedReason).toContain('amounts_sum_to_total');
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
    expect(failed.map((c) => c.name)).toEqual(['shares_sum_to_total']);
  });
});
