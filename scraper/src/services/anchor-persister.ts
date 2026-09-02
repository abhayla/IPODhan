/**
 * Anchor-report persister (walk step G4, W-51).
 *
 * The anchor allocation report parser (anchor-investors-scraper.ts) has existed
 * since 8cdde82d with no consumer. This is the write half: it runs the parser,
 * puts the result through arithmetic gates, and persists through
 * data-persister.createAnchorInvestors — never a direct Drizzle write.
 *
 * WHY GATES: the report is read out of a scanned PDF via OCR, so investor NAMES
 * arrive garbled and a mis-read digit in the shares column is entirely possible.
 * The numbers are checkable against each other (the rows must sum to the printed
 * totals), so a filing whose own arithmetic does not close is not persisted at
 * all — a half-right anchor book is worse than none.
 *
 * NAME CONFIDENCE: anchor_investors has no name-confidence column, and
 * `investor_list` is typed jsonb (IndividualInvestor[]) that the web layer
 * reads. Adding a key there would be inventing a field, so garbled names are
 * stored AS-IS and the low-confidence count is reported in the run summary
 * instead.
 */

import type { AnchorInvestorData } from '../scrapers/anchor-investors-scraper.js';
import { createAnchorInvestors } from './data-persister.js';
import logger from '../utils/logger.js';

export interface AnchorPersistOptions {
  companyName: string;
  /** false (default) runs every gate and reports the plan without writing. */
  apply?: boolean;
}

export interface AnchorPersisterDeps {
  /** scrapeAnchorInvestors from anchor-investors-scraper, injected for tests. */
  scrapeAnchorReport: (ipoId: string, companyName: string) => Promise<AnchorInvestorData | null>;
  anchorInvestorRepository: unknown;
  /** Overridable only so a test can assert the payload without a database. */
  persist?: typeof createAnchorInvestors;
}

export interface AnchorPersistSummary {
  written: number;
  investorsWritten: number;
  totals: { shares: number; amountCrore: number; count: number } | null;
  /** Every gate, in order, with its verdict — the audit trail for a refusal. */
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  /** Populated only when a gate failed; the run wrote nothing. */
  refusedReason: string | null;
  /** Names the OCR could not read cleanly. No column exists for this. */
  lowConfidenceNames: string[];
  applied: boolean;
}

/** Two crore figures agree when they are within half a lakh of each other. */
const AMOUNT_TOLERANCE_CRORE = 0.005;

/**
 * A name is low-confidence when OCR left it with characters no registered
 * investor name contains, or it is too short to be a real entity name.
 */
export function isLowConfidenceName(name: string): boolean {
  const n = (name || '').trim();
  if (n.length < 4) return true;
  if (/[^A-Za-z0-9 .,&()'\/-]/.test(n)) return true;
  // Runs of single letters separated by spaces are OCR shrapnel, not a name.
  if (/(^|\s)[A-Za-z](\s[A-Za-z]){3,}(\s|$)/.test(n)) return true;
  // A digit welded into an alphabetic word is the classic OCR substitution
  // ("G1oba1", "M0rgan", "Vant4ge"). Real entity names never do this, while
  // legitimate digits in a name stand alone ("Fund 2 Ltd").
  if (/[A-Za-z]\d|\d[A-Za-z]/.test(n)) return true;
  const letters = n.replace(/[^A-Za-z]/g, '').length;
  return letters / n.length < 0.6;
}

/** Every arithmetic gate the report must pass before ANY row is written. */
export function runAnchorChecks(
  data: AnchorInvestorData
): Array<{ name: string; passed: boolean; detail: string }> {
  const rows = data.investorList || [];
  const sumShares = rows.reduce((t, r) => t + (Number(r.shares) || 0), 0);
  const sumAmount = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  return [
    {
      name: 'investor_rows_present',
      passed: rows.length > 0,
      detail: `${rows.length} investor rows parsed`,
    },
    {
      name: 'count_matches_rows',
      passed: data.anchorInvestorsCount === rows.length,
      detail: `printed count ${data.anchorInvestorsCount} vs ${rows.length} rows`,
    },
    {
      name: 'shares_sum_to_total',
      passed: sumShares === data.totalSharesOffered,
      detail: `rows sum to ${sumShares} vs printed total ${data.totalSharesOffered}`,
    },
    {
      name: 'amounts_sum_to_total',
      passed: Math.abs(sumAmount - data.totalAmountRaised) <= AMOUNT_TOLERANCE_CRORE,
      detail: `rows sum to ${sumAmount.toFixed(4)} Cr vs printed total ${data.totalAmountRaised} Cr`,
    },
    {
      name: 'totals_positive',
      passed: data.totalSharesOffered > 0 && data.totalAmountRaised > 0,
      detail: `shares ${data.totalSharesOffered}, amount ${data.totalAmountRaised} Cr`,
    },
    {
      // bid_date and both lock-in dates are NOT NULL on anchor_investors, so a
      // missing date cannot be written at all — refuse before the insert throws.
      name: 'required_dates_present',
      passed:
        data.bidDate instanceof Date &&
        data.lockIn50PercentDate instanceof Date &&
        data.lockInRemainingDate instanceof Date,
      detail: `bid=${String(data.bidDate)}, lockIn50=${String(data.lockIn50PercentDate)}, lockInRest=${String(data.lockInRemainingDate)}`,
    },
    {
      name: 'lock_in_after_bid',
      passed:
        !(data.bidDate instanceof Date) ||
        !(data.lockIn50PercentDate instanceof Date) ||
        !(data.lockInRemainingDate instanceof Date) ||
        (data.lockIn50PercentDate > data.bidDate &&
          data.lockInRemainingDate > data.lockIn50PercentDate),
      detail: 'lock-in dates must fall after the bid date, 50% before the remainder',
    },
  ];
}

export async function persistAnchorReport(
  ipoId: string,
  options: AnchorPersistOptions,
  deps: AnchorPersisterDeps
): Promise<AnchorPersistSummary> {
  const apply = options.apply === true;
  const empty: AnchorPersistSummary = {
    written: 0,
    investorsWritten: 0,
    totals: null,
    checks: [],
    refusedReason: null,
    lowConfidenceNames: [],
    applied: apply,
  };

  const data = await deps.scrapeAnchorReport(ipoId, options.companyName);
  if (!data) {
    return { ...empty, refusedReason: 'no anchor allocation report parsed for this IPO' };
  }

  const checks = runAnchorChecks(data);
  const failed = checks.filter((c) => !c.passed);
  const lowConfidenceNames = (data.investorList || [])
    .map((r) => r.name)
    .filter((n) => isLowConfidenceName(n));

  if (failed.length > 0) {
    const reason = failed.map((c) => `${c.name}: ${c.detail}`).join('; ');
    logger.warn(
      { ipoId, companyName: options.companyName, failed: failed.map((c) => c.name) },
      '[AnchorPersister] arithmetic gate failed — writing NOTHING'
    );
    return { ...empty, checks, lowConfidenceNames, refusedReason: reason };
  }

  const totals = {
    shares: data.totalSharesOffered,
    amountCrore: data.totalAmountRaised,
    count: data.anchorInvestorsCount,
  };

  if (apply) {
    const write = deps.persist ?? createAnchorInvestors;
    await write(deps.anchorInvestorRepository, ipoId, {
      bidDate: data.bidDate,
      totalSharesOffered: data.totalSharesOffered,
      totalAmountRaised: data.totalAmountRaised,
      anchorInvestorsCount: data.anchorInvestorsCount,
      lockIn50PercentDate: data.lockIn50PercentDate,
      lockInRemainingDate: data.lockInRemainingDate,
      // Names are stored exactly as the OCR read them — never "cleaned up" into
      // a plausible-looking name the document does not contain.
      investorList: data.investorList,
    });
  }

  logger.info(
    { ipoId, apply, ...totals, lowConfidenceNames: lowConfidenceNames.length },
    '[AnchorPersister] anchor report persisted'
  );

  return {
    written: 1,
    investorsWritten: data.investorList.length,
    totals,
    checks,
    refusedReason: null,
    lowConfidenceNames,
    applied: apply,
  };
}
