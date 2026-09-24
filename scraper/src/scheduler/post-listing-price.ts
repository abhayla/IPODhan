/**
 * Item 7 S5 — the post-listing price job (spec docs/design/data-sourcing-pull-model.md §2.1
 * job row "Post-listing price" and "Post-listing prices: 15 minutes, 90 days, and no broker
 * feed (OD-29)"; OD-29, OD-54; delisting §2.3.3.3, OD-38; findings F-150, F-155).
 *
 * Every 15 minutes in exchange market hours (09:15-15:30 IST, Mon-Fri, not an NSE holiday),
 * for each IPO with status LISTED whose listing date is within the last 90 days (IST date):
 * read the last traded price and write ONLY `ipos.current_price` and its as-of stamp.
 *
 *   Which exchange wins: NSE, then BSE — the rank the spec gives `current_price` (§1 field
 *   table row 171: NSE rank 1, BSE rank 2; the manifest ranks
 *   `listing_performance.current_price` the same way, and an SME scrip trades on one exchange
 *   only). BSE is read only when NSE has no price, so a mainboard stock costs one call.
 *
 *   The as-of stamp is the exchange's own time (NSE `lastUpdateTime`, BSE `Ason`), because the
 *   page labels the price with the time it was true (§2.1 "Label").
 *
 *   The 90-day window is a window on `listing_date`, exactly as OD-29 states it. Stage
 *   inference from `listing_date` (#932) is a different question and out of scope: this job
 *   never changes a status.
 *
 *   Delisting (§2.3.3.3): a run counts as a no-such-symbol read only when EVERY exchange the
 *   stock could trade on answered "no such symbol" (NSE: no series answers; BSE: the ISIN is
 *   absent from BSE's active list, or the scrip answers not-listed), no exchange refused, and
 *   the IST date is after the listing date. A row with no ISIN cannot be judged on BSE, so it
 *   is never counted (a BSE-only SME with no ISIN would otherwise be "delisted" in 45 minutes).
 *   The third consecutive read stops the job for the row (`delisted_on`); a price resets the
 *   count to 0.
 */
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import type { QuoteOutcome } from '../scrapers/post-listing-quote.js';

export const POST_LISTING_WINDOW_DAYS = 90;
export const PRICE_JOB_OPEN_IST_MINUTES = 9 * 60 + 15;
export const PRICE_JOB_CLOSE_IST_MINUTES = 15 * 60 + 30;
export const DELISTING_CONSECUTIVE_READS = 3;

const IST_OFFSET_MS = 330 * 60_000;

/**
 * Exchange market hours, IST, Mon-Fri: 09:15 up to and including 15:30, so the 15:30 wake
 * reads the closing price. Holidays are checked by the caller (a DB read).
 */
export function isPriceJobWindowIST(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const weekday = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return weekday >= 1 && weekday <= 5 && minutes >= PRICE_JOB_OPEN_IST_MINUTES && minutes <= PRICE_JOB_CLOSE_IST_MINUTES;
}

/** The IST calendar date `days` before `now`'s IST date, as YYYY-MM-DD. */
export function istDateDaysBefore(now: Date, days: number): string {
  return istDayIso(new Date(now.getTime() - days * 86_400_000));
}

export interface PriceCandidate {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: string | null;
  isin: string | null;
  listingDate: string | null;
  currentPrice: unknown;
  currentPriceUpdatedAt: unknown;
  priceNoSymbolReads: number;
}

/** LISTED, listed within the last 90 days (IST dates, both ends inclusive), not judged delisted. */
export async function selectPriceCandidates(db: NodePgDatabase<typeof schema>, now: Date): Promise<PriceCandidate[]> {
  const t = schema.ipos;
  const today = istDayIso(now);
  const from = istDateDaysBefore(now, POST_LISTING_WINDOW_DAYS);
  const rows = await db
    .select({
      id: t.id,
      companyName: t.companyName,
      symbol: t.symbol,
      segment: t.segment,
      isin: t.isin,
      listingDate: t.listingDate,
      currentPrice: t.currentPrice,
      currentPriceUpdatedAt: t.currentPriceUpdatedAt,
      priceNoSymbolReads: t.priceNoSymbolReads,
    })
    .from(t)
    .where(and(eq(t.status, 'LISTED'), gte(t.listingDate, from), lte(t.listingDate, today), isNull(t.delistedOn)));
  return rows.map((r) => ({ ...r, listingDate: r.listingDate == null ? null : String(r.listingDate) })) as PriceCandidate[];
}

export interface PriceJobDeps {
  now: Date;
  candidates: PriceCandidate[];
  readNse: (symbol: string, segment: string | null) => Promise<QuoteOutcome>;
  readBse: (scripCode: string) => Promise<QuoteOutcome>;
  /** ISIN -> BSE scrip code, from BSE's active-scrip list. Called at most once per run, only when needed. */
  loadBseScrips: () => Promise<Map<string, string>>;
  writePrice: (c: PriceCandidate, q: Extract<QuoteOutcome, { kind: 'price' }>) => Promise<'updated' | 'unchanged'>;
  writeReads: (c: PriceCandidate, reads: number, delistedOn: string | null) => Promise<void>;
  log: (line: string, fields: Record<string, unknown>) => void;
}

export interface PriceJobSummary {
  candidates: number;
  updated: string[];
  unchanged: string[];
  noSymbol: string[];
  delisted: string[];
  refused: string[];
  notJudged: string[];
  calls: { nse: number; bse: number; bseList: number };
}

export async function runPostListingPriceJob(deps: PriceJobDeps): Promise<PriceJobSummary> {
  const summary: PriceJobSummary = {
    candidates: deps.candidates.length,
    updated: [], unchanged: [], noSymbol: [], delisted: [], refused: [], notJudged: [],
    calls: { nse: 0, bse: 0, bseList: 0 },
  };
  const today = istDayIso(deps.now);
  let bseScrips: Map<string, string> | null = null;
  let bseListFailed: string | null = null;
  const scripFor = async (isin: string): Promise<{ code: string | null; failed: string | null }> => {
    if (!bseScrips && !bseListFailed) {
      summary.calls.bseList++;
      try {
        bseScrips = await deps.loadBseScrips();
      } catch (error) {
        bseListFailed = error instanceof Error ? error.message : String(error);
      }
    }
    if (bseListFailed) return { code: null, failed: bseListFailed };
    return { code: bseScrips!.get(isin) ?? null, failed: null };
  };

  for (const c of deps.candidates) {
    const name = c.companyName;
    let nse: QuoteOutcome | null = null;
    if (c.symbol) {
      nse = await deps.readNse(c.symbol, c.segment);
      summary.calls.nse += nse.calls;
    }
    let winner: Extract<QuoteOutcome, { kind: 'price' }> | null = nse?.kind === 'price' ? nse : null;

    // BSE only when NSE has no price. `bseVerdict`: price | no-symbol | refused | unknown (no ISIN).
    let bseVerdict: 'price' | 'no-symbol' | 'refused' | 'unknown' = 'unknown';
    let bseDetail = 'no ISIN stored, BSE not read';
    if (!winner && c.isin) {
      const scrip = await scripFor(c.isin);
      if (scrip.failed) {
        bseVerdict = 'refused';
        bseDetail = `BSE list failed: ${scrip.failed}`;
      } else if (!scrip.code) {
        bseVerdict = 'no-symbol';
        bseDetail = `ISIN ${c.isin} not in BSE's active list`;
      } else {
        const bse = await deps.readBse(scrip.code);
        summary.calls.bse += bse.calls;
        bseVerdict = bse.kind;
        bseDetail = bse.kind === 'price' ? `scrip ${scrip.code}` : `scrip ${scrip.code}: ${bse.detail}`;
        if (bse.kind === 'price') winner = bse;
      }
    }

    if (winner) {
      const outcome = await deps.writePrice(c, winner);
      (outcome === 'updated' ? summary.updated : summary.unchanged).push(name);
      if (c.priceNoSymbolReads > 0) await deps.writeReads(c, 0, null);
      deps.log(`post-listing price: ${name} ${outcome} ${winner.exchange} ${winner.price} as of ${winner.asOfText}`, {
        ipoId: c.id, exchange: winner.exchange, price: winner.price, asOf: winner.asOf.toISOString(), outcome,
      });
      continue;
    }

    const nseSaysNone = !c.symbol || nse?.kind === 'no-symbol';
    const anyRefused = nse?.kind === 'refused' || bseVerdict === 'refused';
    const consulted = Boolean(c.symbol) || bseVerdict !== 'unknown';
    if (anyRefused) {
      summary.refused.push(name);
      deps.log(`post-listing price: ${name} refused — NSE ${nse ? (nse.kind === 'price' ? 'price' : `${nse.kind}: ${nse.detail}`) : 'no symbol'}; BSE ${bseDetail}`, { ipoId: c.id, reason: 'refused' });
      continue;
    }
    if (!consulted || bseVerdict === 'unknown' || !nseSaysNone || !(c.listingDate && today > c.listingDate)) {
      summary.notJudged.push(name);
      deps.log(`post-listing price: ${name} no price, delisting not judged — NSE ${nse ? nse.kind : 'no symbol'}; BSE ${bseDetail}; listed ${c.listingDate ?? 'unknown'}`, { ipoId: c.id, reason: 'not-judged' });
      continue;
    }
    const reads = c.priceNoSymbolReads + 1;
    const delistedOn = reads >= DELISTING_CONSECUTIVE_READS ? today : null;
    await deps.writeReads(c, reads, delistedOn);
    (delistedOn ? summary.delisted : summary.noSymbol).push(name);
    deps.log(
      `post-listing price: ${name} no-such-symbol read ${reads} of ${DELISTING_CONSECUTIVE_READS}${delistedOn ? ` — delisted on ${delistedOn}, the job stops for this IPO` : ''}`,
      { ipoId: c.id, reads, delistedOn },
    );
  }
  return summary;
}
