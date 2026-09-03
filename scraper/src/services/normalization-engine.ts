/**
 * Normalization Engine
 * Converts various data formats into standardized forms for accurate comparison
 * Handles Indian currency formats, dates, company names, percentages, etc.
 */

import type { NormalizationType, FieldRules } from '../config/field-priority-matrix';

/**
 * Main normalization function
 * Routes to specific normalizers based on type
 */
export function normalize(
  fieldName: string,
  value: any,
  rules: FieldRules
): any {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const type = rules.normalization || 'none';

  switch (type) {
    case 'currency':
      return normalizeCurrency(value, fieldName);
    case 'date':
      return normalizeDate(value);
    case 'company_name':
      return normalizeCompanyName(value);
    case 'percentage':
      return normalizePercentage(value);
    case 'number':
      return normalizeNumber(value);
    case 'none':
    default:
      return value;
  }
}

// ==================== CURRENCY NORMALIZATION ====================

/**
 * T-309 (T-305 round-6 P3): the crore-scale heuristic below used to test
 * `fieldName.includes('issue_size')` (snake_case only). The actual field name
 * the consolidation service passes through is the camelCase `issueSize`
 * (see field-priority-matrix.ts / data-consolidation-service.ts), which never
 * matched — so a bare-number crore value from a source that omits the "Cr"
 * suffix (e.g. NSE reporting `45.5`) was returned unconverted while another
 * source's raw-rupee value (e.g. BSE's `455000000`) went through correctly,
 * producing a permanent order-of-magnitude mismatch that re-detects as a
 * conflict every cycle and can never converge. Matches both spellings.
 */
function isCroreScaleField(fieldName: string): boolean {
  return /issue.?size|revenue|profit/i.test(fieldName);
}

/**
 * Normalize Indian currency formats to rupees (number)
 *
 * Handles:
 * - ₹500 Cr, ₹500 Crores, ₹500 crore
 * - Rs 500 Cr, Rs. 500 Crores
 * - INR 500 Cr, INR 500 crore
 * - 500 Crores, 500 Cr
 * - 5000000000 (raw number)
 * - 50 Lakh, 50 lakhs
 * - 500 Million, 5 Billion
 *
 * Returns: number in rupees (e.g., 5000000000 for ₹500 Cr)
 */
export function normalizeCurrency(value: string | number, fieldName?: string): number {
  // Handle null/undefined/empty
  if (value === null || value === undefined || value === '') {
    return NaN;
  }

  if (typeof value === 'number') {
    // If already a number, check context
    if (fieldName && (isCroreScaleField(fieldName))) {
      // For large amounts, if number is small (< 10000), likely in crores
      if (value < 10000) {
        return value * 1e7; // Convert crores to rupees
      }
    }
    return value;
  }

  const str = value.toString().trim();

  // Handle empty string
  if (!str) {
    return NaN;
  }

  // Currency patterns (order matters - most specific first)
  const patterns = [
    // Crores (most common)
    { regex: /[₹|Rs\.?|INR]?\s*([\d,.]+)\s*cr(?:ore)?s?/i, multiplier: 1e7 },
    { regex: /[₹|Rs\.?|INR]?\s*([\d,.]+)\s*crore/i, multiplier: 1e7 },

    // Lakhs
    { regex: /[₹|Rs\.?|INR]?\s*([\d,.]+)\s*lakh?s?/i, multiplier: 1e5 },

    // International formats - more specific patterns
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*b(?:illion|n)\b/i, multiplier: 1e9 },
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*m(?:illion|n)\b/i, multiplier: 1e6 },
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*thousand/i, multiplier: 1e3 },

    // With K/M/B suffixes (single letter)
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*B\b/i, multiplier: 1e9 },
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*M\b/i, multiplier: 1e6 },
    { regex: /[₹|Rs\.?|INR|USD|\$]?\s*([\d,.]+)\s*K\b/i, multiplier: 1e3 },
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern.regex);
    if (match) {
      const numStr = match[1].replace(/,/g, ''); // Remove commas
      const num = parseFloat(numStr);
      if (isNaN(num)) {
        return NaN;
      }
      return num * pattern.multiplier;
    }
  }

  // Plain number with currency symbol or negative numbers
  const plainMatch = str.match(/[₹|Rs\.?|INR|USD|\$]?\s*(-?[\d,.]+)/);
  if (plainMatch) {
    const numStr = plainMatch[1].replace(/,/g, '');
    const num = parseFloat(numStr);

    if (isNaN(num)) {
      return NaN;
    }

    // Context-aware interpretation
    if (fieldName && (isCroreScaleField(fieldName))) {
      // For financial fields, small numbers are likely in crores
      if (num < 10000 && num > 0) {
        return num * 1e7;
      }
    }

    return num;
  }

  // Fallback: try to parse as number
  const cleaned = str.replace(/[^\d.-]/g, '');
  const result = parseFloat(cleaned);
  return isNaN(result) ? NaN : result;
}

// ==================== DATE NORMALIZATION ====================

/**
 * Normalize various date formats to ISO 8601 string (YYYY-MM-DD)
 *
 * Handles:
 * - DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
 * - DD-MMM-YYYY (e.g., 15-Jan-2025)
 * - DD MMM YYYY (e.g., 15 January 2025)
 * - YYYY-MM-DD (ISO format)
 * - MM/DD/YYYY (US format - detects based on day > 12)
 * - Timestamps (milliseconds, seconds)
 *
 * Returns: string in YYYY-MM-DD format, or null if invalid
 */
export function normalizeDate(value: string | number | Date): string | null {
  if (!value) return null;

  // Already a Date object
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  // Unix timestamp (milliseconds or seconds)
  if (typeof value === 'number') {
    const timestamp = value < 1e10 ? value * 1000 : value; // Convert seconds to ms if needed
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return null;
  }

  const str = value.toString().trim();

  // ISO format (YYYY-MM-DD) - already normalized
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return str;
    }
  }

  // Month name mapping
  const monthNames: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  // DD-MMM-YYYY or DD MMM YYYY (e.g., 15-Jan-2025, 15 January 2025)
  const monthNameMatch = str.match(/(\d{1,2})[\/\-\s\.]+([a-z]+)[\/\-\s\.]+(\d{4})/i);
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1]);
    const monthStr = monthNameMatch[2].toLowerCase();
    const year = parseInt(monthNameMatch[3]);
    const month = monthNames[monthStr];

    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      // Use Date.UTC to avoid timezone issues
      const date = new Date(Date.UTC(year, month, day));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (Indian format - most common)
  const ddmmyyyyMatch = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (ddmmyyyyMatch) {
    const part1 = parseInt(ddmmyyyyMatch[1]);
    const part2 = parseInt(ddmmyyyyMatch[2]);
    const year = parseInt(ddmmyyyyMatch[3]);

    // If part1 > 12, it must be day (DD/MM/YYYY)
    // If part2 > 12, it must be day (MM/DD/YYYY)
    // Otherwise, assume Indian format (DD/MM/YYYY)
    let day: number, month: number;

    if (part1 > 12) {
      day = part1;
      month = part2; // Use 1-indexed month for Date.UTC
    } else if (part2 > 12) {
      day = part2;
      month = part1; // Use 1-indexed month for Date.UTC
    } else {
      // Assume DD/MM/YYYY (Indian format)
      day = part1;
      month = part2; // Use 1-indexed month for Date.UTC
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
      // Use Date.UTC to avoid timezone issues
      const date = new Date(Date.UTC(year, month - 1, day));

      // Validate that the date components match (catch invalid dates like Feb 29 on non-leap years)
      if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) {
        return null; // Invalid date (e.g., Feb 29 on non-leap year)
      }

      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  // Try Date constructor as last resort
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  return null; // Invalid date
}

// ==================== COMPANY NAME NORMALIZATION ====================

/**
 * Normalize company name variations
 *
 * Handles:
 * - Legal suffixes: Limited, Ltd, Ltd., Private, Pvt, Pvt., Inc, Corp, LLC, LLP, PLC
 * - IPO suffix: "IPO" at the end
 * - Extra spaces
 * - Case variations
 * - Special characters (&, ', -, _, parentheses)
 *
 * Returns: normalized lowercase name without legal suffixes.
 *
 * COMPARISON ONLY — W-83. The return value is a matching key, never a value to
 * persist: it is lowercased, suffix-stripped and punctuation-stripped, so
 * storing it turns `Deepa Jewellers Limited` into `deepa jewellers` on the row.
 * Consolidation MUST return the RAW winning value as `finalValue`
 * (data-consolidation-service.ts, Case 2), because
 * data-consolidation-orchestrator.ts copies every `finalValue` onto the written
 * row.
 */
export function normalizeCompanyName(value: string): string {
  if (!value) return '';

  let normalized = value
    .toLowerCase()
    .trim()
    // Remove special characters and replace with spaces (except apostrophes - remove those)
    .replace(/[&()]/g, '') // Remove &, parentheses
    .replace(/'/g, '') // Remove apostrophes (don't replace with space)
    .replace(/[\-_]/g, ' ') // Replace hyphen, underscore with space
    // Remove ALL dots
    .replace(/\./g, ''); // Remove all dots completely

  // Apply legal entity removals in a loop until no more matches
  let previousLength = 0;
  while (normalized.length !== previousLength) {
    previousLength = normalized.length;

    // Remove legal entity suffixes (order matters - longest first, most specific first)
    normalized = normalized
      .replace(/\s+private\s+limited\s*$/gi, '')
      .replace(/\s+pvt\s+ltd\s*$/gi, '')
      .replace(/\s+limited\s*$/gi, '')
      .replace(/\s+ltd\s*$/gi, '')
      .replace(/\s+private\s*$/gi, '')
      .replace(/\s+pvt\s*$/gi, '')
      .replace(/\s+incorporated\s*$/gi, '')
      .replace(/\s+inc\s*$/gi, '')
      .replace(/\s+corporation\s*$/gi, '')
      .replace(/\s+corp\s*$/gi, '')
      .replace(/\s+llc\s*$/gi, '')
      .replace(/\s+llp\s*$/gi, '')
      .replace(/\s+plc\s*$/gi, '');
  }

  // Remove IPO suffix
  normalized = normalized.replace(/\s+ipo\s*$/i, '');

  // Remove extra spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// ==================== PERCENTAGE NORMALIZATION ====================

/**
 * Normalize percentage formats to decimal (0-100 scale)
 *
 * Handles:
 * - 85% → 85
 * - 85 → 85
 * - 0.85 → 85 (if < 1, assumes fraction)
 * - "85 percent" → 85
 *
 * Returns: number on 0-100 scale
 */
export function normalizePercentage(value: string | number): number {
  if (typeof value === 'number') {
    // If < 1, assume it's a fraction (0.85 = 85%)
    if (value < 1 && value > 0) {
      return value * 100;
    }
    return value;
  }

  const str = value.toString().trim();

  // Remove % sign and "percent" word
  const cleaned = str.replace(/%|percent/gi, '').trim();
  const num = parseFloat(cleaned);

  if (isNaN(num)) return 0;

  // If < 1, assume it's a fraction
  if (num < 1 && num > 0) {
    return num * 100;
  }

  return num;
}

// ==================== NUMBER NORMALIZATION ====================

/**
 * Normalize number formats
 *
 * Handles:
 * - 1,234,567 → 1234567
 * - 1.234.567 (European) → 1234567
 * - "1.5" → 1.5
 * - Numbers with text: "Shares: 1000" → 1000
 *
 * Returns: number
 */
export function normalizeNumber(value: string | number): number {
  if (typeof value === 'number') {
    return value;
  }

  const str = value.toString().trim();

  // Remove all commas and non-numeric characters except decimal point and minus
  const cleaned = str.replace(/[^\d.-]/g, '');

  return parseFloat(cleaned) || 0;
}

// ==================== EQUIVALENCE CHECKING ====================

/**
 * Check if two normalized values are equivalent
 * Uses tolerance for floating point comparison
 */
export function areEquivalent(val1: any, val2: any, tolerance: number = 0.01): boolean {
  // Exact equality
  if (val1 === val2) return true;

  // Both null/undefined
  if ((val1 === null || val1 === undefined) && (val2 === null || val2 === undefined)) {
    return true;
  }

  // One null, other not
  if ((val1 === null || val1 === undefined) !== (val2 === null || val2 === undefined)) {
    return false;
  }

  // Number comparison with tolerance
  if (typeof val1 === 'number' && typeof val2 === 'number') {
    return Math.abs(val1 - val2) <= tolerance;
  }

  // W-18(ii): array-valued fields (leadManagers, listingExchanges) reached the
  // `return false` below on every cycle because `===` is reference equality —
  // two IDENTICAL lists from two sources were logged as a `data_conflicts` row
  // forever. Compared as order-insensitive multisets of trimmed, lower-cased
  // members.
  if (Array.isArray(val1) && Array.isArray(val2)) {
    if (val1.length !== val2.length) return false;
    const key = (v: any) => (typeof v === 'string' ? v.toLowerCase().trim() : JSON.stringify(v));
    const sorted1 = val1.map(key).sort();
    const sorted2 = val2.map(key).sort();
    return sorted1.every((v, i) => v === sorted2[i]);
  }

  // String comparison (case-insensitive, trimmed)
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    return val1.toLowerCase().trim() === val2.toLowerCase().trim();
  }

  // Date comparison (as ISO strings)
  if (val1 instanceof Date && val2 instanceof Date) {
    return val1.toISOString().split('T')[0] === val2.toISOString().split('T')[0];
  }

  return false;
}

/**
 * Calculate difference percentage between two values
 * Useful for detecting significant conflicts
 * Always uses the first value (val1) as the base for percentage calculation
 */
export function calculatePercentageDifference(val1: number, val2: number): number {
  if (val1 === 0 && val2 === 0) return 0;
  if (val1 === 0) return 100;
  if (val2 === 0) return 100;

  // Use val1 as the reference/base value
  // This measures how much val2 differs from val1 as a percentage
  const base = Math.abs(val1);
  return Math.abs((val2 - val1) / base) * 100;
}

// Keep old name for backward compatibility
export const calculateDifference = calculatePercentageDifference;

/**
 * Determine conflict severity based on difference
 * Used for setting severity field in data_conflicts table
 */
export function getConflictSeverity(
  fieldName: string,
  val1: any,
  val2: any,
  rules: FieldRules
): 'INFO' | 'WARNING' | 'CRITICAL' {
  // Critical fields always get CRITICAL severity for any difference
  // Note: price_band fields use percentage-based severity calculation below
  const criticalFields = ['issue_price', 'open_date', 'close_date', 'listing_date', 'lot_size'];
  if (criticalFields.includes(fieldName)) {
    return 'CRITICAL';
  }

  // Handle null/undefined vs value comparison
  if ((val1 === null || val1 === undefined) && (val2 !== null && val2 !== undefined)) {
    return 'WARNING';
  }
  if ((val2 === null || val2 === undefined) && (val1 !== null && val1 !== undefined)) {
    return 'WARNING';
  }

  // For numbers, check difference percentage
  if (typeof val1 === 'number' && typeof val2 === 'number') {
    const diff = calculatePercentageDifference(val1, val2);

    if (diff > 20) return 'CRITICAL'; // >20% difference
    if (diff > 5) return 'WARNING';   // >5% difference
    return 'INFO';                     // <5% difference
  }

  // For dates, any difference is WARNING
  if (rules.normalization === 'date') {
    return 'WARNING';
  }

  // For strings, any difference is WARNING
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    if (val1.toLowerCase().trim() !== val2.toLowerCase().trim()) {
      return 'WARNING';
    }
  }

  // Default
  return 'INFO';
}

// ==================== VALIDATION ====================

/**
 * Validate normalized value against field rules
 * Returns true if valid, false otherwise
 */
export function validateValue(value: any, rules: FieldRules): boolean {
  if (!rules.validation) return true;

  const val = rules.validation;

  // Allow null check
  if (value === null || value === undefined) {
    return val.allowNull ?? false;
  }

  // Number validation
  if (typeof value === 'number') {
    if (val.min !== undefined && value < val.min) return false;
    if (val.max !== undefined && value > val.max) return false;
  }

  // Regex validation
  if (val.regex && typeof value === 'string') {
    const regex = new RegExp(val.regex);
    return regex.test(value);
  }

  return true;
}

/**
 * Export all normalization functions for testing
 */
export const NormalizationEngine = {
  normalize,
  normalizeCurrency,
  normalizeDate,
  normalizeCompanyName,
  normalizePercentage,
  normalizeNumber,
  areEquivalent,
  calculateDifference,
  calculatePercentageDifference,
  getConflictSeverity,
  validateValue,
};
