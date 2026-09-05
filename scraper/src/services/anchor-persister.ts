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
 * NAME CONFIDENCE (W-81): anchor_investors has no name-confidence column, and
 * `investor_list` is typed jsonb (IndividualInvestor[]) that the web layer
 * reads, so there is nowhere to mark ONE name as untrusted without inventing a
 * field. A garbled name is therefore stored AS-IS - but only while the filing
 * as a whole reads cleanly. When MORE THAN `NAME_QUALITY_FLOOR` of the rows
 * fail `isLowConfidenceName` (blank names included), the read itself is broken,
 * not one row, and the WHOLE write is refused: the DEEPA report published
 * "OSWAL OT] LAL FINVEST N4 LI I\4ITE D" and a blank name to the live page,
 * which is worse for a reader than an absent anchor table.
 */

import type { AnchorInvestorData } from '../scrapers/anchor-investors-scraper.js';
import { createAnchorInvestors } from './data-persister.js';
import { recordLiveStep } from './step-ledger-recorders.js';
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
  /**
   * Reads the `ipos` row so this door can honour `ipos.scraper_locked`, the
   * admin "hands off this row" flag. REQUIRED, not optional: the filing
   * persister refuses a locked IPO outright, but the anchor path wrote straight
   * past the flag, so `--doc-type ANCHOR_ALLOCATION_REPORT` was a hole in the
   * lock. Typing it as required means a caller cannot re-open that hole by
   * simply forgetting a dependency.
   */
  ipoRepository: {
    findById(id: string): Promise<{ companyName?: string; scraperLocked?: boolean } | null>;
  };
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

/**
 * WHY this exists (W-142). The auto-persist door must map an anchor refusal to
 * an HONEST `documents.extraction_status`: a name-quality/blank-name refusal is
 * MANUAL_REVIEW (a human must look at the scan), while an arithmetic or
 * protection refusal is a retryable FAILED. Both arrive as prose in
 * `refusedReason`, and matching on that prose would silently re-classify every
 * refusal the day someone rewords a message. The kind is therefore stated
 * structurally, at each refusal site, and `refusedReason` stays the human text.
 */
export type AnchorRefusalKind =
  | 'ipo_missing'
  | 'scraper_locked'
  | 'no_report'
  | 'arithmetic'
  | 'blank_names'
  | 'name_quality'
  | 'protected_field';

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
  /** W-142: which gate refused, stated structurally — never parsed out of `refusedReason`. */
  refusedKind: AnchorRefusalKind | null;
  /** Names the OCR could not read cleanly. No column exists for this. */
  lowConfidenceNames: string[];
  /**
   * Investor rows dropped from the write because their name was blank (or
   * whitespace-only) after trim — an OCR/text-layer read failure on that row.
   * The row's arithmetic already passed the sum gates (names are not an
   * arithmetic gate by design), so it is not a refusal by itself; it is
   * simply not publishable without a name and is excluded from the written
   * `investorList`, counted here for the run summary / admin conflicts page.
   */
  skippedBlankNames: number;
  applied: boolean;
}

/** Printed and summed crore totals agree when within this many crore. */
const AMOUNT_TOLERANCE_CRORE = 0.01;

/**
 * Short tokens (<=2 letters) legitimately appearing in real entity names —
 * country/currency/legal-form abbreviations. A short token in this list does
 * not count toward the "run of OCR-shrapnel tokens" signal below.
 */
const SHORT_TOKEN_ALLOWLIST = new Set([
  'OF', '&', 'AND', 'CO', 'LTD', 'PTE', 'PLC', 'LP', 'LLC', 'LLP', 'SA', 'AG', 'NV', 'BV', 'SE',
  'AB', 'AS', 'OY', 'KK', 'DE', 'LA', 'LE', 'DU', 'ON', 'IN', 'TO', 'BY', 'UK', 'US', 'UAE', 'ODI',
  'FPI', 'FII', 'MF', 'IT', 'II', 'III', 'IV', 'VI', 'PE', 'VC', 'HK', 'SG', 'CH',
]);

/** The minimum consecutive run of non-allow-listed 1-2 letter tokens that reads as
 * OCR shrapnel rather than a real short-form name (W-89b: a run of 4 single
 * letters was the old bar; word-fragment shrapnel is often 1-2 letters, not
 * always exactly 1, so the run is measured on token length <= 2). */
const SHRAPNEL_RUN_THRESHOLD = 4;

/**
 * A name is low-confidence when OCR left it with characters no registered
 * investor name contains, too short to be a real entity name, or shaped like
 * word-fragment shrapnel (W-89b): a run of short OCR-split tokens, a lone
 * "0"/"1" standing in for a misread "O"/"I" between two words, too few real
 * words to be an entity name, or a dangling "SERIES"/"ACCOUNT" fragment with
 * no identifier after it.
 */
export function isLowConfidenceName(name: string): boolean {
  const n = (name || '').trim();
  if (n.length < 4) return true;
  if (/[^A-Za-z0-9 .,&()'\/-]/.test(n)) return true;
  // A digit welded into an alphabetic word is the classic OCR substitution
  // ("G1oba1", "M0rgan", "Vant4ge"). Real entity names never do this, while
  // legitimate digits in a name stand alone ("Fund 2 Ltd").
  if (/[A-Za-z]\d|\d[A-Za-z]/.test(n)) return true;

  const tokens = n.split(/\s+/).filter(Boolean);

  // A run of short (<=2 letter) tokens is OCR letter/word shrapnel
  // ("M OTI LA FI NV E ST LI M ITE D", "GI RI K M"), not a real name — unless
  // most of the run is legitimate short-form abbreviations.
  let shortRun: string[] = [];
  for (const t of [...tokens, '']) {
    const isShort = /^[A-Za-z]{1,2}$/.test(t);
    if (isShort) {
      shortRun.push(t);
    } else {
      const nonAllowed = shortRun.filter((s) => !SHORT_TOKEN_ALLOWLIST.has(s.toUpperCase()));
      if (nonAllowed.length >= SHRAPNEL_RUN_THRESHOLD) return true;
      shortRun = [];
    }
  }

  // A lone "0" or "1" standing between two word tokens is a misread "O"/"I"
  // ("CTI 0 N" for "CONVICTION", "AS 0 KA" for "ASOKA") — real names never
  // isolate a single digit between two letter-only tokens.
  for (let i = 1; i < tokens.length - 1; i++) {
    if (
      (tokens[i] === '0' || tokens[i] === '1') &&
      /^[A-Za-z]+$/.test(tokens[i - 1]) &&
      /^[A-Za-z]+$/.test(tokens[i + 1])
    ) {
      return true;
    }
  }

  // Fewer than 2 real (3+ letter) words means the string is a fragment, not
  // an entity name ("SERIES 1", "ACCOU NT" — a word split by OCR into two
  // pieces, one too short to count).
  const realWords = tokens.filter((t) => /^[A-Za-z]{3,}$/.test(t.replace(/[^A-Za-z]/g, ''))).length;
  if (realWords < 2) return true;

  // A name that trails off in a bare "SERIES"/"ACCOUNT" with no identifier
  // after it is an incomplete OCR read of a series/account-linked investor.
  if (/\b(SERIES|ACCOUNT)\s*$/i.test(n)) return true;

  const letters = n.replace(/[^A-Za-z]/g, '').length;
  return letters / n.length < 0.6;
}

/**
 * The share of investor rows whose name may be unreadable before the whole
 * anchor write is refused (W-81). Above this the name column itself failed to
 * read; below it, a stray row is tolerated and only reported.
 */
export const NAME_QUALITY_FLOOR = 0.3;

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
    rowErrors?: number;
  };
  const rowErrors = d.rowErrors ?? 0;
  // Round 2 (Hole 1): a partially-read letter (rowErrors > 0) has UNDERSTATED
  // `investorList`/summed totals by construction - the row-arithmetic
  // cross-checks can both pass against that understated sum with no
  // relationship to whether the FULL letter's totals are what got persisted.
  // `corroborated` therefore requires rowErrors === 0: it is only ever asked
  // to stand in for a printed total the scan could not read, never for rows
  // the scan could not read.
  const corroborated =
    rowErrors === 0 && d.percentageCheckPassed === true && d.sharesTimesPriceCheckPassed === true;

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
    // Round 2 (Hole 1): unconditional - independent of whether any printed
    // total happens to be readable. A printed total that numerically agrees
    // with `sumShares`/`sumAmount` when rowErrors > 0 is NOT real
    // corroboration: those sums are understated by construction (rows the
    // scan could not reconcile are missing from them), so agreement with an
    // understated figure proves nothing and must not let the letter through.
    {
      name: 'no_row_errors',
      passed: rowErrors === 0,
      detail:
        rowErrors === 0
          ? 'every investor row reconciled cleanly'
          : `${rowErrors} rows unreadable, totals not corroborated`,
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
    refusedKind: null,
    lowConfidenceNames: [],
    skippedBlankNames: 0,
    applied: apply,
  };

  // `ipos.scraper_locked` — the admin "hands off this row" flag. persistFilingExtraction
  // refuses a locked IPO before its first write; this door did not check it at all, so
  // `--doc-type ANCHOR_ALLOCATION_REPORT` wrote through the lock. Checked HERE, in the
  // door, rather than in the CLI, so every caller of the persister is covered.
  const existing = await deps.ipoRepository.findById(ipoId);
  if (!existing) {
    return {
      ...empty,
      refusedReason: `persistAnchorReport: no IPO row for id ${ipoId}`,
      refusedKind: 'ipo_missing',
    };
  }
  if (existing.scraperLocked === true) {
    const reason =
      `IPO ${ipoId} (${existing.companyName ?? 'unknown'}) is scraper_locked — ` +
      'refusing the entire anchor write. Clear the lock in admin to allow it.';
    logger.warn({ ipoId }, '[AnchorPersister] IPO is scraper_locked — writing NOTHING');
    return { ...empty, refusedReason: reason, refusedKind: 'scraper_locked' };
  }

  const data = await deps.scrapeAnchorReport(ipoId, options.companyName);
  if (!data) {
    return {
      ...empty,
      refusedReason: 'no anchor allocation report parsed for this IPO',
      refusedKind: 'no_report',
    };
  }

  const checks = runAnchorChecks(data);
  const failed = checks.filter((c) => !c.passed);
  const notCheckable = checks.filter((c) => c.notCheckable).map((c) => c.name);
  if (failed.length > 0) {
    const reason = failed.map((c) => `${c.name}: ${c.detail}`).join('; ');
    const lowConfidenceNames = (data.investorList || [])
      .map((r) => r.name)
      .filter((n) => isLowConfidenceName(n));
    logger.warn(
      { ipoId, companyName: options.companyName, failed: failed.map((c) => c.name) },
      '[AnchorPersister] arithmetic gate failed — writing NOTHING'
    );
    return { ...empty, checks, notCheckable, lowConfidenceNames, refusedReason: reason, refusedKind: 'arithmetic' };
  }

  // Names are not an arithmetic gate by design (WHY GATES, top of file) — a
  // blank/whitespace-only name is an OCR read failure on that ONE row, not a
  // reason to refuse the whole filing. Drop it from what gets written and
  // count it; a garbled-but-present name is still real allocation data and is
  // written as-is (below), only flagged in `lowConfidenceNames`.
  const rows = data.investorList || [];
  const publishableRows = rows.filter((r) => r.name && r.name.trim().length > 0);
  const skippedBlankNames = rows.length - publishableRows.length;

  if (rows.length > 0 && publishableRows.length === 0) {
    const reason =
      `anchor write refused: all ${rows.length} investor rows have a blank name — ` +
      'nothing to publish';
    logger.warn(
      { ipoId, rows: rows.length },
      '[AnchorPersister] every investor row has a blank name — writing NOTHING'
    );
    return {
      ...empty,
      checks,
      notCheckable,
      skippedBlankNames,
      refusedReason: reason,
      refusedKind: 'blank_names',
    };
  }

  const lowConfidenceNames = publishableRows
    .map((r) => r.name)
    .filter((n) => isLowConfidenceName(n));

  // W-81 name-quality gate. A blank name counts as a failed name, not as a free
  // pass: both come from the same broken read of the scan.
  const unreadableNames = lowConfidenceNames.length + skippedBlankNames;
  if (rows.length > 0 && unreadableNames / rows.length > NAME_QUALITY_FLOOR) {
    const reason =
      `anchor write refused: ${unreadableNames} of ${rows.length} investor names are ` +
      `unreadable (> ${Math.round(NAME_QUALITY_FLOOR * 100)}% floor) - the name column ` +
      'was not read, publishing it would show garbled investors';
    logger.warn(
      { ipoId, rows: rows.length, unreadableNames, lowConfidenceNames },
      '[AnchorPersister] name-quality gate failed - writing NOTHING'
    );
    return {
      ...empty,
      checks,
      notCheckable,
      lowConfidenceNames,
      skippedBlankNames,
      refusedReason: reason,
      refusedKind: 'name_quality',
    };
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
      investorList: publishableRows,
    };
    const result = await deps.protectionFilter(ipoId, 'anchor_investors', payload, 'DRHP');
    const kept = result.filtered as Record<string, unknown>;
    const blocked = Object.keys(payload).filter((c) => !(c in kept));
    if (blocked.length > 0) {
      const reason =
        `anchor_investors write refused: ${blocked.join(', ')} ` +
        'protected by an admin edit, and this row is rewritten whole';
      logger.warn({ ipoId, blocked }, '[AnchorPersister] protected field — writing NOTHING');
      return {
        ...empty,
        checks,
        notCheckable,
        lowConfidenceNames,
        skippedBlankNames,
        refusedReason: reason,
        refusedKind: 'protected_field',
      };
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
      // a plausible-looking name the document does not contain. Blank names are
      // excluded above (they are not a name at all); garbled-but-present names
      // are written as-is and only flagged via `lowConfidenceNames`.
      investorList: publishableRows,
    });
  }

  logger.info(
    { ipoId, apply, ...totals, lowConfidenceNames: lowConfidenceNames.length, skippedBlankNames },
    '[AnchorPersister] anchor report persisted'
  );

  // S-02 hook — H3. Recorded only on the applied path: a dry run computed a plan
  // and wrote nothing, so claiming the step DONE would be a lie. Every refusal
  // above returns before this point, and each of those refusals is already
  // reported to the caller in `refusedReason`.
  if (apply) {
    await recordLiveStep(ipoId, 'H3', {
      source: 'ANCHOR_ALLOCATION_REPORT',
      evidence: {
        investorsWritten: publishableRows.length,
        totals,
        lowConfidenceNames: lowConfidenceNames.length,
        skippedBlankNames,
      },
    });
  }

  return {
    written: 1,
    investorsWritten: publishableRows.length,
    totals,
    checks,
    notCheckable,
    refusedReason: null,
    refusedKind: null,
    lowConfidenceNames,
    skippedBlankNames,
    applied: apply,
  };
}
