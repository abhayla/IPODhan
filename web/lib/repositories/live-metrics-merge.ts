/**
 * Live-metrics merge for IPO list rows.
 *
 * The `ipos` table carries current-value columns (`gmp_price`, `subscription_*`)
 * that the public list API serves verbatim — but nothing in the live pipeline
 * writes them: the scrapers persist the `gmp_records` / `subscriptions`
 * time-series instead. Every other list surface (home tables, landing pages,
 * `findListings`, `findBySlug`) already bridges that gap with a join; this module
 * is that bridge for `IPORepository.findAll()`.
 *
 * Contract:
 * - a stored (historical-import) value always wins — we only fill NULLs
 * - a genuinely unavailable figure stays `null`; nothing is ever fabricated
 * - attribution (`gmpSource`, `gmpUpdatedAt`, `subscriptionUpdatedAt`) is set
 *   only when the value was actually derived from a time-series row
 */

/** Newest `gmp_records` + `subscriptions` snapshot for one IPO. */
export interface LiveMetricsSnapshot {
  gmp: number | null;
  gmpPercentage: number | null;
  gmpTimestamp: Date | string | null;
  gmpSource: string | null;
  subscriptionTotal: number | string | null;
  subscriptionRetail: number | string | null;
  subscriptionQib: number | string | null;
  subscriptionHni: number | string | null;
  subscriptionTimestamp: Date | string | null;
}

/** The three attribution fields this merge adds to a list row. */
export interface LiveMetricsAttribution {
  gmpSource: string | null;
  gmpUpdatedAt: string | null;
  subscriptionUpdatedAt: string | null;
}

type Nullable = string | number | null | undefined;

/**
 * `??`, not `||` — a real GMP of 0 (flat grey market) is a value, not a miss.
 * Mirrors the same fix already made in `findListings` (C2/G16).
 */
const firstPresent = (stored: Nullable, derived: Nullable): string | number | null =>
  stored ?? derived ?? null;

const toIso = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Merge one IPO row with its live snapshot.
 *
 * @param row  the raw `ipos` row (its own columns win when non-null)
 * @param live newest time-series snapshot, or `undefined` when the IPO has none
 */
export function mergeLiveMetrics<T extends Record<string, unknown>>(
  row: T,
  live: LiveMetricsSnapshot | undefined
): T & LiveMetricsAttribution {
  const storedGmp = row.gmpPrice as Nullable;
  const storedGmpPct = row.gmpPercentageHistorical as Nullable;
  const storedSubTotal = row.subscriptionTotal as Nullable;
  const storedSubRetail = row.subscriptionRetail as Nullable;
  const storedSubQib = row.subscriptionQib as Nullable;
  const storedSubHni = row.subscriptionHni as Nullable;

  // Attribution describes the DERIVED value only. If the stored column already
  // had a figure, that figure is not the time-series one — say nothing about it.
  const gmpDerived = storedGmp === null || storedGmp === undefined;
  const subDerived = storedSubTotal === null || storedSubTotal === undefined;

  return {
    ...row,
    gmpPrice: firstPresent(storedGmp, live?.gmp),
    gmpPercentageHistorical: firstPresent(storedGmpPct, live?.gmpPercentage),
    subscriptionTotal: firstPresent(storedSubTotal, live?.subscriptionTotal),
    subscriptionRetail: firstPresent(storedSubRetail, live?.subscriptionRetail),
    subscriptionQib: firstPresent(storedSubQib, live?.subscriptionQib),
    subscriptionHni: firstPresent(storedSubHni, live?.subscriptionHni),
    gmpSource: gmpDerived && live?.gmp !== null && live?.gmp !== undefined ? live.gmpSource ?? null : null,
    gmpUpdatedAt:
      gmpDerived && live?.gmp !== null && live?.gmp !== undefined ? toIso(live.gmpTimestamp) : null,
    subscriptionUpdatedAt:
      subDerived && live?.subscriptionTotal !== null && live?.subscriptionTotal !== undefined
        ? toIso(live.subscriptionTimestamp)
        : null,
  } as T & LiveMetricsAttribution;
}
