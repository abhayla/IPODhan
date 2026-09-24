/**
 * Item 7 S5 — the post-listing price job (spec docs/design/data-sourcing-pull-model.md §2.1
 * job row "Post-listing price" and "Post-listing prices: 15 minutes, 90 days, and no broker
 * feed (OD-29)"; OD-29, OD-54; findings F-150, F-155, F-162).
 *
 * Every 15 minutes in exchange market hours (09:15-15:30 IST, Mon-Fri, not an NSE holiday),
 * for each IPO with status LISTED whose listing date is inside the 90-day window (IST dates):
 * read the last traded price and write ONLY `ipos.current_price` and its as-of stamp.
 *
 *   Which exchange wins: NSE, then BSE — the rank the spec gives `current_price` (§1 field
 *   table row 171: NSE rank 1, BSE rank 2). BSE is read only when NSE has no price, so a
 *   mainboard stock costs one call.
 *
 *   The as-of stamp is the exchange's own time (NSE `lastUpdateTime`, BSE `Ason`), because the
 *   page labels the price with the time it was read (§2.1 "Label"). The stamp only moves forward
 *   (the writer refuses an older as-of), and an unchanged price read later still moves it.
 *
 *   The 90-day window is a window on `listing_date`, exactly as OD-29 states it: the listing day
 *   is day 1, the 90th day is the last. This job never infers a stage (#932).
 *
 *   A run where neither exchange returns a price (no symbol/no ISIN, outage, or an explicit
 *   no-such-symbol answer) writes nothing: "no price this run" is logged with its cause and
 *   the job moves on. Delisting detection — turning a no-price run into a status change — is a
 *   separate item (split from this PR by owner decision 2026-09-24; see the item 7 build card).
 *
 *   Calls (§7.4): each stock's working NSE series is cached on the row (`price_nse_series`) and
 *   asked first, so an SME trading in ST costs 1 call after its first success, not 2-4. The wake
 *   paces the calls and the run line counts them.
 */
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import type { QuoteOutcome } from '../scrapers/post-listing-quote.js';

export const POST_LISTING_WINDOW_DAYS = 90;
export const PRICE_JOB_OPEN_IST_MINUTES = 9 * 60 + 15;
export const PRICE_JOB_CLOSE_IST_MINUTES = 15 * 60 + 30;

const IST_OFFSET_MS = 330 * 60_000;

/**
 * Exchange market hours, IST, Mon-Fri: 09:15 up to and including 15:30, so the 15:30 wake
 * reads the session's last trade. Holidays are checked by the caller (a DB read).
 */
export function isPriceJobWindowIST(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const weekday = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return weekday >= 1 && weekday <= 5 && minutes >= PRICE_JOB_OPEN_IST_MINUTES && minutes <= PRICE_JOB_CLOSE_IST_MINUTES;
}

/**
 * The close read: the 15:30 IST wake. The continuous session ends at 15:30, so this read's last
 * traded price is the session's last trade (NSE's official closing price is a volume-weighted
 * average published after 15:30 and is not read: the spec's window is market hours).
 */
export function isCloseReadIST(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes() >= PRICE_JOB_CLOSE_IST_MINUTES;
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
  status: string;
  nseSeries: string | null;
}

/**
 * LISTED rows whose listing date is one of the 90 IST dates that start at the listing date
 * (listing day = day 1, so the floor is EXCLUSIVE: `listing_date > today - 90`). Stalest price
 * first, so a run cut short by its deadline starts, next time, where this one stopped.
 */
export async function selectPriceCandidates(
  db: NodePgDatabase<typeof schema>,
  now: Date,
): Promise<PriceCandidate[]> {
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
      status: t.status,
      nseSeries: t.priceNseSeries,
    })
    .from(t)
    .where(and(eq(t.status, 'LISTED'), gt(t.listingDate, from), lte(t.listingDate, today)))
    .orderBy(sql`${t.currentPriceUpdatedAt} asc nulls first`, asc(t.id));
  return rows.map((r) => ({
    ...r,
    listingDate: r.listingDate == null ? null : String(r.listingDate),
    status: String(r.status),
  })) as PriceCandidate[];
}

/** The row-state columns the job keeps (the cached working series). Only changed keys are sent. */
export interface PriceStatePatch {
  nseSeries?: string;
}

export type PriceWriteOutcome = 'updated' | 'confirmed' | 'unchanged' | 'stale';

export interface PriceJobDeps {
  now: Date;
  candidates: PriceCandidate[];
  readNse: (symbol: string, segment: string | null, cachedSeries: string | null) => Promise<QuoteOutcome>;
  readBse: (scripCode: string) => Promise<QuoteOutcome>;
  /** ISIN -> BSE scrip code, from BSE's active-scrip list. Called at most once per run, only when needed. */
  loadBseScrips: () => Promise<Map<string, string>>;
  writePrice: (c: PriceCandidate, q: Extract<QuoteOutcome, { kind: 'price' }>) => Promise<PriceWriteOutcome>;
  writeState: (c: PriceCandidate, patch: PriceStatePatch) => Promise<void>;
  log: (line: string, fields: Record<string, unknown>) => void;
  /** Epoch ms after which no new IPO is started (keeps the run inside the shared `live` lock's TTL). */
  deadlineAt?: number;
  clock?: () => number;
}

export interface PriceJobSummary {
  candidates: number;
  updated: string[];
  confirmed: string[];
  unchanged: string[];
  stale: string[];
  noPrice: string[];
  refused: string[];
  notReached: string[];
  calls: { nse: number; bse: number; bseList: number; total: number };
}

type Verdict = 'price' | 'no-symbol' | 'refused' | 'unknown';

export async function runPostListingPriceJob(deps: PriceJobDeps): Promise<PriceJobSummary> {
  const summary: PriceJobSummary = {
    candidates: deps.candidates.length,
    updated: [], confirmed: [], unchanged: [], stale: [], noPrice: [],
    refused: [], notReached: [],
    calls: { nse: 0, bse: 0, bseList: 0, total: 0 },
  };
  let bseScrips: Map<string, string> | null = null;
  let bseListFailed: string | null = null;
  const clock = deps.clock ?? (() => Date.now());
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
    if (deps.deadlineAt !== undefined && clock() >= deps.deadlineAt) {
      summary.notReached.push(name);
      continue;
    }

    // NSE first (§1 rank 1), the cached working series asked first.
    let nseVerdict: Verdict = 'unknown';
    let nseDetail = 'no NSE symbol stored, NSE not asked';
    let nse: QuoteOutcome | null = null;
    if (c.symbol) {
      nse = await deps.readNse(c.symbol, c.segment, c.nseSeries);
      summary.calls.nse += nse.calls;
      nseVerdict = nse.kind;
      nseDetail = nse.kind === 'price' ? `series ${nse.series}` : nse.detail;
    }
    let winner: Extract<QuoteOutcome, { kind: 'price' }> | null = nse?.kind === 'price' ? nse : null;

    // BSE only when NSE has no price. No ISIN -> no scrip code -> BSE is UNKNOWN for this run.
    let bseVerdict: Verdict = 'unknown';
    let bseDetail = 'no ISIN stored, so no BSE scrip code: BSE unknown';
    if (!winner && c.isin) {
      const scrip = await scripFor(c.isin);
      if (scrip.failed) {
        bseVerdict = 'refused';
        bseDetail = `BSE active list failed: ${scrip.failed}`;
      } else if (!scrip.code) {
        bseVerdict = 'no-symbol';
        bseDetail = `ISIN ${c.isin} is not in BSE's active list (not listed on BSE)`;
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
      summary[outcome].push(name);
      if (winner.exchange === 'NSE' && winner.series && winner.series !== c.nseSeries) {
        await deps.writeState(c, { nseSeries: winner.series });
      }
      deps.log(
        `post-listing price: ${name} ${outcome} ${winner.exchange} ${winner.price} as of ${winner.asOfText}`,
        { ipoId: c.id, exchange: winner.exchange, price: winner.price, asOf: winner.asOf.toISOString(), outcome, series: winner.series ?? null },
      );
      continue;
    }

    if (nseVerdict === 'refused' || bseVerdict === 'refused') {
      summary.refused.push(name);
      deps.log(`post-listing price: ${name} no price (outage) — NSE ${nseVerdict}: ${nseDetail}; BSE ${bseVerdict}: ${bseDetail}`, {
        ipoId: c.id, reason: 'refused', nse: nseDetail, bse: bseDetail,
      });
      continue;
    }
    summary.noPrice.push(name);
    deps.log(
      `post-listing price: ${name} no price this run — NSE ${nseVerdict}: ${nseDetail}; BSE ${bseVerdict}: ${bseDetail}`,
      { ipoId: c.id, reason: 'no-price', nse: nseVerdict, bse: bseVerdict },
    );
  }
  summary.calls.total = summary.calls.nse + summary.calls.bse + summary.calls.bseList;
  return summary;
}
