/**
 * KPI Formatters Utility
 * Story 11.11: Format financial KPIs for display
 *
 * All formatters handle null/undefined values gracefully
 */

/**
 * Format market cap in ₹ crores
 * Examples:
 * - 5000 → "₹5,000 Cr"
 * - 1234.56 → "₹1,234.56 Cr"
 * - null → "N/A"
 *
 * @param value - Market cap in crores
 * @returns Formatted string with rupee symbol and "Cr" suffix
 */
export function formatMarketCap(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';

  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} Cr`;
}

/**
 * Format percentage values
 * Examples:
 * - 18.5 → "18.5%"
 * - 25 → "25.0%"
 * - null → "N/A"
 *
 * @param value - Percentage value
 * @param decimals - Number of decimal places (default 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals = 1
): string {
  if (value === null || value === undefined) return 'N/A';

  return `${value.toFixed(decimals)}%`;
}

/**
 * Format ratio values
 * Examples:
 * - 3.25 → "3.25x"
 * - 12.5 → "12.50x"
 * - null → "N/A"
 *
 * @param value - Ratio value
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted ratio string with "x" suffix
 */
export function formatRatio(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return 'N/A';

  return `${value.toFixed(decimals)}x`;
}

/**
 * Format currency values
 * Examples:
 * - 45.20 → "₹45.20"
 * - 100 → "₹100.00"
 * - null → "N/A"
 *
 * @param value - Currency value in rupees
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted currency string with rupee symbol
 */
export function formatCurrency(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined) return 'N/A';

  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format an IPO price band. Prices are whole rupees, so no forced decimals.
 * When only one bound exists OR min === max, render a SINGLE value ("₹174") —
 * never "₹174 - ₹174" (the collapsed-band bug). Both missing → "N/A".
 *
 * SSOT for price-band rendering — components MUST call this, never inline
 * `formatCurrency(min) - formatCurrency(max)` (web-display-formatting.md).
 */
export function formatPriceBand(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (!hasMin && !hasMax) return 'N/A';
  if (!hasMin) return formatCurrency(max, 0);
  if (!hasMax) return formatCurrency(min, 0);
  if (min === max) return formatCurrency(min, 0);
  return `${formatCurrency(min, 0)} - ${formatCurrency(max, 0)}`;
}

/**
 * Format change percentage with +/- sign
 * Examples:
 * - 12.5 → "+12.5%"
 * - -8.3 → "-8.3%"
 * - 0 → "0.0%"
 * - null → "N/A"
 *
 * @param value - Change percentage value
 * @param decimals - Number of decimal places (default 1)
 * @returns Formatted change string with sign
 */
export function formatChange(
  value: number | null | undefined,
  decimals = 1
): string {
  if (value === null || value === undefined) return 'N/A';

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format compact numbers (K, M, B, Cr)
 * Examples:
 * - 1500 → "1.5K"
 * - 1500000 → "15 Lakh"
 * - 15000000 → "1.5 Cr"
 * - null → "N/A"
 *
 * @param value - Numeric value
 * @returns Formatted compact string
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';

  const absValue = Math.abs(value);

  if (absValue >= 10000000) {
    // Crores
    return `${(value / 10000000).toFixed(2)} Cr`;
  } else if (absValue >= 100000) {
    // Lakhs
    return `${(value / 100000).toFixed(2)} Lakh`;
  } else if (absValue >= 1000) {
    // Thousands
    return `${(value / 1000).toFixed(1)}K`;
  }

  return value.toFixed(0);
}

/**
 * Format number with Indian number system (lakhs, crores)
 * Examples:
 * - 123456 → "1,23,456"
 * - 1234567 → "12,34,567"
 * - null → "N/A"
 *
 * @param value - Numeric value
 * @param decimals - Number of decimal places (default 0)
 * @returns Formatted number string
 */
export function formatIndianNumber(
  value: number | null | undefined,
  decimals = 0
): string {
  if (value === null || value === undefined) return 'N/A';

  return value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format EPS (Earnings Per Share)
 * Examples:
 * - 45.20 → "₹45.20"
 * - 100 → "₹100.00"
 * - null → "N/A"
 *
 * @param value - EPS value
 * @returns Formatted EPS string
 */
export function formatEPS(value: number | null | undefined): string {
  return formatCurrency(value, 2);
}

/**
 * Format P/E ratio
 * Examples:
 * - 25.5 → "25.50x"
 * - 12 → "12.00x"
 * - null → "N/A"
 *
 * @param value - P/E ratio value
 * @returns Formatted P/E string
 */
export function formatPE(value: number | null | undefined): string {
  return formatRatio(value, 2);
}

/**
 * Format ROE/RoNW percentage
 * Examples:
 * - 18.5 → "18.5%"
 * - 25 → "25.0%"
 * - null → "N/A"
 *
 * @param value - ROE/RoNW percentage value
 * @returns Formatted percentage string
 */
export function formatROE(value: number | null | undefined): string {
  return formatPercentage(value, 1);
}
