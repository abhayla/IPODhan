/**
 * NSE subscription parsers (T-266).
 *
 * ROOT CAUSE THIS FILE EXISTS FOR
 * -------------------------------
 * `nse-api-client.transformSubscriptionData()` iterated a `bidDetails` array
 * on the `/api/ipo-current-issue` payload. The live payload has never carried
 * that field (see `tests/fixtures/nse/ipo-current-issue.live-2026-08-22.json`),
 * so the parser returned `null` on every IPO of every cycle - prod logged
 * `{"totalSubscriptions":0,...,"msg":"Scraped data received from NSE"}` every
 * 30 minutes. BSE was left as the only writer of subscription snapshots, and
 * BSE only sees its own side of the bid book, so the site published a partial
 * figure as if it were the whole market. Investors saw Augmont at 0.95x
 * (under-subscribed) while it was 2.74x covered.
 *
 * THE TWO NSE ENDPOINTS AND WHAT THEY MEAN
 * ----------------------------------------
 *   /api/ipo-current-issue                      -> NSE's OWN book       (EXCHANGE_ONLY)
 *   /api/ipo-active-category?symbol=&issueType= -> both books, per category (CONSOLIDATED)
 *
 * Verified arithmetically on the captured fixtures: NSE-only + BSE-only equals
 * the active-category total on both open IPOs (1.7902 + 0.95 = 2.7402;
 * 13.7039 + 7.95 = 21.6562). See `tests/fixtures/nse/README.md`.
 *
 * WHY srNo, NOT THE CATEGORY TEXT
 * -------------------------------
 * The category labels are ambiguous. `Individuals(Other than RIIs)` is an NII
 * sub-row but contains the word "Individuals"; `Others` appears three times
 * under three different parents. `srNo` ("1", "2.1", "3(a)", ...) is the only
 * unambiguous key NSE gives us, so every mapping here is keyed on it.
 */

import logger from '../utils/logger.js';
import type { ScrapedSubscription } from '../utils/validators.js';

/** How much of the market a subscription figure represents. */
export type SubscriptionCoverage = 'CONSOLIDATED' | 'EXCHANGE_ONLY';

/** One row of the NSE `/api/ipo-active-category` `dataList`. */
export interface NSEActiveCategoryRow {
  category?: string | null;
  noOfShareOffered?: string | null;
  noOfSharesBid?: string | null;
  noOfTotalMeant?: string | null;
  srNo?: string | null;
}

export interface NSEActiveCategoryPayload {
  dataList?: NSEActiveCategoryRow[] | null;
  updateTime?: string | null;
}

/**
 * Parse a numeric NSE string. NSE serialises large counts in Java scientific
 * notation ("2.1143029E7") and leaves blanks ("") on sub-rows that carry no
 * multiple. Returns null - never 0 - when there is no number, so callers can
 * tell "not reported" apart from "zero times subscribed".
 */
function parseNSENumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/,/g, '');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Non-negative multiples only; a negative subscription is nonsense data. */
function parseMultiple(raw: unknown): number | null {
  const value = parseNSENumber(raw);
  if (value === null || value < 0) return null;
  return value;
}

function parseShares(raw: unknown): number | undefined {
  const value = parseNSENumber(raw);
  if (value === null || value < 0) return undefined;
  return Math.round(value);
}

/** `srNo` normalised for comparison: "2.1(B)" -> "2.1(b)", null -> "". */
function normalizeSrNo(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().toLowerCase();
}

function emptySubscription(
  symbol: string,
  companyName: string,
  coverage: SubscriptionCoverage
): ScrapedSubscription {
  return {
    ipoCompanyName: companyName,
    ipoSymbol: symbol,
    qibSubscription: 0,
    niiSubscription: 0,
    retailSubscription: 0,
    totalSubscription: 0,
    coverage,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse `/api/ipo-active-category` into a CONSOLIDATED subscription snapshot.
 *
 * Returns null when the payload carries no usable category row, so a broken or
 * empty response can never be persisted as a genuine "0x subscribed" snapshot.
 */
export function transformActiveCategorySubscription(
  payload: NSEActiveCategoryPayload | null | undefined,
  symbol: string,
  companyName: string
): ScrapedSubscription | null {
  const rows = payload?.dataList;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const subscription = emptySubscription(symbol, companyName, 'CONSOLIDATED');
  let sawUsableRow = false;

  for (const row of rows) {
    const srNo = normalizeSrNo(row?.srNo);

    // Header row: NSE ships the column captions as the first data row.
    if (srNo === 'sr.no.') continue;

    const multiple = parseMultiple(row?.noOfTotalMeant);
    const sharesBid = parseShares(row?.noOfSharesBid);
    const sharesOffered = parseShares(row?.noOfShareOffered);

    switch (srNo) {
      case '1': // Qualified Institutional Buyers
        if (multiple === null) break;
        subscription.qibSubscription = multiple;
        sawUsableRow = true;
        break;

      case '2': // Non Institutional Investors (the whole NII bucket)
        if (multiple === null) break;
        subscription.niiSubscription = multiple;
        sawUsableRow = true;
        break;

      case '2.1': // NII, bid amount above Rs 10 lakh (bNII / "big HNI")
        if (multiple === null) break;
        subscription.bNIISubscription = multiple;
        sawUsableRow = true;
        break;

      case '2.2': // NII, bid amount Rs 2 lakh to Rs 10 lakh (sNII / "small HNI")
        if (multiple === null) break;
        subscription.sNIISubscription = multiple;
        sawUsableRow = true;
        break;

      case '3': // Retail Individual Investors
        if (multiple === null) break;
        subscription.retailSubscription = multiple;
        sawUsableRow = true;
        break;

      case '4': // Employees (reserved portion; absent when there is no quota)
        if (multiple === null) break;
        subscription.employeeSubscription = multiple;
        sawUsableRow = true;
        break;

      default:
        // The Total row is the only one NSE ships with a null srNo.
        if (srNo === '' && String(row?.category ?? '').trim().toLowerCase() === 'total') {
          if (multiple === null) break;
          subscription.totalSubscription = multiple;
          if (sharesBid !== undefined) subscription.totalSharesBid = sharesBid;
          if (sharesOffered !== undefined) subscription.sharesOffered = sharesOffered;
          sawUsableRow = true;
        }
        // Every other srNo ("1(a)".."4(b)") is a sub-breakdown NSE reports
        // without a multiple. They are informational and deliberately ignored -
        // mapping them by category text is what mis-assigned
        // "Individuals(Other than RIIs)" to Retail.
        break;
    }
  }

  if (!sawUsableRow) {
    logger.warn(
      { symbol, companyName, rowCount: rows.length },
      'NSE ipo-active-category returned no usable category row - not persisting a 0x snapshot'
    );
    return null;
  }

  if (subscription.totalSubscription === 0) {
    logger.warn(
      { symbol, companyName, qib: subscription.qibSubscription, nii: subscription.niiSubscription },
      'NSE ipo-active-category had category rows but no Total row - snapshot rejected'
    );
    return null;
  }

  logger.debug(
    {
      symbol,
      total: subscription.totalSubscription,
      qib: subscription.qibSubscription,
      nii: subscription.niiSubscription,
      retail: subscription.retailSubscription,
      updateTime: payload?.updateTime ?? null,
    },
    'NSE consolidated subscription parsed from ipo-active-category (T-266)'
  );

  return subscription;
}

/**
 * Parse one `/api/ipo-current-issue` row into an EXCHANGE_ONLY snapshot.
 *
 * This is the fallback when `ipo-active-category` is unavailable. It is NSE's
 * own book only, so it MUST NOT be published as the whole-market figure - the
 * `coverage` marker is what stops that downstream.
 */
export function transformCurrentIssueSubscription(
  row: Record<string, unknown> | null | undefined
): ScrapedSubscription | null {
  if (!row) return null;

  const companyName = String(row.companyName ?? row.company ?? '').trim();
  const symbol = String(row.symbol ?? '').trim();
  if (!companyName) return null;

  const total = parseMultiple(row.noOfTime);
  if (total === null) return null;

  const subscription = emptySubscription(symbol, companyName, 'EXCHANGE_ONLY');
  subscription.totalSubscription = total;

  const sharesBid = parseShares(row.noOfsharesBid ?? row.noOfSharesBid);
  const sharesOffered = parseShares(row.noOfSharesOffered ?? row.noOfShareOffered);
  if (sharesBid !== undefined) subscription.totalSharesBid = sharesBid;
  if (sharesOffered !== undefined) subscription.sharesOffered = sharesOffered;

  return subscription;
}
