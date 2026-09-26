/**
 * #983 — delisting detection for the post-listing price job (spec
 * docs/design/data-sourcing-pull-model.md §2.3.3.3 "Delisting" and OD-38: "Three consecutive
 * no-such-symbol reads stop the price job and set DELISTED"; §2.1 "Post-listing prices", F-150,
 * F-160, F-162: "an unknown answer is not a no-such-symbol answer: a run where BSE cannot be asked
 * (no ISIN) or either exchange gave an outage page does not count").
 *
 * What one run's answers mean for one IPO (measured 2026-09-26, fixture
 * scraper/tests/fixtures/post-listing-price/delisting-read-shapes-2026-09-26.json):
 *
 *   OK             an exchange gave a price that passed the price guards. Resets the count.
 *   STRIKE         no price, and an exchange REPORTED the scrip delisted (NSE secStatus
 *                  "Permanent Suspended", BSE Category "Delisted"), and every other exchange
 *                  that was asked answered without an outage. Counts toward DELISTED.
 *   NO_SUCH_SYMBOL every exchange answered "no such symbol" (NSE: every series 404 with
 *                  `{"error":"Unexpected end of JSON input"}`; BSE: not in the full active list).
 *                  NOT counted: that 404 body is byte-identical for a wrong series (HEROMOTORS/SM),
 *                  a symbol NSE never had (ZZNOSUCHSYM) and a RENAMED symbol whose company still
 *                  trades (ADANITRANS -> ADANIENSOL). Five delisted companies (HDFC, IDFC, CAIRN,
 *                  ESSAROIL, HEXAWARE) never answer it; they answer "Permanent Suspended". So
 *                  counting it would delist a renamed company and would never catch a delisted one.
 *   UNKNOWN        anything else: an outage page, a refusal, a suspension ("Temporary Suspended"),
 *                  a price the guards refused, an exchange that could not be asked (no NSE symbol;
 *                  no ISIN stored and none in NSE's answer; a failed or truncated BSE list), or a
 *                  STRIKE voided by the run canary.
 *
 * UNKNOWN and NO_SUCH_SYMBOL are neither a strike nor a reset: they are not a read of the scrip's
 * listing state (F-162, "does not count"), so they neither advance nor break a run of reports.
 * Only a price read (OK) resets, because a price proves the scrip trades.
 */

export const DELISTING_STRIKES_TO_DELIST = 3;

/**
 * BSE `ListofScripData` (segment=Equity, status=Active) carried 5,047 scrips on 2026-09-24 (F-155).
 * A list much shorter than that is a truncated or partial fetch: "not in the list" would then be
 * read as "not listed on BSE" for scrips that are. Below this floor the list counts as failed.
 */
export const BSE_ACTIVE_LIST_MIN_SCRIPS = 4000;

/**
 * Run canary: real delistings inside 90 days of listing are rare (0 known on staging). When, within
 * one first-asked NSE series, more than max(FLOOR, SHARE x asked) IPOs come back STRIKE or
 * NO_SUCH_SYMBOL in the same run, the endpoint or route is failing, not the companies: every STRIKE
 * in that group is voided (UNKNOWN) for this run.
 */
export const DELISTING_CANARY_FLOOR = 2;
export const DELISTING_CANARY_MAX_SHARE = 0.2;

export type DelistingVerdict = 'OK' | 'STRIKE' | 'NO_SUCH_SYMBOL' | 'UNKNOWN';

/** One exchange's answer this run, as the job saw it. */
export type ExchangeAnswer = 'price' | 'delisted' | 'no-symbol' | 'refused' | 'not-asked';

export function classifyRunForDelisting(input: {
  priced: boolean;
  nse: ExchangeAnswer;
  bse: ExchangeAnswer;
}): DelistingVerdict {
  if (input.priced) return 'OK';
  const answered = (a: ExchangeAnswer) => a === 'delisted' || a === 'no-symbol';
  if (!answered(input.nse) || !answered(input.bse)) return 'UNKNOWN';
  if (input.nse === 'delisted' || input.bse === 'delisted') return 'STRIKE';
  return 'NO_SUCH_SYMBOL';
}

export interface StrikeRead {
  at: string;
  exchange: string;
  detail: string;
}

export interface DelistingState {
  strikes: number;
  reads: StrikeRead[];
}

export interface DelistingTransition {
  changed: boolean;
  next: DelistingState;
  /** The instant of the third consecutive strike, when this read delists the row. */
  delistAt: Date | null;
}

export function nextDelistingState(
  prev: DelistingState,
  verdict: DelistingVerdict,
  read: { at: Date; exchange: string; detail: string },
): DelistingTransition {
  if (verdict === 'OK') {
    if (prev.strikes === 0 && prev.reads.length === 0) return { changed: false, next: prev, delistAt: null };
    return { changed: true, next: { strikes: 0, reads: [] }, delistAt: null };
  }
  if (verdict !== 'STRIKE') return { changed: false, next: prev, delistAt: null };
  const reads = [...prev.reads, { at: read.at.toISOString(), exchange: read.exchange, detail: read.detail }].slice(-DELISTING_STRIKES_TO_DELIST);
  const strikes = prev.strikes + 1;
  return {
    changed: true,
    next: { strikes, reads },
    delistAt: strikes >= DELISTING_STRIKES_TO_DELIST ? read.at : null,
  };
}

/**
 * Apply the run canary. `rows` carries each IPO's group (the NSE series asked first) and verdict;
 * returns the groups whose STRIKEs are voided, with the counts that voided them.
 */
export function delistingCanary(
  rows: Array<{ group: string; verdict: DelistingVerdict; nseAsked: boolean }>,
): Map<string, { asked: number; bad: number; limit: number }> {
  const byGroup = new Map<string, { asked: number; bad: number }>();
  for (const r of rows) {
    if (!r.nseAsked) continue;
    const g = byGroup.get(r.group) ?? { asked: 0, bad: 0 };
    g.asked++;
    if (r.verdict === 'STRIKE' || r.verdict === 'NO_SUCH_SYMBOL') g.bad++;
    byGroup.set(r.group, g);
  }
  const voided = new Map<string, { asked: number; bad: number; limit: number }>();
  for (const [group, g] of byGroup) {
    const limit = Math.max(DELISTING_CANARY_FLOOR, Math.floor(DELISTING_CANARY_MAX_SHARE * g.asked));
    if (g.bad > limit) voided.set(group, { ...g, limit });
  }
  return voided;
}
