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

  // Priority 1: Symbol-based detection (catches TENDER, BUYBACK, DELISTING)
  const symbolType = detectOfferingTypeFromSymbol(symbol || '');
  if (symbolType !== 'IPO') {
    return symbolType;
  }

  // Priority 2: BSE type field (if available)
  if (bseType) {
    const bseTypeResult = detectOfferingTypeFromBSEType(bseType);
    if (bseTypeResult !== 'IPO') {
      return bseTypeResult;
    }
  }

  // Priority 3: NSE issue type field (if available)
  if (issueType) {
    const issueTypeResult = detectOfferingTypeFromBSEType(issueType); // Reuse BSE logic as it's generic
    if (issueTypeResult !== 'IPO') {
      return issueTypeResult;
    }
  }

  // Default: IPO
  return 'IPO';
}
