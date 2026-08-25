/**
 * Keyless-coverage metric (T-318, ITEM 2 — extends the existing per-cycle
 * data-quality watchdog, does NOT duplicate it; wired from
 * `triggerDataQualityWatchdog()` in `scraper/src/index.ts`, alongside
 * `evaluateFreshness` and `checkCrossSourceDisagreements`).
 *
 * A "keyless" `ipos` row has NEITHER a symbol NOR an isin — the row identity
 * resolver (`packages/shared/src/repositories/ipo-identity.ts`) falls all
 * the way through to name-based matching for these rows, since T-318's
 * key-first tiers (isin, then NSE/BSE symbol) can never fire for them.
 * T-314C/T-317 measured this at 69/303 (23%) of production rows — a
 * material, expected fraction (MAINBOARD is worse than SME: 62% have a
 * symbol vs SME's 92%), not a defect to silently improve away here. This
 * module only REPORTS the count/percentage per cycle so the fraction is
 * visible over time; it does not change resolution behavior (ITEM 4 — no
 * behavior change beyond identity/metric).
 */
import { count, and, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { ipos } from '@ipodhan/shared/db/schema';

export interface KeylessCoverageReport {
  totalCount: number;
  keylessCount: number;
  /** Percentage of rows with neither symbol nor isin, rounded to 1 decimal. 0 when totalCount is 0 (never NaN/Infinity — see error-handling.md). */
  keylessPct: number;
}

/**
 * Count `ipos` rows with `symbol IS NULL AND isin IS NULL` against the total
 * row count. Empty-table-safe by construction: a zero-row table returns
 * `{ totalCount: 0, keylessCount: 0, keylessPct: 0 }` rather than dividing
 * by zero.
 */
export async function getKeylessCoverage(
  db: NodePgDatabase<typeof schema>
): Promise<KeylessCoverageReport> {
  const [totalRow] = await db.select({ value: count() }).from(ipos);
  const totalCount = totalRow?.value ?? 0;

  if (totalCount === 0) {
    return { totalCount: 0, keylessCount: 0, keylessPct: 0 };
  }

  const [keylessRow] = await db
    .select({ value: count() })
    .from(ipos)
    .where(and(isNull(ipos.symbol), isNull(ipos.isin)));
  const keylessCount = keylessRow?.value ?? 0;

  const keylessPct = Math.round((keylessCount / totalCount) * 1000) / 10;

  return { totalCount, keylessCount, keylessPct };
}
