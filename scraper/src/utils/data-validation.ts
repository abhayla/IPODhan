/**
 * Data Validation Utility for IPO Scrapers
 *
 * Implements comprehensive validation rules to ensure data quality.
 * Prevents the historical issues discovered in Phase 2:
 * - lot_size = 1 (invalid for all IPOs)
 * - RIGHTS issues mis-categorized as IPOs
 * - Already-listed companies added as IPOs
 *
 * Usage:
 * ```typescript
 * import { validateIPOData, ValidationResult } from './utils/data-validation';
 *
 * const result = validateIPOData(scrapedData, 'NSE');
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 *   // Handle errors...
 * }
 * ```
 *
 * @module scraper/utils/data-validation
 */

export interface ValidationRule {
  field: string;
  rule: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  /**
   * P2-2 (T-287): true when this error is a rejection the guard is SUPPOSED
   * to produce (e.g. the Non-IPO Shape Guard correctly refusing to write a
   * known InvIT/REIT/scrip-code row as offering_type='IPO') rather than a
   * genuine data-quality bug. Callers use this to keep expected rejections
   * out of run-level failure counts and error-level logs, while still
   * refusing to persist the row.
   */
  expected?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationRule[];
  warnings: ValidationRule[];
  info: ValidationRule[];
  autoFixes?: Record<string, any>;
}

export interface IPODataToValidate {
  companyName?: string;
  lotSize?: number | null;
  segment?: string | null;
  offeringType?: string | null;
  priceRangeMin?: number | null;
  priceRangeMax?: number | null;
  /** BOOK_BUILDING | FIXED_PRICE | HYBRID - a FIXED_PRICE issue may legitimately have min === max. */
  issueType?: string | null;
  issueSize?: string | number | null;
  symbol?: string | null;  // Stock symbol (NSE/BSE)
  isin?: string | null;
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
  listingDate?: Date | string | null;
  [key: string]: any;
}

/**
 * Validate IPO data from scrapers
 * Implements all validation rules to ensure data quality
 */
export function validateIPOData(
  data: IPODataToValidate,
  source: string
): ValidationResult {
  const errors: ValidationRule[] = [];
  const warnings: ValidationRule[] = [];
  const info: ValidationRule[] = [];
  const autoFixes: Record<string, any> = {};

  // Rule 1: Lot Size Validation (CRITICAL)
  if (data.lotSize !== null && data.lotSize !== undefined) {
    if (data.lotSize === 1) {
      errors.push({
        field: 'lotSize',
        rule: 'LOT_SIZE_INVALID',
        severity: 'ERROR',
        message: `lot_size = 1 is NEVER valid for IPOs (SEBI violation). Source: ${source}`,
      });
    } else if (data.lotSize < 10) {
      errors.push({
        field: 'lotSize',
        rule: 'LOT_SIZE_TOO_LOW',
        severity: 'ERROR',
        message: `lot_size = ${data.lotSize} is below minimum threshold (10). Likely scraper error.`,
      });
    } else if (data.segment === 'MAINBOARD' && data.lotSize < 50) {
      warnings.push({
        field: 'lotSize',
        rule: 'LOT_SIZE_UNUSUAL_MAINBOARD',
        severity: 'WARNING',
        message: `lot_size = ${data.lotSize} is unusually low for MAINBOARD (typical: 50-150). Verify data.`,
      });
    } else if (data.segment === 'SME' && data.lotSize < 1000) {
      warnings.push({
        field: 'lotSize',
        rule: 'LOT_SIZE_UNUSUAL_SME',
        severity: 'WARNING',
        message: `lot_size = ${data.lotSize} is unusually low for SME (typical: 1000-4000). Verify data.`,
      });
    }
  }

  // Rule 2: Offering Type Detection
  const offeringTypeResult = detectOfferingType(data, source);
  if (offeringTypeResult.detectedType) {
    if (offeringTypeResult.detectedType !== data.offeringType) {
      warnings.push({
        field: 'offeringType',
        rule: 'OFFERING_TYPE_MISMATCH',
        severity: 'WARNING',
        message: `Detected offering type: ${offeringTypeResult.detectedType}, but data says: ${data.offeringType || 'null'}. ${offeringTypeResult.reason}`,
      });

      // Auto-fix if confident
      if (offeringTypeResult.confidence === 'HIGH') {
        autoFixes.offeringType = offeringTypeResult.detectedType;
        info.push({
          field: 'offeringType',
          rule: 'OFFERING_TYPE_AUTO_FIX',
          severity: 'INFO',
          message: `Auto-fixing offeringType to: ${offeringTypeResult.detectedType}`,
        });
      }
    }
  }

  // Rule 3: Price Band Validation (SEBI Regulation)
  if (data.priceRangeMin && data.priceRangeMax) {
    // T-276: a band is a RANGE. min > max is never valid data; min === max is
    // only valid for a fixed-price issue. Neither was checked before, so a
    // single price silently masqueraded as a band on 223/271 prod rows and the
    // site rendered "Price Band Rs.300" for a Rs.285-Rs.300 book-built issue.
    if (data.priceRangeMin > data.priceRangeMax) {
      errors.push({
        field: 'priceBand',
        rule: 'PRICE_BAND_INVERTED',
        severity: 'ERROR',
        message: `Price band floor ${data.priceRangeMin} exceeds cap ${data.priceRangeMax}. A band cannot be inverted.`,
      });
    } else if (data.priceRangeMin === data.priceRangeMax && data.issueType !== 'FIXED_PRICE') {
      warnings.push({
        field: 'priceBand',
        rule: 'PRICE_BAND_DEGENERATE',
        severity: 'WARNING',
        message: `Price band has zero width (${data.priceRangeMin} = ${data.priceRangeMax}). Only a FIXED_PRICE issue has a single price; a book-built issue always has floor < cap. Likely a single-price scrape taken before the band was announced.`,
      });
    }

    const priceBandWidth = data.priceRangeMax - data.priceRangeMin;
    const priceBandPercentage = (priceBandWidth / data.priceRangeMin) * 100;

    if (data.segment === 'MAINBOARD' && priceBandPercentage > 20) {
      errors.push({
        field: 'priceBand',
        rule: 'PRICE_BAND_TOO_WIDE_MAINBOARD',
        severity: 'ERROR',
        message: `Price band ${priceBandPercentage.toFixed(1)}% exceeds SEBI limit (20% for MAINBOARD). SEBI ICDR Reg 32(1).`,
      });
    } else if (data.segment === 'SME' && priceBandPercentage > 40) {
      errors.push({
        field: 'priceBand',
        rule: 'PRICE_BAND_TOO_WIDE_SME',
        severity: 'ERROR',
        message: `Price band ${priceBandPercentage.toFixed(1)}% exceeds SEBI limit (40% for SME). SEBI ICDR Reg 106ZA.`,
      });
    }
  }

  // Rule 4: Minimum Investment Validation
  if (data.lotSize && data.priceRangeMax) {
    const minInvestment = data.lotSize * data.priceRangeMax;

    if (data.segment === 'MAINBOARD') {
      if (minInvestment < 10000) {
        warnings.push({
          field: 'minInvestment',
          rule: 'MIN_INVESTMENT_LOW_MAINBOARD',
          severity: 'WARNING',
          message: `Min investment ₹${minInvestment.toLocaleString('en-IN')} is below typical range (₹10,000-₹15,000).`,
        });
      } else if (minInvestment > 20000) {
        warnings.push({
          field: 'minInvestment',
          rule: 'MIN_INVESTMENT_HIGH_MAINBOARD',
          severity: 'WARNING',
          message: `Min investment ₹${minInvestment.toLocaleString('en-IN')} is above typical range (₹10,000-₹15,000).`,
        });
      }
    } else if (data.segment === 'SME') {
      if (minInvestment < 100000) {
        warnings.push({
          field: 'minInvestment',
          rule: 'MIN_INVESTMENT_LOW_SME',
          severity: 'WARNING',
          message: `Min investment ₹${minInvestment.toLocaleString('en-IN')} is below typical range (₹1,00,000-₹2,00,000).`,
        });
      }
    }
  }

  // Rule 5: Required Fields
  if (!data.companyName || data.companyName.trim() === '') {
    errors.push({
      field: 'companyName',
      rule: 'REQUIRED_FIELD_MISSING',
      severity: 'ERROR',
      message: 'companyName is required and cannot be empty.',
    });
  }

  // Rule 6: Date Validation
  if (data.openDate && data.closeDate) {
    const openDate = new Date(data.openDate);
    const closeDate = new Date(data.closeDate);

    if (closeDate <= openDate) {
      errors.push({
        field: 'dates',
        rule: 'CLOSE_DATE_BEFORE_OPEN',
        severity: 'ERROR',
        message: `Close date (${closeDate.toISOString().split('T')[0]}) must be after open date (${openDate.toISOString().split('T')[0]}).`,
      });
    }

    const duration = (closeDate.getTime() - openDate.getTime()) / (1000 * 60 * 60 * 24);
    if (duration > 30) {
      warnings.push({
        field: 'dates',
        rule: 'IPO_DURATION_LONG',
        severity: 'WARNING',
        message: `IPO duration ${duration} days is unusually long (typical: 3-5 days).`,
      });
    }
  }

  // Rule 6b (W-160): close < listing, plus the close->listing gap by segment
  // (12 days MAINBOARD, 6 days SME — the same figures the T-328 HOLD escape
  // in data-consolidation-service.ts uses). WARNING severity, not ERROR —
  // this never drops a field on its own; it exists so the merged-record pass
  // (W-14, data-persister.ts) can surface an impossible listing/close
  // combination that per-source validation alone would miss (each source
  // rarely reports listingDate and closeDate together in one payload).
  if (data.closeDate && data.listingDate) {
    const closeDate = new Date(data.closeDate);
    const listingDate = new Date(data.listingDate);

    if (Number.isFinite(closeDate.getTime()) && Number.isFinite(listingDate.getTime())) {
      const gapDays = (listingDate.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24);
      const maxGapDays = data.segment === 'SME' ? 6 : 12;

      if (gapDays <= 0) {
        warnings.push({
          field: 'dates',
          rule: 'LISTING_DATE_BEFORE_CLOSE',
          severity: 'WARNING',
          message: `Listing date (${listingDate.toISOString().split('T')[0]}) is not after close date (${closeDate.toISOString().split('T')[0]}).`,
        });
      } else if (gapDays > maxGapDays) {
        warnings.push({
          field: 'dates',
          rule: 'LISTING_DATE_GAP_TOO_WIDE',
          severity: 'WARNING',
          message: `Listing date is ${gapDays} days after close date (typical: up to ${maxGapDays} for ${data.segment ?? 'MAINBOARD'}).`,
        });
      }
    }
  }

  // Rule 7: Company Name Validation
  if (data.companyName) {
    // Check for test data patterns
    const testPatterns = ['test', 'sample', 'dummy', 'placeholder', 'example'];
    const lowerName = data.companyName.toLowerCase();
    if (testPatterns.some(pattern => lowerName.includes(pattern))) {
      warnings.push({
        field: 'companyName',
        rule: 'POSSIBLE_TEST_DATA',
        severity: 'WARNING',
        message: `Company name "${data.companyName}" contains test data keywords. Verify this is real data.`,
      });
    }
  }

  // Rule 8: Non-IPO Shape Guard (issues #140/#141) — an offering about to be
  // persisted as offering_type='IPO' whose SHAPE cannot be a genuine book-built
  // IPO/FPO must be rejected outright rather than silently polluting the IPO
  // listings. Two independent, falsifiable signals (either one is sufficient):
  //   (a) subscription window > 10 days with no lot size AND no issue size —
  //       real mainboard/SME IPOs run ~3-5 days (rarely to ~10 with an
  //       extension); a multi-week/month "window" with nothing else populated
  //       is a corporate-action echo (rights/tender/NCD/an already-listed
  //       company), not a fresh public issue. Real: ADVENZYMES (98 days),
  //       LIGHT OF LIFE TRUST (11 days, a charity ZCZP bond) — both null
  //       lot_size, zero issue_size.
  //   (b) companyName is a bare exchange scrip code (a single ALL-CAPS
  //       alphanumeric token, no spaces, no legal-entity suffix) — a ticker,
  //       not a company name. Real: SIS, ADVENZYMES.
  // This only fires for the type the row would ACTUALLY be written as (the
  // effective type after Rule 2's auto-fix, so a row already reclassified to
  // NCD/RIGHTS/TENDER/etc. is correctly exempt).
  {
    const effectiveOfferingType = (autoFixes.offeringType as string | undefined) ?? data.offeringType ?? 'IPO';
    if (effectiveOfferingType === 'IPO') {
      const noLotSize = !data.lotSize || data.lotSize <= 0;
      const issueSizeNum = data.issueSize != null ? Number(data.issueSize) : NaN;
      const noIssueSize = !Number.isFinite(issueSizeNum) || issueSizeNum <= 0;

      let longWindowNoSubstance = false;
      if (data.openDate && data.closeDate && noLotSize && noIssueSize) {
        const openDate = new Date(data.openDate);
        const closeDate = new Date(data.closeDate);
        const duration = (closeDate.getTime() - openDate.getTime()) / (1000 * 60 * 60 * 24);
        longWindowNoSubstance = duration > 10;
      }

      if (longWindowNoSubstance) {
        errors.push({
          field: 'offeringType',
          rule: 'NON_IPO_WINDOW_TOO_LONG',
          severity: 'ERROR',
          message: `offeringType='IPO' with a >10-day subscription window and no lot size / issue size is not a genuine equity IPO (#140/#141: ADVENZYMES/LIGHT OF LIFE TRUST shape). Reclassify to the correct offering type or drop the row.`,
          expected: true,
        });
      }

      // NON_IPO_CORPORATE_ACTION_SHAPE (T-329, round-7 P1-4 GUARD FIX —
      // evidence/2026-08-26-T-322/FINDING-P1-3-lot-band-and-shape.md).
      // longWindowNoSubstance above only fires when BOTH lot size AND issue
      // size are absent — but 7 live rows (KWALITY WALLS, MORGANITE
      // CRUCIBLE, MUTHOOT FINCOTP, BANGANGA PAPER, NIRBHAY COLOURS,
      // SANMITRA COMMERCIAL, STANBIK AGRO) HAVE both a lot size (100) and an
      // issue size populated, so that guard never reaches them. Every one of
      // these is a corporate action (scheme of arrangement / demerger /
      // already-listed-company echo), not a genuine book-built IPO, and
      // shares a distinct three-part shape none of which requires a missing
      // lot/issue size:
      //   - fixed price (price_range_min === price_range_max — no
      //     book-building; the FIXED_PRICE-issueType exemption used
      //     elsewhere in this file does not apply here because these rows
      //     have issueType=null in prod, so this checks the raw band values)
      //   - lot_size === 100 (the corporate-action-echo lot, distinct from a
      //     genuine SME fixed-price IPO's typically larger/varied lot sizes)
      //   - a 10-14 day "bidding window" (longer than a genuine mainboard
      //     book-built IPO's ~3-5 days, but short enough that the >10-day
      //     longWindowNoSubstance guard above — which needs a MUCH longer
      //     window in practice for the ADVENZYMES/LIGHT OF LIFE TRUST shape,
      //     98/11 days — does not reliably span it)
      // All three conditions together are the discriminator; each alone is
      // too common in genuine data to reject on (fixed price alone is a
      // legitimate FIXED_PRICE SME issue; lot=100 alone is common; a 10-14
      // day window alone can be a genuine extended mainboard offer — see the
      // "does NOT reject a >10-day window when lot/issue size ARE populated"
      // guard elsewhere in this file, which this new check deliberately
      // narrows past by requiring the fixed-price + lot-100 co-occurrence).
      if (
        data.priceRangeMin != null &&
        data.priceRangeMax != null &&
        data.priceRangeMin === data.priceRangeMax &&
        data.lotSize === 100 &&
        data.openDate &&
        data.closeDate
      ) {
        const openDate = new Date(data.openDate);
        const closeDate = new Date(data.closeDate);
        const duration = (closeDate.getTime() - openDate.getTime()) / (1000 * 60 * 60 * 24);
        if (duration >= 10 && duration <= 14) {
          errors.push({
            field: 'offeringType',
            rule: 'NON_IPO_CORPORATE_ACTION_SHAPE',
            severity: 'ERROR',
            message: `offeringType='IPO' with a fixed price (₹${data.priceRangeMax}), lot size 100, and a ${duration}-day window matches the corporate-action-echo shape (scheme of arrangement / demerger / already-listed company), not a genuine book-built IPO (#P1-4: KWALITY WALLS/MORGANITE CRUCIBLE/MUTHOOT FINCOTP/BANGANGA PAPER/NIRBHAY COLOURS/SANMITRA COMMERCIAL/STANBIK AGRO shape). Reclassify to the correct offering type or drop the row.`,
            expected: true,
          });
        }
      }

      const name = (data.companyName || '').trim();
      const isBareScripCode = /^[A-Z0-9]{2,15}$/.test(name);
      if (isBareScripCode) {
        errors.push({
          field: 'companyName',
          rule: 'NON_IPO_SCRIP_CODE_NAME',
          severity: 'ERROR',
          message: `companyName "${name}" is a bare exchange scrip code (all-caps token, no legal suffix, no space), not a company name — offering_type='IPO' rejected (#140: SIS/ADVENZYMES shape).`,
          expected: true,
        });
      }

      // NON_IPO_TRUST_SHAPE (P2-2, round-2 review; redesigned T-277F checker
      // finding #2). Rule 2 already reclassifies a name containing "InvIT" or
      // "REIT" (HIGH confidence) before this block runs, so effectiveOfferingType
      // is no longer 'IPO' for those — no double report needed. But a genuine
      // InvIT/REIT does not always carry that keyword in its company name:
      // "Cube Highways Trust" and "Raajmarg Infra Investment Trust" both wrote
      // offering_type='IPO' from a bare "...Trust" name with no "InvIT"/"REIT"
      // substring, so Rule 2's narrower check missed them (Cube Highways
      // rendered 0.00/+0.00% on the Mainboard tracker).
      //
      // A bare /\btrust\b/i match on the WHOLE name is a false-positive trap:
      // "Trust Fintech Limited" is a real NSE Emerge SME IPO (Mar-2024) whose
      // name merely CONTAINS the word "Trust" — it is not a trust-structured
      // vehicle. The distinguishing STRUCTURAL signal is where the token
      // lands: an InvIT/REIT business trust is legally named "<something>
      // Trust" — "Trust" (or "Investment Trust") is the terminal legal-entity-
      // type token, exactly the way "Ltd"/"Limited" terminates an ordinary
      // company name. An ordinary company that merely uses "Trust" as a brand
      // word is followed by its OWN legal suffix ("... Trust Fintech
      // Limited"). So: reject only when the name (after stripping a trailing
      // IPO/FPO instrument label) ENDS in the bare token "trust" — that is
      // structural (the entity-type suffix), not just word presence. A "Trust"
      // appearing mid-name is at most a WARN, never a hard reject.
      const nameSansInstrumentLabel = name.replace(/\s+(IPO|FPO)$/i, '').trim();
      const endsWithTrustSuffix = /\btrust$/i.test(nameSansInstrumentLabel);
      // Checker round-2 finding #3 (T-277F2): "Investment Trust" is itself a
      // structural legal-entity-type token (same as a bare terminal "Trust"),
      // and it does not always land at the very end of the name — a real prod
      // row is "Property Share Investment Trust-Propshare Celestia", where the
      // instrument's own sub-name follows the "Investment Trust" token via a
      // hyphen. So match "Investment Trust" ANYWHERE (word-boundary), not only
      // as a terminal suffix — this stays structural (no plain "Trust" brand
      // word is also preceded by "Investment"), so "Trust Fintech Limited"
      // still does not match and stays a PASS.
      const containsInvestmentTrust = /\binvestment\s+trust\b/i.test(nameSansInstrumentLabel);
      const containsTrustToken = /\btrust\b/i.test(name);

      if (endsWithTrustSuffix || containsInvestmentTrust) {
        errors.push({
          field: 'offeringType',
          rule: 'NON_IPO_TRUST_SHAPE',
          severity: 'ERROR',
          message: `companyName "${name}" ${endsWithTrustSuffix ? 'ends in the bare "Trust" legal-entity-type token' : 'contains the "Investment Trust" legal-entity-type token'} (InvIT/REIT business-trust structure) but was not reclassified by Rule 2's invit/reit substring check — offering_type='IPO' rejected (P2-2: Cube Highways Trust shape; T-277F2: Property Share Investment Trust shape). Reclassify to INVITS/REITS or drop the row.`,
          expected: true,
        });
      } else if (containsTrustToken) {
        warnings.push({
          field: 'offeringType',
          rule: 'NON_IPO_TRUST_SHAPE_WARN',
          severity: 'WARNING',
          message: `companyName "${name}" contains the word "Trust" but does not end in it as a legal-entity-type token — treated as an ordinary company name (e.g. "Trust Fintech Limited"), not rejected. Verify manually if this is actually a trust-structured vehicle.`,
        });
      }
    }
  }

  // Rule 9: Lot-Economics Invariant (T-329, round-7 P1-4 —
  // evidence/2026-08-26-T-322/FINDING-P1-3-lot-band-and-shape.md). Rule 4
  // above (MIN_INVESTMENT_*) only WARNS — it never blocks persistence, so 10
  // rows with an arithmetically impossible "minimum investment" (lot_size x
  // upper price band) render on the live site today, e.g. ICICI Prudential
  // AMC "Minimum investment: Rs2,16,500 per lot (100 x Rs2,165)".
  //
  // SEBI ICDR Regulation 32(1) caps a MAINBOARD retail individual application
  // at one lot within the Rs10,000-Rs15,000 band (the lot size is fixed so
  // that lot_size x cap-price lands in that range); this guard uses a
  // slightly wider Rs10,000-Rs16,000 window to tolerate the last paisa of
  // rounding at the cap price without false-rejecting a genuine issue. SME
  // issues use a materially larger per-lot minimum — SEBI ICDR Chapter IX
  // (Regulation 253 and allied SME-specific provisions) requires post-issue
  // paid-up capital thresholds and retail lot sizing that put a genuine SME
  // minimum investment at Rs1,00,000-Rs2,00,000 per lot (the same range Rule
  // 4's MIN_INVESTMENT_LOW_SME/MIN_INVESTMENT_HIGH_SME above already uses).
  //
  // Unlike Rule 4, this is a hard REJECT (never published) — only for
  // BOOK_BUILDING (or unclassified) issues; a FIXED_PRICE issue's minimum
  // investment is not bounded the same way SEBI's retail-lot band assumes
  // book-building, so it is exempt here (Rule 4's warnings still apply).
  if (data.lotSize && data.priceRangeMax && data.issueType !== 'FIXED_PRICE') {
    const minInvestment = data.lotSize * data.priceRangeMax;

    if (data.segment === 'MAINBOARD' && (minInvestment < 10000 || minInvestment > 16000)) {
      errors.push({
        field: 'lotEconomics',
        rule: 'LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD',
        severity: 'ERROR',
        message: `MAINBOARD minimum investment ₹${minInvestment.toLocaleString('en-IN')} (lot ${data.lotSize} x band-cap ₹${data.priceRangeMax}) falls outside the SEBI ICDR Reg 32(1) retail range (~₹10,000-₹16,000). This lot/band pair is arithmetically impossible for a genuine book-built mainboard IPO — reject and flag for reclassification (#P1-4: ICICI Prudential AMC/STALLION/MORGANITE shape).`,
        expected: true,
      });
    } else if (data.segment === 'SME' && (minInvestment < 100000 || minInvestment > 200000)) {
      errors.push({
        field: 'lotEconomics',
        rule: 'LOT_ECONOMICS_IMPOSSIBLE_SME',
        severity: 'ERROR',
        message: `SME minimum investment ₹${minInvestment.toLocaleString('en-IN')} (lot ${data.lotSize} x band-cap ₹${data.priceRangeMax}) falls outside the SEBI ICDR Chapter IX retail range (~₹1,00,000-₹2,00,000). This lot/band pair is arithmetically implausible for a genuine SME IPO — reject and flag for reclassification.`,
        expected: true,
      });
    }
  }

  // Determine overall validity
  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    info,
    autoFixes: Object.keys(autoFixes).length > 0 ? autoFixes : undefined,
  };
}

/**
 * P2-2 (T-287): true when a validation result is INVALID solely because of
 * errors the guard is designed to produce (`ValidationRule.expected === true`
 * — e.g. Rule 8's Non-IPO Shape Guard correctly refusing an InvIT/REIT row).
 * Distinguishes "the guard did its job" from a genuine data-quality bug so
 * callers can keep expected rejections out of run-level failure counts and
 * error-level logs while still refusing to persist the row.
 */
export function isExpectedRejection(result: ValidationResult): boolean {
  return !result.valid && result.errors.length > 0 && result.errors.every((e) => e.expected === true);
}

/**
 * Structural, name-only detection of a business-trust (InvIT/REIT) company.
 * T-287F2: extracted so a scraper with ONLY a company-name signal (no
 * symbol/bseType — Chittorgarh) can decide "this is a business trust, not an
 * equity mainboard/SME issue" BEFORE it ever writes segment/offeringType,
 * rather than relying on a downstream validation pass to catch it after the
 * wrong value already landed. Mirrors the structural regex used by the
 * NON_IPO_TRUST_SHAPE guard below: a keyword substring ("invit"/"reit") OR
 * the terminal legal-entity-type token "Trust"/"Investment Trust" — not a
 * bare mid-name "Trust" (see NON_IPO_TRUST_SHAPE comment for the false-
 * positive trap this avoids, e.g. "Trust Fintech Limited").
 */
export function isBusinessTrustCompanyName(companyName: string | null | undefined): boolean {
  const name = (companyName || '').trim();
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower.includes('invit') || lower.includes('infrastructure investment trust')) return true;
  if (lower.includes('reit') || lower.includes('real estate investment trust')) return true;
  const nameSansInstrumentLabel = name.replace(/\s+(IPO|FPO)$/i, '').trim();
  if (/\btrust$/i.test(nameSansInstrumentLabel)) return true;
  if (/\binvestment\s+trust\b/i.test(nameSansInstrumentLabel)) return true;
  return false;
}

/**
 * Map a business-trust company name to its offering_type enum value.
 * Returns null when the name is not a business-trust shape at all.
 * When the shape is structural (bare "...Trust"/"Investment Trust") but no
 * REIT/InvIT keyword is present, defaults to 'INVITS' — InvITs are the more
 * common bare-"Trust"-named vehicle in this dataset (Cube Highways Trust,
 * Raajmarg Infra Investment Trust) and a wrong INVITS/REITS split is far
 * cheaper to correct later than a MAINBOARD segment silently re-applied to a
 * trust every scrape cycle.
 */
export function offeringTypeFromBusinessTrustName(
  companyName: string | null | undefined
): 'INVITS' | 'REITS' | null {
  const name = (companyName || '').trim();
  const lower = name.toLowerCase();
  if (lower.includes('reit') || lower.includes('real estate investment trust')) return 'REITS';
  if (lower.includes('invit') || lower.includes('infrastructure investment trust')) return 'INVITS';
  if (isBusinessTrustCompanyName(name)) return 'INVITS';
  return null;
}

/**
 * Detect offering type from scraped data
 * Auto-detects RIGHTS issues, InvITs, REITs, etc.
 */
export function detectOfferingType(
  data: IPODataToValidate,
  source: string
): {
  detectedType: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
} {
  const companyName = (data.companyName || '').toLowerCase();
  const title = companyName;

  // HIGH confidence patterns
  if (title.includes('rights issue') || title.includes('rights offer')) {
    return {
      detectedType: 'RIGHTS',
      confidence: 'HIGH',
      reason: 'Company name contains "rights issue" or "rights offer".',
    };
  }

  if (title.includes('invit') || title.includes('infrastructure investment trust')) {
    return {
      // T-228: MUST be the canonical offering_type enum value ('INVITS'), not the
      // display label 'InvIT'. The auto-fixer writes detectedType straight into the
      // record, and a display label fails the offeringType enum check -- which is why
      // four real trusts were rejected outright every cycle.
      detectedType: 'INVITS',
      confidence: 'HIGH',
      reason: 'Company name contains "InvIT" or "infrastructure investment trust".',
    };
  }

  if (title.includes('reit') || title.includes('real estate investment trust')) {
    return {
      // T-228: canonical enum value ('REITS'), not the display label 'REIT'.
      detectedType: 'REITS',
      confidence: 'HIGH',
      reason: 'Company name contains "REIT" or "real estate investment trust".',
    };
  }

  // MEDIUM confidence patterns
  if (data.offeringType && data.offeringType !== 'IPO') {
    return {
      detectedType: data.offeringType,
      confidence: 'MEDIUM',
      reason: `offeringType field is set to: ${data.offeringType}`,
    };
  }

  // Default to IPO
  return {
    detectedType: 'IPO',
    confidence: 'LOW',
    reason: 'No specific offering type detected, assuming IPO.',
  };
}

/**
 * Check if company is already listed (duplicate detection)
 * Returns true if company appears to be already listed
 */
export function isPossiblyAlreadyListed(
  data: IPODataToValidate
): {
  possiblyListed: boolean;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
} {
  // Check for existing stock symbol
  if (data.symbol && data.symbol.length > 0) {
    // Stock symbols for IPOs are typically assigned AFTER listing
    // If a company already has a symbol, it's likely already listed
    return {
      possiblyListed: true,
      reason: `Has stock symbol: ${data.symbol}. Symbols are assigned after listing.`,
      confidence: 'HIGH',
    };
  }

  // Check company name patterns for well-known listed companies
  const companyName = (data.companyName || '').toLowerCase();
  const knownListedPatterns = [
    'tata',
    'reliance',
    'infosys',
    'wipro',
    'hdfc',
    'icici',
    'axis',
    'kotak',
    'bajaj',
    'mahindra',
    'adani',
    'birla',
  ];

  for (const pattern of knownListedPatterns) {
    if (companyName.includes(pattern)) {
      return {
        possiblyListed: true,
        reason: `Company name contains "${pattern}" - likely a well-known listed company.`,
        confidence: 'MEDIUM',
      };
    }
  }

  return {
    possiblyListed: false,
    reason: 'No indicators of already-listed company found.',
    confidence: 'LOW',
  };
}

/**
 * Batch validate multiple IPO records
 * Returns summary statistics
 */
export function batchValidateIPOs(
  records: IPODataToValidate[],
  source: string
): {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  recordsWithWarnings: number;
  validationResults: ValidationResult[];
  summary: {
    criticalErrors: number;
    warnings: number;
    autoFixes: number;
  };
} {
  const validationResults = records.map(record => validateIPOData(record, source));

  const validRecords = validationResults.filter(r => r.valid).length;
  const invalidRecords = validationResults.filter(r => !r.valid).length;
  const recordsWithWarnings = validationResults.filter(r => r.warnings.length > 0).length;

  const criticalErrors = validationResults.reduce(
    (sum, r) => sum + r.errors.length,
    0
  );
  const warnings = validationResults.reduce(
    (sum, r) => sum + r.warnings.length,
    0
  );
  const autoFixes = validationResults.filter(r => r.autoFixes).length;

  return {
    totalRecords: records.length,
    validRecords,
    invalidRecords,
    recordsWithWarnings,
    validationResults,
    summary: {
      criticalErrors,
      warnings,
      autoFixes,
    },
  };
}

/**
 * Format validation result for logging
 */
export function formatValidationResult(
  result: ValidationResult,
  companyName?: string
): string {
  const lines: string[] = [];

  if (companyName) {
    lines.push(`\n📋 Validation Result for: ${companyName}`);
  } else {
    lines.push(`\n📋 Validation Result:`);
  }

  lines.push('─'.repeat(80));

  // Errors
  if (result.errors.length > 0) {
    lines.push(`\n❌ ERRORS (${result.errors.length}):`);
    for (const error of result.errors) {
      lines.push(`   • ${error.field}: ${error.message}`);
    }
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push(`\n⚠️  WARNINGS (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      lines.push(`   • ${warning.field}: ${warning.message}`);
    }
  }

  // Info
  if (result.info.length > 0) {
    lines.push(`\nℹ️  INFO (${result.info.length}):`);
    for (const info of result.info) {
      lines.push(`   • ${info.field}: ${info.message}`);
    }
  }

  // Auto-fixes
  if (result.autoFixes) {
    lines.push(`\n🔧 AUTO-FIXES:`);
    for (const [field, value] of Object.entries(result.autoFixes)) {
      lines.push(`   • ${field}: ${value}`);
    }
  }

  // Overall status
  if (result.valid) {
    lines.push(`\n✅ Status: VALID`);
  } else {
    lines.push(`\n❌ Status: INVALID (${result.errors.length} error(s))`);
  }

  lines.push('─'.repeat(80));

  return lines.join('\n');
}
