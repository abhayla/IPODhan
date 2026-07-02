/**
 * Offering Type Detection Utility
 *
 * Detects offering type and segment from stock symbol and exchange metadata.
 * Story 11.8: Restructure Category Field into Segment + Offering Type
 */

/**
 * Detect offering type from stock symbol suffix
 *
 * Analyzes symbol patterns to identify offering type:
 * - TDR suffix → TENDER offer
 * - BUYBACK keyword → BUYBACK
 * - DELISTING keyword → DELISTING
 * - Default → IPO
 *
 * @param symbol - Stock symbol (e.g., "3IINFOLTDR", "ACMELTD")
 * @returns Offering type enum value
 *
 * @example
 * detectOfferingTypeFromSymbol("3IINFOLTDR") // returns "TENDER"
 * detectOfferingTypeFromSymbol("ACMELTD") // returns "IPO"
 * detectOfferingTypeFromSymbol("COMPANY-BUYBACK") // returns "BUYBACK"
 */
export function detectOfferingTypeFromSymbol(symbol: string): string {
  if (!symbol) {
    return 'IPO';
  }

  const symbolUpper = symbol.toUpperCase().trim();

  // Corporate actions - high priority detection
  // TENDER offers (like "3i Infotech" TDR)
  if (symbolUpper.endsWith('TDR') || symbolUpper.includes('TENDER')) {
    return 'TENDER';
  }

  // BUYBACK offers
  if (symbolUpper.includes('BUYBACK')) {
    return 'BUYBACK';
  }

  // DELISTING offers
  if (symbolUpper.includes('DELISTING')) {
    return 'DELISTING';
  }

  // Default to IPO
  return 'IPO';
}

/**
 * Detect segment (MAINBOARD vs SME) from exchange list
 *
 * Analyzes exchange platform metadata to determine listing segment:
 * - NSE-SME or BSE-SME → SME
 * - NSE EMERGE platform → SME
 * - NSE or BSE (main) → MAINBOARD
 *
 * @param listingExchanges - Array of exchange codes (e.g., ["NSE", "BSE-MAIN"])
 * @returns Segment enum value ("MAINBOARD" or "SME")
 *
 * @example
 * detectSegmentFromExchange(["NSE", "BSE-MAIN"]) // returns "MAINBOARD"
 * detectSegmentFromExchange(["BSE-SME"]) // returns "SME"
 * detectSegmentFromExchange(["NSE-SME"]) // returns "SME"
 * detectSegmentFromExchange(["NSE EMERGE"]) // returns "SME"
 */
export function detectSegmentFromExchange(listingExchanges: string[]): string {
  if (!listingExchanges || listingExchanges.length === 0) {
    return 'MAINBOARD'; // Default to MAINBOARD
  }

  // Check each exchange for SME indicators
  const hasSME = listingExchanges.some((exchange) => {
    const exchangeUpper = exchange.toUpperCase().trim();
    return (
      exchangeUpper.includes('SME') ||
      exchangeUpper.includes('EMERGE') || // BSE SME platform name
      exchangeUpper === 'NSE-SME' ||
      exchangeUpper === 'BSE-SME'
    );
  });

  return hasSME ? 'SME' : 'MAINBOARD';
}

/**
 * Detect offering type from BSE IPO type field
 *
 * BSE provides an explicit IPO type field in their data.
 * This function maps BSE types to our offering type enum.
 *
 * @param bseIpoType - BSE IPO type string
 * @returns Offering type enum value
 *
 * @example
 * detectOfferingTypeFromBSEType("RIGHTS ISSUE") // returns "RIGHTS"
 * detectOfferingTypeFromBSEType("NCD") // returns "NCD"
 * detectOfferingTypeFromBSEType("IPO") // returns "IPO"
 */
export function detectOfferingTypeFromBSEType(bseIpoType: string): string {
  if (!bseIpoType) {
    return 'IPO';
  }

  const typeUpper = bseIpoType.toUpperCase().trim();

  // BSE SHORT CODES first (the public-issues table/API "Type of Issue" values).
  // These are what BSE actually serves — the long-word matches below never hit them,
  // which is how OTB/DPI/RI corporate actions were ingested as offering_type='IPO'
  // (the #23 pollution recurrence: Zydus/Garware buybacks, Muthoot NCDs, rights).
  if (/\bOTB\b/.test(typeUpper)) {
    // Offer To Buy: takeover open offer or buyback tender — conservatively TENDER
    // (the authoritative BUYBACK split needs IR_FLAG_FULL — see detectOfferingTypeFromBSEIRFlag)
    return 'TENDER';
  }
  if (/\bDPI\b/.test(typeUpper) || typeUpper.includes('DEBT ISSUE')) {
    return 'NCD'; // Debt Public Issue
  }
  if (/\bRI\b/.test(typeUpper)) {
    return 'RIGHTS';
  }

  // Map BSE types to our enum
  if (typeUpper.includes('RIGHTS')) {
    return 'RIGHTS';
  }

  if (typeUpper.includes('NCD') || typeUpper.includes('DEBENTURE')) {
    return 'NCD';
  }

  if (typeUpper.includes('BOND')) {
    return 'BONDS';
  }

  if (typeUpper.includes('FPO') || typeUpper.includes('FOLLOW')) {
    return 'FPO';
  }

  if (typeUpper.includes('OFS') || typeUpper.includes('OFFER FOR SALE')) {
    return 'OFS';
  }

  // ISS-011 Fix: Add missing offering types
  if (typeUpper.includes('INVIT') || typeUpper.includes('INV IT') || typeUpper.includes('INFRASTRUCTURE INVESTMENT TRUST')) {
    return 'INVITS';
  }

  if (typeUpper.includes('REIT') || typeUpper.includes('REAL ESTATE INVESTMENT TRUST')) {
    return 'REITS';
  }

  if (typeUpper.includes('IPP') || typeUpper.includes('INSTITUTIONAL PLACEMENT PROGRAMME')) {
    return 'IPP';
  }

  if (typeUpper.includes('QIP') || typeUpper.includes('QUALIFIED INSTITUTIONAL PLACEMENT')) {
    return 'QIP';
  }

  if (typeUpper.includes('PREFERENTIAL')) {
    return 'PREFERENTIAL';
  }

  // Default to IPO
  return 'IPO';
}

/**
 * Comprehensive offering type detection
 *
 * Combines multiple detection strategies for best accuracy:
 * 1. Check symbol for special suffixes (TDR, BUYBACK, etc.)
 * 2. Check BSE type field if available
 * 3. Check NSE issue type field if available
 * 4. Default to IPO
 *
 * @param params - Detection parameters
 * @param params.symbol - Stock symbol
 * @param params.bseType - Optional BSE IPO type field
 * @param params.issueType - Optional NSE issue type field
 * @returns Offering type enum value
 *
 * @example
 * detectOfferingType({ symbol: "3IINFOLTDR", bseType: undefined, issueType: undefined }) // returns "TENDER"
 * detectOfferingType({ symbol: "ACME", bseType: "RIGHTS ISSUE", issueType: undefined }) // returns "RIGHTS"
 * detectOfferingType({ symbol: "COMPANY", bseType: undefined, issueType: undefined }) // returns "IPO"
 */
export function detectOfferingType(params: {
  symbol: string;
  bseType?: string | null | undefined;
  issueType?: string | null | undefined;
}): string {
  const { symbol, bseType, issueType } = params;

  let result = 'IPO'; // Default

  // Priority 1: Symbol-based detection (catches TENDER, BUYBACK, DELISTING)
  const symbolType = detectOfferingTypeFromSymbol(symbol || '');
  if (symbolType !== 'IPO') {
    result = symbolType;
  }

  // Priority 2: BSE type field (if available)
  if (result === 'IPO' && bseType) {
    const bseTypeResult = detectOfferingTypeFromBSEType(bseType);
    if (bseTypeResult !== 'IPO') {
      result = bseTypeResult;
    }
  }

  // Priority 3: NSE issue type field (if available)
  if (result === 'IPO' && issueType) {
    const issueTypeResult = detectOfferingTypeFromBSEType(issueType); // Reuse BSE logic as it's generic
    if (issueTypeResult !== 'IPO') {
      result = issueTypeResult;
    }
  }

  // Validate result is in allowed enum
  if (!isValidOfferingType(result)) {
    console.warn(`[detectOfferingType] Invalid offering type "${result}", defaulting to IPO. Symbol: ${symbol}, BSE Type: ${bseType}, Issue Type: ${issueType}`);
    return 'IPO';
  }

  return result;
}

/**
 * Detect offering type from BSE's authoritative `IR_flag` (and `IR_FLAG_FULL`)
 * returned by the BSE public-issues JSON API (`IPO_HomePageDetail/w`).
 *
 * This is the AUTHORITATIVE classifier — BSE explicitly tags whether a current
 * "issue" is a genuine public issue (IPO) or a corporate action (takeover open
 * offer, buyback, rights, debt). Other sources (Moneycontrol/Chittorgarh/fallback)
 * blindly default to 'IPO', which is how takeovers/buybacks pollute IPO listings
 * (e.g. SARDA PROTEINS, WIPRO, RESTAURANT BRANDS — all OTB, not IPOs). Use this to
 * correct the classification so non-IPO corporate actions are excluded from IPO views.
 *
 * BSE IR_flag values observed: IPO (Book Building), OTB (Offer To Buy — Takeover or
 * Buyback), DPI (Debt Public Issue), RI (Rights Issue), CMN (unknown/other).
 *
 * @returns the mapped offering type, or `null` when the flag is unknown (caller
 *          MUST log and leave the row unchanged rather than guess).
 */
export function detectOfferingTypeFromBSEIRFlag(
  irFlag: string | null | undefined,
  irFlagFull?: string | null | undefined
): string | null {
  if (!irFlag) return null;

  const flag = irFlag.toUpperCase().trim();
  const full = (irFlagFull || '').toUpperCase();

  switch (flag) {
    case 'IPO':
      return 'IPO'; // genuine public issue (Book Building / Fixed Price)
    case 'OTB':
      // Offer To Buy: a takeover open offer or a buyback tender — NOT an IPO.
      return full.includes('BUYBACK') ? 'BUYBACK' : 'TENDER';
    case 'DPI':
      return 'NCD'; // Debt Public Issue
    case 'RI':
      return 'RIGHTS';
    case 'FPO':
      return 'FPO';
    case 'OFS':
      return 'OFS';
    default:
      return null; // unknown (e.g. CMN) — do not guess; caller logs + leaves as-is
  }
}

/**
 * Valid offering types that match the database enum
 *
 * This list should match the offering_type_enum in packages/shared/src/db/schema.ts
 */
const VALID_OFFERING_TYPES = [
  'IPO', 'FPO', 'RIGHTS', 'OFS', 'BUYBACK', 'DELISTING',
  'TENDER', 'NCD', 'BONDS', 'INVITS', 'REITS', 'IPP', 'QIP', 'PREFERENTIAL'
] as const;

/**
 * Validate that an offering type is valid according to the database schema
 *
 * @param offeringType - The offering type to validate
 * @returns true if valid, false otherwise
 */
export function isValidOfferingType(offeringType: string): boolean {
  return VALID_OFFERING_TYPES.includes(offeringType as any);
}

/**
 * Guard against a scraper downgrading a specific corporate-action classification to the
 * generic 'IPO'. Moneycontrol/Chittorgarh/fallback default offering_type='IPO' blindly, so
 * without this the cron re-pollutes IPO listings (re-marking takeovers/buybacks/rights/debt
 * as IPOs). A specific existing classification MUST win over an incoming generic 'IPO'.
 *
 * @returns the offering type to persist.
 */
export function resolveOfferingTypeKeepingClassification(
  existing: string | null | undefined,
  incoming: string
): string {
  if (existing && existing !== 'IPO' && incoming === 'IPO') {
    return existing;
  }
  return incoming;
}
