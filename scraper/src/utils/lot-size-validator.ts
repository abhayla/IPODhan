/**
 * Lot Size Validation Utility
 *
 * Purpose: Prevent invalid lot_size values (especially 1) from entering database
 * Issue: ISS-LotCalc-002 - 68.89% of IPOs have lot_size = 1 (unrealistic)
 *
 * Strategy:
 * - Reject lot_size = 1 (almost never correct in Indian IPOs)
 * - Validate typical ranges (warn but don't reject)
 * - Return NULL for missing/invalid data (database handles NULL correctly)
 * - Provide realistic defaults for frontend display ONLY (not for database)
 *
 * Created: 2025-10-21
 */

import logger from './logger.js';

/**
 * Typical lot size ranges for Indian IPOs (based on historical data)
 */
export const LOT_SIZE_RANGES = {
  MAINBOARD: {
    min: 10,    // Minimum reasonable lot size for MAINBOARD
    max: 1000,  // Maximum reasonable lot size for MAINBOARD
    typical: 75 // Most common lot size for MAINBOARD IPOs
  },
  SME: {
    min: 100,    // Minimum reasonable lot size for SME
    max: 10000,  // Maximum reasonable lot size for SME
    typical: 125 // Most common lot size for SME IPOs
  }
} as const;

/**
 * Validate and normalize lot_size based on segment
 * Returns null if lot_size is invalid or missing
 *
 * @param lotSize - Raw lot size from scraper (may be undefined, null, or number)
 * @param segment - IPO segment (MAINBOARD, SME, or null for RIGHTS/NCD)
 * @param companyName - Company name for logging purposes
 * @returns Validated lot_size or null
 */
export function validateLotSize(
  lotSize: number | undefined | null,
  segment: 'MAINBOARD' | 'SME' | null,
  companyName?: string
): number | null {
  // If lot_size is missing or clearly invalid (1 is almost never correct)
  if (!lotSize || lotSize === 1) {
    if (lotSize === 1) {
      logger.warn({
        companyName,
        segment,
        lotSize
      }, 'Rejected lot_size = 1 (unrealistic value) - setting to NULL');
    }
    return null; // Let database store NULL instead of incorrect value
  }

  // Validate lot_size is positive
  if (lotSize <= 0) {
    logger.warn({
      companyName,
      segment,
      lotSize
    }, 'Rejected negative or zero lot_size - setting to NULL');
    return null;
  }

  // Validate typical ranges (warn but don't reject)
  if (segment === 'MAINBOARD') {
    const { min, max } = LOT_SIZE_RANGES.MAINBOARD;
    if (lotSize < min || lotSize > max) {
      logger.warn({
        companyName,
        segment,
        lotSize,
        expectedRange: `${min}-${max}`
      }, `Unusual MAINBOARD lot_size (outside typical range)`);
    }
  } else if (segment === 'SME') {
    const { min, max } = LOT_SIZE_RANGES.SME;
    if (lotSize < min || lotSize > max) {
      logger.warn({
        companyName,
        segment,
        lotSize,
        expectedRange: `${min}-${max}`
      }, `Unusual SME lot_size (outside typical range)`);
    }
  }

  // Return validated lot_size
  return lotSize;
}

/**
 * Get realistic default lot_size for display purposes ONLY
 * Should NOT be saved to database - use NULL in database for missing values
 *
 * This function is intended for frontend use when displaying estimated lot sizes
 * to users when actual data is not available.
 *
 * @param segment - IPO segment (MAINBOARD, SME, or null)
 * @returns Realistic default lot size for display
 */
export function getDefaultLotSizeForDisplay(segment: 'MAINBOARD' | 'SME' | null): number {
  switch (segment) {
    case 'MAINBOARD':
      return LOT_SIZE_RANGES.MAINBOARD.typical; // 75
    case 'SME':
      return LOT_SIZE_RANGES.SME.typical; // 125
    default:
      // For RIGHTS/NCD/other offerings, use conservative MAINBOARD default
      return LOT_SIZE_RANGES.MAINBOARD.typical; // 75
  }
}

/**
 * Check if lot_size is within acceptable range (for validation purposes)
 *
 * @param lotSize - Lot size to check
 * @param segment - IPO segment
 * @returns true if lot_size is within acceptable range, false otherwise
 */
export function isLotSizeRealistic(
  lotSize: number | null | undefined,
  segment: 'MAINBOARD' | 'SME' | null
): boolean {
  if (!lotSize || lotSize === 1) {
    return false;
  }

  if (segment === 'MAINBOARD') {
    const { min, max } = LOT_SIZE_RANGES.MAINBOARD;
    return lotSize >= min && lotSize <= max;
  } else if (segment === 'SME') {
    const { min, max } = LOT_SIZE_RANGES.SME;
    return lotSize >= min && lotSize <= max;
  }

  // For other segments (RIGHTS/NCD), accept any positive value
  return lotSize > 0;
}

/**
 * Get lot_size validation statistics for monitoring
 *
 * @param ipos - Array of IPOs with lot_size and segment
 * @returns Validation statistics
 */
export function getLotSizeValidationStats(
  ipos: Array<{ lotSize?: number | null; segment: 'MAINBOARD' | 'SME' | null }>
): {
  total: number;
  withLotSize: number;
  withoutLotSize: number;
  invalidLotSize: number; // lot_size = 1
  unrealisticLotSize: number; // outside typical range
  percentageValid: number;
} {
  const total = ipos.length;
  const withLotSize = ipos.filter(ipo => ipo.lotSize && ipo.lotSize > 0).length;
  const withoutLotSize = ipos.filter(ipo => !ipo.lotSize).length;
  const invalidLotSize = ipos.filter(ipo => ipo.lotSize === 1).length;
  const unrealisticLotSize = ipos.filter(
    ipo => ipo.lotSize && ipo.lotSize > 0 && !isLotSizeRealistic(ipo.lotSize, ipo.segment)
  ).length;

  const percentageValid = total > 0 ? (withLotSize / total) * 100 : 0;

  return {
    total,
    withLotSize,
    withoutLotSize,
    invalidLotSize,
    unrealisticLotSize,
    percentageValid
  };
}
