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
  issueSize?: string | number | null;
  symbol?: string | null;  // Stock symbol (NSE/BSE)
  isin?: string | null;
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
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
