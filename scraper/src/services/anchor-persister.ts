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
  /**
   * The admin field-protection gate. `anchor_investors` is an admin-editable
   * table (web/lib/admin/table-map-generator.ts), so a hand-corrected total
   * must survive a re-run of this persister — it did not, because this path
   * called createAnchorInvestors directly with no gate at all.
   *
   * Whole-row semantics, like the other replace-style writes: createAnchorInvestors
   * rewrites every column of the single anchor row, so a protected field cannot
   * be preserved through a partial write. If ANY field is protected the write is
   * refused outright.
   */
  protectionFilter?: (
    ipoId: string,
    tableName: string,
    data: Record<string, unknown>,
    scraperName: string
  ) => Promise<{ filtered: Record<string, unknown> }>;
}

export interface AnchorPersistSummary {
  written: number;
  investorsWritten: number;
  totals: { shares: number; amountCrore: number; count: number } | null;
  /** Every gate, in order, with its verdict — the audit trail for a refusal. */
  checks: AnchorCheck[];
  /**
   * Gates whose printed counterpart the scan could not read.
   *
   * A name here does NOT imply the run succeeded, and this list can be
   * non-empty alongside a non-null `refusedReason`. Three ways that happens:
   * the parser's own cross-checks did not both pass (then every not-checkable
   * gate is itself a failure and the run is refused); a DIFFERENT gate failed
   * (a date, or a readable printed total that disagrees); or the write was
   * refused later by admin field protection. Read `refusedReason` for the
   * verdict and this list only for which reconciliations were unavailable.
   */
  notCheckable: string[];
  /** Populated only when a gate failed; the run wrote nothing. */
  refusedReason: string | null;
  /** Names the OCR could not read cleanly. No column exists for this. */
  lowConfidenceNames: string[];
  applied: boolean;
}

/** Printed and summed crore totals agree when within this many crore. */
const AMOUNT_TOLERANCE_CRORE = 0.01;

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

/**
 * A gate's verdict. `not_checkable` is a THIRD state, distinct from passed and
 * failed: the letter's own printed figure was unreadable, so there is nothing to
 * reconcile against. It is not a pass.
 */
export interface AnchorCheck {
  name: string;
  passed: boolean;
  notCheckable?: boolean;
  detail: string;
}

/**
 * Reconcile the SUMMED investor rows against the letter's OWN PRINTED totals.
 *
 * Round 3 compared `data.totalSharesOffered` with the sum of the rows — but the
 * parser derives that total BY summing the rows, so the gate was `x === x` and
 * could never fail. The printed figures now travel separately
 * (`printedTotalShares` / `printedTotalAmountRaised` / `printedCount`), read off
 * the letter's Total row and prose, so the comparison is real.
 *
 * WHEN A PRINTED FIGURE IS NULL the scan could not read it. The gate reports
 * `not_checkable` and the run is REFUSED — unless BOTH of the parser's own
 * independent cross-checks passed:
 *   - percentageCheckPassed: every row's printed percentage matched its share of
 *     the summed total, and those percentages summed to 100. The percentages are
 *     an independent statement of the same allocation, so a mis-read share count
 *     would not land on them.
 *   - sharesTimesPriceCheckPassed: the summed amounts matched summed shares x
 *     the bid price derived from the rows.
 * Together those two are an independent corroboration of the row set, which is
 * what the printed total would otherwise have provided. Neither alone suffices,
 * which is why the rule requires both.
 */
export function runAnchorChecks(data: AnchorInvestorData): AnchorCheck[] {
  const rows = data.investorList || [];
  const sumShares = rows.reduce((t, r) => t + (Number(r.shares) || 0), 0);
  const sumAmount = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  const d = data as AnchorInvestorData & {
    printedTotalShares?: number | null;
    printedTotalAmountRaised?: number | null;
    printedCount?: number | null;
    percentageCheckPassed?: boolean;
    sharesTimesPriceCheckPassed?: boolean;
  };
  const corroborated =
    d.percentageCheckPassed === true && d.sharesTimesPriceCheckPassed === true;

  const reconcile = (
    name: string,
    printed: number | null | undefined,
    summed: number,
    agrees: (p: number) => boolean,
    unit: string
  ): AnchorCheck => {
    if (printed === null || printed === undefined) {
      return {
        name,
        // Not checkable is only survivable when the parser's two independent
        // cross-checks both corroborated the rows.
        passed: corroborated,
        notCheckable: true,
        detail:
          `the letter's printed ${unit} could not be read; ` +
          (corroborated
            ? 'accepted because the percentage and shares-x-price cross-checks both passed'
            : 'REFUSED because the parser cross-checks did not both pass'),
      };
    }
    return {
      name,
      passed: agrees(printed),
      detail: `rows sum to ${summed} ${unit} vs the letter's printed ${printed} ${unit}`,
    };
  };

  return [
    {
      name: 'investor_rows_present',
      passed: rows.length > 0,
      detail: `${rows.length} investor rows parsed`,
    },
    reconcile(
      'count_matches_printed',
      d.printedCount,
      rows.length,
      (p) => p === rows.length,
      'investor count'
    ),
    reconcile(
      'shares_sum_to_printed_total',
      d.printedTotalShares,
      sumShares,
      (p) => p === sumShares,
      'shares'
    ),
    reconcile(
      'amounts_sum_to_printed_total',
      d.printedTotalAmountRaised,
      Number(sumAmount.toFixed(4)),
      (p) => Math.abs(sumAmount - p) <= AMOUNT_TOLERANCE_CRORE,
      'Cr'
    ),
    {
      // The parser derives these two from the rows, so this is a shape check
      // (the carried totals are the ones actually written), never a
      // reconciliation — the reconciliations above are the real gates.
      name: 'carried_totals_match_rows',
      passed:
        sumShares === data.totalSharesOffered &&
        Math.abs(sumAmount - data.totalAmountRaised) <= AMOUNT_TOLERANCE_CRORE &&
        data.anchorInvestorsCount === rows.length,
      detail:
        `carried ${data.totalSharesOffered} shares / ${data.totalAmountRaised} Cr / ` +
        `${data.anchorInvestorsCount} investors vs rows ${sumShares} / ${sumAmount.toFixed(4)} / ${rows.length}`,
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
    notCheckable: [],
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

  const notCheckable = checks.filter((c) => c.notCheckable).map((c) => c.name);
  if (failed.length > 0) {
    const reason = failed.map((c) => `${c.name}: ${c.detail}`).join('; ');
    logger.warn(
      { ipoId, companyName: options.companyName, failed: failed.map((c) => c.name) },
      '[AnchorPersister] arithmetic gate failed — writing NOTHING'
    );
    return { ...empty, checks, notCheckable, lowConfidenceNames, refusedReason: reason };
  }

  const totals = {
    shares: data.totalSharesOffered,
    amountCrore: data.totalAmountRaised,
    count: data.anchorInvestorsCount,
  };

  // Admin field protection. Whole-row semantics: createAnchorInvestors rewrites
  // every column of the single anchor row, so a protected field cannot survive a
  // partial write — if any is protected, nothing is written.
  if (deps.protectionFilter) {
    const payload: Record<string, unknown> = {
      bidDate: data.bidDate,
      totalSharesOffered: data.totalSharesOffered,
      totalAmountRaised: data.totalAmountRaised,
      anchorInvestorsCount: data.anchorInvestorsCount,
      lockIn50PercentDate: data.lockIn50PercentDate,
      lockInRemainingDate: data.lockInRemainingDate,
      investorList: data.investorList,
    };
    const result = await deps.protectionFilter(ipoId, 'anchor_investors', payload, 'DRHP');
    const kept = result.filtered as Record<string, unknown>;
    const blocked = Object.keys(payload).filter((c) => !(c in kept));
    if (blocked.length > 0) {
      const reason =
        `anchor_investors write refused: ${blocked.join(', ')} ` +
        'protected by an admin edit, and this row is rewritten whole';
      logger.warn({ ipoId, blocked }, '[AnchorPersister] protected field — writing NOTHING');
      return { ...empty, checks, notCheckable, lowConfidenceNames, refusedReason: reason };
    }
  }

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
    notCheckable,
    refusedReason: null,
    lowConfidenceNames,
    applied: apply,
  };
}
