/**
 * Bid-tier (application-size) computation for a book-built IPO.
 *
 * The exchanges/aggregators show a "Lot Size" table breaking the bid into investor
 * categories by application VALUE, per SEBI thresholds:
 *   - Retail (RII): application amount up to ₹2,00,000 (min 1 lot)
 *   - sNII / S-HNI: > ₹2,00,000 and ≤ ₹10,00,000
 *   - bNII / B-HNI: > ₹10,00,000 (no upper cap)
 *
 * These tiers are fully DERIVED from lot size + the upper price band, so they are
 * computed here rather than stored. Convention: compute at the cap (upper band)
 * price, which is what the standard "min/max application" table uses.
 */

const RETAIL_CEILING = 200_000; // ₹2,00,000 — RII application ceiling
const SNII_CEILING = 1_000_000; // ₹10,00,000 — sNII application ceiling

export interface BidTier {
  /** Number of lots for this row. */
  lots: number;
  /** lots × lotSize. */
  shares: number;
  /** lots × lotSize × price (₹). */
  amount: number;
}

export interface BidTiers {
  amountPerLot: number;
  retail: { min: BidTier; max: BidTier };
  sNii: { min: BidTier; max: BidTier };
  bNii: { min: BidTier };
}

function tier(lots: number, lotSize: number, price: number): BidTier {
  return { lots, shares: lots * lotSize, amount: lots * lotSize * price };
}

/**
 * Compute the Retail / sNII / bNII application tiers.
 *
 * @param lotSize shares per lot (e.g. 46)
 * @param price   the price to value applications at — pass the upper band / cap (e.g. 321)
 * @returns the tier table, or null if inputs are non-positive (can't value a bid)
 */
export function computeBidTiers(
  lotSize: number,
  price: number
): BidTiers | null {
  if (!Number.isFinite(lotSize) || !Number.isFinite(price)) return null;
  if (lotSize <= 0 || price <= 0) return null;

  const amountPerLot = lotSize * price;

  // Largest lot count whose amount stays within each ceiling. Retail is always
  // at least 1 lot even if a single lot already exceeds the retail ceiling.
  const retailMaxLots = Math.max(1, Math.floor(RETAIL_CEILING / amountPerLot));
  const sNiiMinLots = retailMaxLots + 1;
  const sNiiMaxLots = Math.max(
    sNiiMinLots,
    Math.floor(SNII_CEILING / amountPerLot)
  );
  const bNiiMinLots = sNiiMaxLots + 1;

  return {
    amountPerLot,
    retail: {
      min: tier(1, lotSize, price),
      max: tier(retailMaxLots, lotSize, price),
    },
    sNii: {
      min: tier(sNiiMinLots, lotSize, price),
      max: tier(sNiiMaxLots, lotSize, price),
    },
    bNii: {
      min: tier(bNiiMinLots, lotSize, price),
    },
  };
}
