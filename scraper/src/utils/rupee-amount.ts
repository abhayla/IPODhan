/**
 * #818 / F-181: a published amount in crore / lakh / million converted to rupees WITHOUT binary
 * floating-point error. `42.84 * 10_000_000` is 428400000.00000006 in IEEE-754 and
 * `24.58 * 10_000_000` is 245799999.99999997; both reached `ipos.issue_size` (NUMERIC(18,2)) and
 * the admin conflicts list verbatim from Chittorgarh (vinod-texworld-ltd, panchatv-bharat-ltd,
 * staging 2026-09-23..25). The product is rounded to the column's scale (paise, 2 decimals), which
 * is exact for every amount below 2^53 / 100 rupees (about 9e13, far above any issue size).
 */
export const RUPEES_PER_CRORE = 10_000_000;
export const RUPEES_PER_LAKH = 100_000;

export function scaleToRupees(amount: number, rupeesPerUnit: number): number {
  return Math.round(amount * rupeesPerUnit * 100) / 100;
}
