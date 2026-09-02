/**
 * Document discovery runner — T-403 WP A, the live side of the decision tree
 * (decision-matrix §1) driven by the state machine (§7).
 *
 * BSE-FIRST, per the owner's 2026-08-28 rule: "BSE or NSE first, always."
 *
 * All four rungs are SHIPPED and wired (the header used to say the last two
 * were "the next thing to wire" — they were built in round 2 and the stale
 * sentence outlived them, which is exactly how a reader ends up believing a
 * live rung is a stub). Mainboard order is BSE core API -> NSE ipo-detail ->
 * SEBI's filing lists -> the issuer's own investor page, with Chittorgarh
 * consulted last as a link VERIFIER only (never a document source).
 * SME order is NSE first, because BSE's mainboard board does not carry SME.
 * NSE is fetched on demand: when BSE covered every due type and one of those
 * downloads then fails, the NSE copy is fetched at that point rather than the
 * type going BLOCKED_ALL with an untried source in reach (matrix F2).
 *
 * What replaces what: the old `runPrimaryDocBackfill` fetched NSE for EVERY
 * candidate IPO, once a day, with a 15 s cap and no retry, and kept no record of
 * what happened. This runner asks the state machine what is outstanding FIRST
 * and makes no request at all for an IPO with nothing due.
 *
 * Every dependency — fetching, the state store, the document sink, the clock —
 * is injected. The acceptance harness (`scraper/scripts/run-document-discovery.ts`)
 * uses that to run this exact decision logic against real exchange payloads in
 * either of two modes: an in-memory store, or `--db`, which persists to a real
 * Postgres whose name must end in `_test` (`assertTestDatabase`) and reads the
 * result back out with SQL. The `--db` mode is the one whose evidence counts;
 * the in-memory mode exists so the chain can be exercised with no database at
 * all.
 */

import {
  parseBSEDocuments,
  parseNSEDocuments,
  encodeDocumentUrl,
  type DiscoveredDocument,
} from './primary-source-discovery.js';
import { parseBseBoard, resolveBseBoardRow, extractBseCoreRow, type BseBoardRow } from './bse-ipo-board.js';
import { parseBseParties } from './bse-party-parser.js';
import { parseNseLeadManagers } from './nse-party-parser.js';
import { verifyDownload, isVerifyFailure, type VerifyResult } from './document-download-verifier.js';
import { storeDocument, getStoreDir } from './document-store.js';
import { extractCoverText as extractCoverTextFromPdf } from './pdf-cover-text.js';
import {
  parseSebiListing,
  matchSebiRow,
  parseSebiDetailPdfUrl,
  sebiListingUrlFor,
  type SebiListingRow,
} from './sebi-source.js';
import {
  parseCompanyHostLinks,
  companyInvestorUrls,
  extractVerifierLinks,
  extractWebsiteFromCoverText,
  normalizeCompanyUrl,
  isStorableFromCompanyPage,
  isVerifierUrl,
} from './company-host-source.js';
import {
  planIpoCycle,
  applyOutcome,
  type AttemptOutcome,
  type CycleOptions,
  type IssueShape,
  type StateRow,
} from './document-state-machine.js';
import { isExchangeServedType, type DocumentType } from './document-types.js';
import type { LifecycleStage } from '../scheduler/stage-reconciler.js';
import type {
  DocumentFetchStatePatch,
  DocumentFetchStateRow,
  FetchAttempt,
  IDocumentFetchStateStore,
} from '@ipodhan/shared/repositories/document-fetch-state-repository';
import { NetworkCounter, hostOf } from '../utils/network-counter.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Wire-level configuration
// ---------------------------------------------------------------------------

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const NSE_IPO_DETAIL = 'https://www.nseindia.com/api/ipo-detail';

/**
 * The exchanges are stricter about headers than about rate. Both hosts were
 * verified live 2026-08-28 with exactly these; NSE's homepage returned 403 in
 * the same minute its API returned 200, so a browser-shaped UA plus a Referer
 * is not optional.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BSE_HEADERS = {
  'User-Agent': BROWSER_UA,
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

/** SEBI serves plain HTML; it wants a browser UA but no exchange Referer. */
const SEBI_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml',
};

/** Generic page fetch for an issuer host or the verifier. */
const BROWSER_PAGE_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml',
};

const NSE_HEADERS = {
  'User-Agent': BROWSER_UA,
  Referer: 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
  Accept: 'application/json',
};

/**
 * NSE retry ladder. The matrix measured stalls clearing within a minute
 * (4.7 s -> 0.5 s by the third call), so three tries at 2/4/8 s is the
 * documented cure for the single defect that starved discovery of Skyways.
 */
export const NSE_RETRY_BACKOFF_MS = [2_000, 4_000, 8_000];

/**
 * BSE gets the SAME ladder. Round 1 gave the retry only to NSE, on the evidence
 * that NSE was the source that stalled. The 2026-08-28 re-run then lost the
 * whole BSE core payload for Skyways to a single transport failure (http 0) —
 * and with it every BSE-only document type AND all three lead managers — while
 * a manual request seconds later returned 200. A transient stall is not an
 * NSE-specific phenomenon; assuming it was cost a complete cycle of BSE data.
 */
export const BSE_RETRY_BACKOFF_MS = [2_000, 4_000, 8_000];

/**
 * Attempt outcomes that mean 'this source was asked and could not answer'.
 * Deliberately excludes `not_on_board` and `no_symbol`, which mean the exchange
 * does not carry this issue at all (F13) — a fact, not a failure.
 */
export const EXCHANGE_FAILURE_OUTCOMES = [
  'http_error',
  'timeout',
  'shape_error',
  'board_unavailable',
  'no_detail_row',
];

/** Per-request ceiling for a JSON API call. Generous vs the old 15 s cap. */
export const FETCH_TIMEOUT_MS = 20_000;

/**
 * Which source served this URL, decided by HOST (NIT-4).
 *
 * The substring version this replaces (`url.includes('bseindia')`) mislabels
 * `https://cdn.example.com/?ref=bseindia` as BSE, and any path containing the
 * word. The verifier only ever hands us allowlisted hosts, so this is a
 * labelling bug rather than a hole — but a label that can be wrong is a label
 * that will be wrong in an audit trail, which is what the log is for.
 */
export function sourceOfDocumentUrl(url: string): DiscoveredDocument['source'] {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // T-403 r5 (7): an unparseable URL is not an NSE URL. Defaulting to 'NSE'
    // stamped a real exchange name onto something we could not even parse, in
    // the one record whose whole job is to say where a file came from.
    return 'UNKNOWN';
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on('sebi.gov.in')) return 'SEBI';
  if (on('bseindia.com')) return 'BSE';
  return 'NSE';
}

/**
 * A URL that points at a downloadable document. Used to decide which attempts
 * belong to one document type's log. The dot IS escaped (NIT-2): `/.(pdf|zip)/`
 * matches "apdf" and any three-character run ending in "pdf".
 */
const DOC_URL_RE = /\.(pdf|zip)(\?|#|$)/i;

/**
 * Per-request ceiling for a DOCUMENT download. Six times the API budget,
 * because they are not the same kind of request: an RHP is 15-25 MB (Skyways'
 * NSE zip is 23 MB) and the acceptance run caught the original single-budget
 * design timing the Skyways RHP out at exactly 20,018 ms while every small
 * document beside it downloaded fine. One timeout for a 6 KB JSON payload and a
 * 25 MB PDF guarantees that the single most important filing is the one that
 * fails.
 */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * The budget for ONE IPO's escalation GETs in ONE cycle (M-d).
 *
 * Without it, an IPO the exchanges cannot cover pays the escalation cost per DUE
 * TYPE: Skyways' 2026-08-28 run escalated nine types, and the company rung alone
 * is three page GETs each. The per-cycle page cache below removes most of that
 * (the same investor page was being fetched once per type); this cap is the
 * backstop for the rest, so one unreachable issuer cannot consume a cycle.
 */
export const ESCALATION_GET_BUDGET_PER_IPO = 12;

/**
 * What a rung concluded (H-2).
 *
 * The distinction that matters is `failed` vs `absent`. Every SEBI failure path
 * used to `return null`, indistinguishable from "SEBI does not list this" — so a
 * DRHP that SEBI returned 503 for was written NOT_YET_FILED, i.e. "the company
 * has not filed it", from evidence that says nothing of the sort. `failed` now
 * propagates and lands the row in BLOCKED_ALL with its retry ladder.
 */

/**
 * The brand key. Module-private: nothing outside this file can spell it, so
 * nothing outside `answeredFrom` can mint an `AnsweredResponse`.
 */
const ANSWERED: unique symbol = Symbol('t403.answered-response');

/**
 * Proof that a source ANSWERED: a real HTTP 200, with the URL that served it
 * and how many bytes came back.
 *
 * This type is the round-5 class fix. Rounds 3 and 4 each removed the instances
 * of "a non-answer recorded as absence" that were visible at the time, and the
 * next round found three more, because the outcome was a bare string union and
 * nothing stopped a code path that never made a request from returning
 * `'absent'`. Absence is now a value that CARRIES its evidence, and the evidence
 * cannot be forged.
 */
interface AnsweredResponse {
  readonly [ANSWERED]: true;
  readonly status: number;
  readonly url: string;
  readonly bytes: number;
}

/**
 * The ONLY way to build an `AnsweredResponse`. Returns null unless the source
 * actually answered — so a 403, a 503, a timeout (status 0) or a budget refusal
 * (no response at all) has nothing to hand the `absent` arm.
 */
function answeredFrom(
  res: { status: number; body?: Buffer; url?: string },
  url?: string
): AnsweredResponse | null {
  if (res.status !== 200) return null;
  return {
    [ANSWERED]: true,
    status: res.status,
    url: res.url || url || '',
    bytes: res.body ? res.body.length : 0,
  };
}

/**
 * What a rung concluded (H-2, hardened in r5).
 *
 * `absent` means "this source answered and this filing is not there" and can
 * only be constructed with the answer that says so. `failed` means "we learned
 * nothing" and carries the reason into the audit trail. Only ABSENT from every
 * rung may write NOT_YET_FILED; any FAILED writes BLOCKED_ALL, which is the
 * state that carries the retry ladder and the alert.
 */
export type RungOutcome =
  | { kind: 'found'; documentId: string; bytes: number }
  | { kind: 'absent'; evidence: AnsweredResponse }
  | { kind: 'failed'; reason: string };

/** The absent arm's only constructor — it cannot be called without evidence. */
function absent(evidence: AnsweredResponse): RungOutcome {
  return { kind: 'absent', evidence };
}

/** The failed arm. A reason string, never silence. */
function failed(reason: string): RungOutcome {
  return { kind: 'failed', reason };
}

/** Narrowing helper — `strict: false` will not do it for us. */
export function isRungFound(
  r: RungOutcome
): r is { kind: 'found'; documentId: string; bytes: number } {
  return r.kind === 'found';
}

// ---------------------------------------------------------------------------
// The final outcome is DERIVED, never inherited (T-403 r6, Class 1 #4)
// ---------------------------------------------------------------------------

/** What the exchange stage concluded for ONE document type. */
export type ExchangeVerdict =
  | 'found' // a link was present and (unless downloads are off) it stored
  | 'no_link' // every consulted exchange ANSWERED and none carried a link
  | 'failed'; // an exchange we asked could not answer

/**
 * What the escalation chain concluded. `null` is its own answer and the one the
 * round-5 review turned on: not "absent", not "failed" — NOT ASKED. Every rung
 * was skipped (SEBI does not serve this type, the row has no company URL, the
 * row has no verifier URL), so nothing was learned by anyone.
 */
export type EscalationVerdict = 'found' | 'absent' | 'failed' | null;

/**
 * The whole per-type decision, as a pure function of the three facts that make it.
 *
 * WHY THIS EXISTS. Rounds 3, 4 and 5 each fixed "a non-answer recorded as
 * evidence of absence" by constraining how absence is CONSTRUCTED — the r5
 * branded `AnsweredResponse` makes it impossible to mint `absent` without a real
 * 200. The r5 review then found the fourth instance, which constructs nothing:
 * `outcome` was a mutable local set 80 lines earlier and overwritten only for
 * `found`/`failed`, so a `no_link` the exchanges were not entitled to settle
 * SURVIVED an escalation in which every rung was skipped, and the row was
 * written NOT_YET_FILED. A guard cannot catch a value that is merely not
 * overwritten; only removing the mutable variable can. Hence: one call, at the
 * end, over an exhaustive match, with a `never` arm so a new verdict member
 * cannot be added without deciding this table.
 *
 * ONE DEVIATION from the RCA's wording, deliberate and recorded in
 * docs/reviews/T-403-plan.md: the RCA says `chain_incomplete` whenever
 * `escalation === null && !settledByExchanges`, which literally also covers
 * `exchanges === 'failed'` (where `settledByExchanges` is false by
 * construction). Returning `chain_incomplete` there would downgrade a genuine
 * exchange OUTAGE from BLOCKED_ALL — retry ladder plus P2 alert — to a silent
 * WANTED, undoing the round-4 fix. A failure is a failure in every cell.
 */
export function resolveFinalOutcome(
  exchanges: ExchangeVerdict,
  settledByExchanges: boolean,
  escalation: EscalationVerdict
): AttemptOutcome {
  // The document is in hand: nothing downstream can make that untrue.
  if (exchanges === 'found' || escalation === 'found') return 'found';

  switch (exchanges) {
    case 'no_link':
      switch (escalation) {
        // A later rung ANSWERED and the filing is not there. That, and the
        // settled-by-exchanges case below, are the only two routes to
        // NOT_YET_FILED in the whole runner.
        case 'absent':
          return 'no_link';
        // Asked and could not answer — never evidence of absence (H-2).
        case 'failed':
          return 'all_sources_failed';
        // NOT ASKED. If the exchanges could settle this type themselves the
        // rungs were skipped because there was no question left; otherwise
        // nobody answered and we know nothing at all.
        case null:
          return settledByExchanges ? 'no_link' : 'chain_incomplete';
        default: {
          const unreachable: never = escalation;
          return unreachable;
        }
      }
    case 'failed':
      // An exchange we consulted could not answer. A SEBI/company/verifier
      // `absent` says nothing about the link the broken exchange would have
      // carried, so the honest state stays BLOCKED_ALL with its retry ladder.
      return 'all_sources_failed';
    default: {
      const unreachable: never = exchanges;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

export interface HttpResponse {
  status: number;
  contentType: string | null;
  body: Buffer;
  /** Post-redirect URL when the client knows it. */
  url: string;
}

export type HttpFetcher = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number }
) => Promise<HttpResponse>;

/**
 * Where a verified document is recorded — structurally satisfied by
 * `DocumentRepository.upsertDocument`.
 *
 * N1: the argument is typed loosely enough (a widened `type`, an optional-rich
 * return) that the real repository assigns WITHOUT a cast at the call site. The
 * first cut passed `documents as never`, which silenced exactly the mismatch
 * this interface exists to catch.
 */
export interface DocumentSinkInput {
  ipoId: string;
  type: DocumentType;
  title: string;
  url: string;
  exchange: string;
  mediaType: string;
  extractionStatus: string;
  isActive: boolean;
  fileSize?: number;
  /** sha256 of the stored bytes (W-1) — the persisted form of the E7/R2 rule. */
  sha256?: string;
}

export interface DocumentSink {
  upsertDocument(doc: DocumentSinkInput): Promise<{ id: string }>;
}

export interface DiscoveryIpo {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: 'MAINBOARD' | 'SME' | string | null;
  stage: LifecycleStage;
  issue?: IssueShape;
  /**
   * BSE's IPO_NO, when we already know it (`ipos.bse_ipo_no`).
   *
   * Load-bearing. `IPO_HomePageDetail` lists ONLY live and forthcoming issues —
   * verified 2026-08-28: Skyways had already dropped off the board the day after
   * it closed, which is exactly when its final Prospectus becomes due. So an
   * IPO_NO resolved by name from the board is available precisely while we need
   * it least. Once known it is remembered and used directly, which also skips
   * the board fetch entirely.
   */
  bseIpoNo?: number | null;
  /** Issuer website from `ipos` / `ipo_details`, when we store one (G2). */
  companyWebsite?: string | null;
  /**
   * A third-party IPO page (Chittorgarh) used ONLY to verify which exchange URL
   * is the right one. Never a document source (owner rule, 2026-08-28).
   */
  verifierUrl?: string | null;
}

export interface RunnerDeps {
  fetcher: HttpFetcher;
  store: IDocumentFetchStateStore;
  documents: DocumentSink;
  counter: NetworkCounter;
  now?: () => Date;
  cycleOptions?: CycleOptions;
  storeDir?: string;
  /** Skip writing PDFs to disk (acceptance runs that only prove call counts). */
  skipDownload?: boolean;
  /**
   * Retry backoff sleep, injectable (MIN-4).
   *
   * The BSE and NSE ladders wait 2 s + 4 s per exhausted source. Real in
   * production; in the chain tests, where three exchange failures are the SETUP
   * rather than the thing under test, it added ~73 s of pure sleeping to the
   * unit budget. Tests pass a no-op; nothing about the ladder's logic changes.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Page-1 text extractor for the cover-page company check (matrix §3 step 4).
   * Injected so a test can drive F8 without building a real PDF; defaults to
   * the pdf-parse-backed implementation, which is what runs in production.
   */
  extractCoverText?: (pdf: Buffer) => Promise<{ usable: boolean; text?: string }>;
  /**
   * Override for `ESCALATION_GET_BUDGET_PER_IPO`, so a test can exhaust the
   * budget in one GET instead of manufacturing thirteen. The budget's EFFECT on
   * the row is the thing worth testing (r5 detection-gap upgrade: every test of
   * a cap must assert the state the cap leaves behind), and that effect is
   * identical at 1 and at 12.
   */
  escalationBudget?: number;
}

export interface IpoRunResult {
  ipoId: string;
  companyName: string;
  stage: LifecycleStage;
  skipped: boolean;
  skipReason: string;
  due: DocumentType[];
  found: DocumentType[];
  notYetFiled: DocumentType[];
  blocked: DocumentType[];
  notApplicable: DocumentType[];
  /** Types closed because a later filing replaced them this cycle (F-3). */
  superseded: DocumentType[];
  leadManagers: string[];
  /** Which exchange the lead managers came from (F-2). */
  leadManagerSource?: 'BSE' | 'NSE';
  attempts: FetchAttempt[];
  networkCalls: number;
  /**
   * The IPO_NO resolved from the board this cycle, when it was not already
   * known. The caller MUST persist it to `ipos.bse_ipo_no`; see the note on
   * DiscoveryIpo.bseIpoNo for why re-deriving it later is not possible.
   */
  resolvedBseIpoNo?: number;
  /**
   * The issuer website read off a filing cover this cycle (T-403 M-6). The
   * caller persists it to `ipo_details.company_website`, which is what makes
   * rung 4 reachable on the NEXT document this IPO needs.
   */
  learnedCompanyWebsite?: string;
}

// ---------------------------------------------------------------------------
// The default fetcher
// ---------------------------------------------------------------------------

/** A real `fetch`-backed HttpFetcher. Never throws; a failure is status 0. */
export const defaultFetcher: HttpFetcher = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, { headers: init.headers, signal: controller.signal });
    const body = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      body,
      url: res.url || url,
    };
  } catch (error) {
    // status 0 is the transport-failure sentinel the attempt log records.
    return {
      status: 0,
      contentType: null,
      body: Buffer.alloc(0),
      url,
    };
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class DocumentDiscoveryRunner {
  private boardCache: BseBoardRow[] | null = null;
  /**
   * SEBI listings fetched this cycle, keyed by listing URL (one GET each).
   *
   * H-3: the value may be the literal 'failed'. It used to be `[]` on an HTTP
   * error, which is indistinguishable from "SEBI listed nothing" — so the first
   * IPO recorded `SEBI:failed:http_error` and every later IPO in the same cycle
   * recorded `SEBI:not_listed` about a request that was never made. That is not
   * a cache miss, it is an audit trail that lies.
   */
  private readonly sebiListings = new Map<
    string,
    { rows: SebiListingRow[]; evidence: AnsweredResponse } | 'failed'
  >();
  /**
   * Investor pages fetched this cycle, keyed by URL (M-d). The company rung is
   * driven per DOCUMENT TYPE but the pages are per ISSUER, so without this the
   * same three URLs were re-fetched for every due type — four GETs of
   * `skyways-air.in/investors` in one observed cycle.
   */
  private readonly companyPages = new Map<
    string,
    { status: number; html: string; evidence: AnsweredResponse | null }
  >();
  /**
   * Chittorgarh pages fetched this cycle, keyed by URL. The verifier rung runs
   * per DOCUMENT TYPE but the page is per IPO, so the un-cached version spent
   * one escalation GET per due type on the same URL — the same defect M-d fixed
   * for the company rung, left standing on this one.
   */
  private readonly verifierPages = new Map<
    string,
    { status: number; html: string; evidence: AnsweredResponse | null }
  >();
  /** Escalation GETs spent per IPO this cycle (M-d). */
  private readonly escalationGets = new Map<string, number>();
  /**
   * Per-try lines for the SHARED board fetch (F-1). The board is fetched once
   * per cycle for the whole market, so its retries are recorded here and copied
   * onto the attempt log of whichever IPO triggered the fetch — the retries stay
   * visible without being charged to every IPO.
   */
  private readonly boardAttempts: FetchAttempt[] = [];
  /** Issuer website learned from a filing cover, so rung 4 costs no extra fetch. */
  private readonly companyUrlByIpo = new Map<string, string>();
  private boardFetched = false;

  constructor(private readonly deps: RunnerDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Retry backoff. Injectable so tests do not actually sleep (MIN-4). */
  private async sleep(ms: number): Promise<void> {
    if (this.deps.sleep) return this.deps.sleep(ms);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * A counted request with the shared 2/4/8 s ladder, logging EVERY try (F-1).
   *
   * The ladder was already here; what was missing was the record of it. The
   * 2026-08-28 run shows a single BSE attempt reading `http 0, ms 6762` — three
   * real requests and two sleeps, collapsed into one line that looks like one
   * request that hung for seven seconds. A reviewer reading that log concluded
   * the retry was not wired. An attempt log that hides the retries cannot be
   * used to check the retries.
   *
   * The FINAL outcome line is still written by the caller with its plain
   * outcome label, so the F3/F6 coverage logic keeps matching on exact strings.
   */
  private async requestWithLadder(
    url: string,
    headers: Record<string, string>,
    ipoKey: string | undefined,
    source: string,
    attempts: FetchAttempt[],
    backoff: readonly number[] = BSE_RETRY_BACKOFF_MS
  ): Promise<HttpResponse> {
    let res: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url };
    for (let attempt = 0; attempt < backoff.length; attempt++) {
      const started = Date.now();
      res = await this.request(url, headers, ipoKey);
      const ms = Date.now() - started;
      if (res.status === 200) {
        if (attempt > 0) {
          attempts.push({
            source,
            http: 200,
            ms,
            outcome: `ok_after_retry:try${attempt + 1}of${backoff.length}`,
            url,
          });
        }
        return res;
      }
      attempts.push({
        source,
        http: res.status,
        ms,
        outcome: `${res.status === 0 ? 'timeout' : 'http_error'}:try${attempt + 1}of${backoff.length}`,
        url,
      });
      if (attempt < backoff.length - 1) await this.sleep(backoff[attempt]);
    }
    return res;
  }

  /** One counted request. Records the call before returning, success or not. */
  private async request(
    url: string,
    headers: Record<string, string>,
    ipoKey?: string,
    timeoutMs: number = FETCH_TIMEOUT_MS
  ): Promise<HttpResponse> {
    const started = Date.now();
    const res = await this.deps.fetcher(url, { headers, timeoutMs });
    this.deps.counter.record({
      host: hostOf(url),
      url,
      ipoKey,
      status: res.status,
      ms: Date.now() - started,
      bytes: res.body.length,
    });
    return res;
  }

  /**
   * The BSE board, fetched at most ONCE per cycle and cached.
   *
   * It is a whole-market payload, so fetching it per IPO would be N identical
   * requests. It is also fetched LAZILY — an all-SME or all-satisfied cycle
   * never touches it, which is what keeps "zero calls" actually zero.
   */
  private async getBoard(): Promise<BseBoardRow[] | null> {
    if (this.boardFetched) return this.boardCache;
    this.boardFetched = true;
    // N7: the board is a whole-market payload fetched once per cycle, so it is
    // attributed to a shared key rather than to whichever IPO happened to trigger
    // it — charging it to one IPO would misreport that IPO's per-cycle cost.
    // The board gets the SAME retry ladder as the core call. It was the one BSE
    // request still left un-retried, and a single transport failure there loses
    // the whole cycle's BSE coverage for every mainboard IPO at once — strictly
    // worse than losing one IPO's core payload. Observed live on 2026-08-28.
    const boardUrl = `${BSE_API_BASE}IPO_HomePageDetail/w`;
    const res = await this.requestWithLadder(
      boardUrl,
      BSE_HEADERS,
      '(shared:bse-board)',
      'BSE',
      this.boardAttempts,
      BSE_RETRY_BACKOFF_MS
    );
    if (res.status !== 200) {
      logger.warn({ status: res.status }, 'BSE board unavailable this cycle');
      this.boardCache = null;
      return null;
    }
    try {
      this.boardCache = parseBseBoard(JSON.parse(res.body.toString('utf8')));
    } catch (error) {
      // F18: a shape change is loud. We fall to NSE rather than write nothing.
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'BSE board SHAPE CHANGED — falling back to NSE for this cycle (P2)'
      );
      this.boardCache = null;
    }
    return this.boardCache;
  }

  /** BSE core payload for one IPO, or null when BSE cannot serve it. */
  private async fetchBseCore(
    ipo: DiscoveryIpo,
    attempts: FetchAttempt[]
  ): Promise<{ row: Record<string, unknown>; boardRow: BseBoardRow | null; ipoNo: number } | null> {
    // A remembered IPO_NO skips the board entirely — cheaper, and the ONLY way
    // to reach a closed IPO's core payload (the board has already forgotten it).
    let ipoNo = ipo.bseIpoNo ?? null;
    let boardRow: BseBoardRow | null = null;

    if (ipoNo === null) {
      const before = this.boardAttempts.length;
      const board = await this.getBoard();
      // F-1: replay the shared board's per-try lines onto this IPO's log, once.
      for (const a of this.boardAttempts.slice(before)) attempts.push(a);
      if (!board) {
        attempts.push({ source: 'BSE', http: 0, ms: 0, outcome: 'board_unavailable' });
        return null;
      }
      boardRow = resolveBseBoardRow(board, ipo.companyName);
      if (!boardRow) {
        // Two distinct causes, same shape: an SME issue is never on the
        // mainboard board (F13), and a mainboard issue leaves it once closed.
        // Neither is a source FAILURE — NSE is tried next.
        attempts.push({ source: 'BSE', http: 200, ms: 0, outcome: 'not_on_board' });
        return null;
      }
      ipoNo = boardRow.ipoNo;
    }

    const url = `${BSE_API_BASE}GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${ipoNo}`;
    const started = Date.now();
    const res = await this.requestWithLadder(
      url,
      BSE_HEADERS,
      ipo.id,
      'BSE',
      attempts,
      BSE_RETRY_BACKOFF_MS
    );
    if (res.status !== 200) {
      attempts.push({ source: 'BSE', http: res.status, ms: Date.now() - started, outcome: 'http_error', url });
      return null;
    }
    try {
      const row = extractBseCoreRow(JSON.parse(res.body.toString('utf8')));
      if (!row) {
        attempts.push({ source: 'BSE', http: 200, ms: Date.now() - started, outcome: 'no_detail_row', url });
        return null;
      }
      attempts.push({ source: 'BSE', http: 200, ms: Date.now() - started, outcome: 'ok', url });
      return { row, boardRow, ipoNo };
    } catch (error) {
      attempts.push({ source: 'BSE', http: 200, ms: Date.now() - started, outcome: 'shape_error', url });
      return null;
    }
  }

  /**
   * NSE issueInfo with three tries at 2/4/8 s.
   *
   * This retry IS the fix for the finding that started this work package: the
   * old code gave NSE one 15 s attempt and gave up, so two stalls meant Skyways
   * had no documents at all.
   */
  private async fetchNseIssueInfo(
    ipo: DiscoveryIpo,
    attempts: FetchAttempt[]
  ): Promise<Record<string, unknown> | null> {
    if (!ipo.symbol) {
      attempts.push({ source: 'NSE', http: 0, ms: 0, outcome: 'no_symbol' });
      return null;
    }
    const series = ipo.segment === 'SME' ? 'SME' : 'EQ';
    const url = `${NSE_IPO_DETAIL}?symbol=${encodeURIComponent(ipo.symbol)}&series=${series}`;

    for (let attempt = 0; attempt < NSE_RETRY_BACKOFF_MS.length; attempt++) {
      const started = Date.now();
      const res = await this.request(url, NSE_HEADERS, ipo.id);
      const ms = Date.now() - started;
      if (res.status === 200) {
        try {
          const payload = JSON.parse(res.body.toString('utf8'));
          attempts.push({ source: 'NSE', http: 200, ms, outcome: 'ok', url });
          return (payload?.issueInfo ?? null) as Record<string, unknown> | null;
        } catch {
          attempts.push({ source: 'NSE', http: 200, ms, outcome: 'shape_error', url });
          return null;
        }
      }
      attempts.push({
        source: 'NSE',
        http: res.status,
        ms,
        outcome: res.status === 0 ? 'timeout' : 'http_error',
        url,
      });
      if (attempt < NSE_RETRY_BACKOFF_MS.length - 1) {
        await this.sleep(NSE_RETRY_BACKOFF_MS[attempt]);
      }
    }
    return null;
  }

  /** Download + verify one discovered link. */
  private async fetchAndVerify(
    doc: DiscoveredDocument,
    ipo: DiscoveryIpo,
    attempts: FetchAttempt[],
    wantedType: DocumentType
  ): Promise<VerifyResult | null> {
    const url = encodeDocumentUrl(doc.url);
    // MIN-5: an exchange Referer belongs only on that exchange's own host.
    // Sending `Referer: nseindia.com` to SEBI or to an issuer's website is both
    // wrong and needlessly identifying; those hosts get neutral browser headers.
    const headers =
      doc.source === 'BSE' ? BSE_HEADERS : doc.source === 'NSE' ? NSE_HEADERS : BROWSER_PAGE_HEADERS;
    const started = Date.now();
    const res = await this.request(url, { ...headers, Accept: '*/*' }, ipo.id, DOWNLOAD_TIMEOUT_MS);
    // Two passes, deliberately. The cover check needs the UNWRAPPED pdf, which
    // only the first pass can produce (the download may be a zip). Pass 1 does
    // every byte-level rule; if it succeeds we extract page 1 and re-run the
    // cheap checks with the cover text so the company check can actually fire.
    // The first cut passed `expectedCompanyName` with no extractor at all, so
    // step 4 silently never ran and F8 was unguarded in production.
    const firstPass = verifyDownload(
      res.body,
      { status: res.status, contentType: res.contentType, url: res.url },
      { wantedType }
    );

    let verdict = firstPass;
    if (!isVerifyFailure(firstPass)) {
      const extract = this.deps.extractCoverText ?? extractCoverTextFromPdf;
      const cover = await extract(firstPass.pdf);
      // A structural parse failure is a REJECT, not a skip (G1) — see
      // VerifyOptions.coverExtractFailed.
      const coverExtractFailed =
        !cover.usable && (cover as { reason?: string }).reason === 'extract_failed';
      verdict = verifyDownload(
        res.body,
        { status: res.status, contentType: res.contentType, url: res.url },
        {
          wantedType,
          expectedCompanyName: ipo.companyName,
          coverText: cover.usable ? cover.text : undefined,
          coverExtractFailed,
        }
      );
    }
    // if/else rather than a ternary: this workspace compiles with `strict: false`
    // (see shared-package-build.md — the asymmetry is deliberate), and without
    // strictNullChecks the boolean discriminant does not narrow inside a
    // conditional expression. `reason` exists only on the failure arm and
    // `zipMember` only on the success arm.
    let outcome: string;
    if (isVerifyFailure(verdict)) {
      outcome = `rejected:${verdict.reason}`;
    } else {
      // Both facts belong in the log: WHICH zip member was chosen (the
      // multi-member defect) and WHETHER the cover check ran (the silently-off
      // defect). A skip that reads like a pass is how M1 stayed hidden.
      const parts = [
        verdict.zipMember ? `zip member: ${verdict.zipMember}` : null,
        verdict.memberTypeMismatch ? `member classifies as: ${verdict.memberTypeMismatch}` : null,
        `cover_check: ${verdict.coverCheck}`,
      ].filter(Boolean);
      outcome = `downloaded (${parts.join('; ')})`;
    }
    attempts.push({
      source: doc.source,
      http: res.status,
      ms: Date.now() - started,
      outcome,
      url,
      // Full hash, not the 8-char filename prefix: it is what proves two
      // sources served identical bytes, and what a document can be looked up by.
      ...(isVerifyFailure(verdict) ? {} : { sha256: verdict.sha256 }),
    });
    return verdict;
  }

  /**
   * Download one candidate, verify it, store it, and record the `documents` row.
   * Returns null when the candidate did not survive verification or storage.
   *
   * Shared by all four rungs, so a document fetched from SEBI or a company host
   * goes through the SAME verification, sha-dedup and storage as an exchange one
   * — a rung that stored files by its own rules would be a hole in §3.
   */
  private async tryStoreCandidate(
    candidate: DiscoveredDocument,
    ipo: DiscoveryIpo,
    docType: DocumentType,
    attempts: FetchAttempt[],
    seenBySha: Map<string, { documentId: string; docType: DocumentType }>
  ): Promise<{ documentId: string; bytes: number } | null> {
    const verdict = await this.fetchAndVerify(candidate, ipo, attempts, docType);
    if (!verdict || isVerifyFailure(verdict)) return null;

    const alias = seenBySha.get(verdict.sha256);
    if (alias) {
      attempts.push({
        source: candidate.source,
        http: 200,
        ms: 0,
        outcome: `deduped_by_sha256_to:${alias.docType}`,
        url: candidate.url,
        sha256: verdict.sha256,
      });
      return { documentId: alias.documentId, bytes: verdict.bytes };
    }

    const stored = await storeDocument({
      ipoId: ipo.id,
      docType,
      pdf: verdict.pdf,
      sha256: verdict.sha256,
      storeDir: this.deps.storeDir ?? getStoreDir(),
    });
    if (!stored.stored) {
      attempts.push({
        source: candidate.source,
        http: 200,
        ms: 0,
        outcome: 'store_full',
        url: candidate.url,
        sha256: verdict.sha256,
      });
      return null;
    }

    const doc = await this.deps.documents.upsertDocument({
      ipoId: ipo.id,
      type: docType,
      title: candidate.title,
      url: candidate.url,
      exchange: candidate.source,
      mediaType: 'PDF',
      extractionStatus: 'PENDING',
      isActive: true,
      fileSize: verdict.bytes,
      sha256: verdict.sha256,
    });
    seenBySha.set(verdict.sha256, { documentId: doc.id, docType });

    // G2: the issuer's website is printed on the filing cover. Capturing it here
    // means the company-host rung costs nothing extra to become usable for the
    // NEXT document this IPO needs.
    if (!this.companyUrlByIpo.has(ipo.id)) {
      const cover = await (this.deps.extractCoverText ?? extractCoverTextFromPdf)(verdict.pdf);
      const site = cover.usable ? extractWebsiteFromCoverText(cover.text ?? '') : null;
      if (site) this.companyUrlByIpo.set(ipo.id, site);
    }

    logger.info({ ipoId: ipo.id, docType, bytes: verdict.bytes }, 'Document FOUND and stored');
    return { documentId: doc.id, bytes: verdict.bytes };
  }

  /**
   * Rungs 3 and 4 of the decision tree, plus the verifier (G1/G2/G4).
   *
   * Order is the matrix's: SEBI, then the issuer's own host, then Chittorgarh as
   * a link verifier only. Every rung appends to `rungs` even when it does
   * nothing, with the reason — that record is what lets BLOCKED_ALL mean "all
   * four were consulted" rather than "we stopped early".
   */
  private async escalateBeyondExchanges(
    ipo: DiscoveryIpo,
    docType: DocumentType,
    attempts: FetchAttempt[],
    rungs: string[],
    triedUrls: Set<string>,
    seenBySha: Map<string, { documentId: string; docType: DocumentType }>
  ): Promise<RungOutcome | null> {
    // H-2: 'a rung could not answer' is tracked separately from 'a rung
    // answered and this filing is not there'. Any failure makes the whole
    // escalation `failed`, which is what puts the row in BLOCKED_ALL with its
    // retry ladder instead of the silent, un-retried NOT_YET_FILED.
    let anyRungFailed = false;
    // The answer a later `absent` would be built from. Null at the end means no
    // rung could be consulted at all: nothing was learned, so the exchanges'
    // verdict stands unchanged. That is deliberately NOT `absent` - the absent
    // arm is a claim, and a claim needs the response that supports it.
    let lastAnswer: AnsweredResponse | null = null;

    // ---- Rung 3: SEBI ----------------------------------------------------
    const listingUrl = sebiListingUrlFor(docType);
    if (!listingUrl) {
      rungs.push('SEBI:skipped:not_served_by_sebi');
    } else {
      const sebi = await this.trySebi(ipo, docType, listingUrl, attempts, rungs, triedUrls, seenBySha);
      if (isRungFound(sebi)) return sebi;
      if (sebi.kind === 'failed') anyRungFailed = true;
      else lastAnswer = sebi.evidence;
    }

    // ---- Rung 4: the issuer's investor page -------------------------------
    const companyUrl =
      normalizeCompanyUrl(ipo.companyWebsite) ?? this.companyUrlByIpo.get(ipo.id) ?? null;
    if (!companyUrl) {
      rungs.push('COMPANY:skipped:no_company_url');
    } else {
      const company = await this.tryCompanyHost(ipo, docType, companyUrl, attempts, rungs, triedUrls, seenBySha);
      if (isRungFound(company)) return company;
      if (company.kind === 'failed') anyRungFailed = true;
      else lastAnswer = company.evidence;
    }

    // ---- Verifier: Chittorgarh (links only, never a source) ---------------
    //
    // r5 (3): the host is re-validated HERE, on the READ, not only in
    // `recordDocumentSourceHints` on the write. The column is reachable by a
    // backfill, an admin edit or any future scraper, and this rung fetches
    // whatever it finds there.
    if (!isVerifierUrl(ipo.verifierUrl)) {
      rungs.push(
        ipo.verifierUrl ? 'VERIFIER:skipped:invalid_verifier_url' : 'VERIFIER:skipped:no_verifier_url'
      );
    } else {
      const verifier = await this.tryVerifier(ipo, docType, attempts, rungs, triedUrls, seenBySha);
      if (isRungFound(verifier)) return verifier;
      if (verifier.kind === 'failed') anyRungFailed = true;
      else lastAnswer = verifier.evidence;
    }

    if (anyRungFailed) return failed('an escalation rung could not answer');
    return lastAnswer ? absent(lastAnswer) : null;
  }

  /**
   * Spend one escalation GET from this IPO's per-cycle budget (M-d).
   * Returns false when the budget is exhausted; the caller records the reason.
   */
  private spendEscalationGet(ipoId: string): boolean {
    const budget = this.deps.escalationBudget ?? ESCALATION_GET_BUDGET_PER_IPO;
    const spent = this.escalationGets.get(ipoId) ?? 0;
    if (spent >= budget) return false;
    this.escalationGets.set(ipoId, spent + 1);
    return true;
  }

  /** Rung 3. Listing (cached per cycle) to row match to detail page to PDF. */
  private async trySebi(
    ipo: DiscoveryIpo,
    docType: DocumentType,
    listingUrl: string,
    attempts: FetchAttempt[],
    rungs: string[],
    triedUrls: Set<string>,
    seenBySha: Map<string, { documentId: string; docType: DocumentType }>
  ): Promise<RungOutcome> {
    const cached = this.sebiListings.get(listingUrl);
    // H-3: a cached FAILURE is reported as a failure, for every IPO in the
    // cycle. It is still cached — one 503 should not become one request per IPO
    // — but the later IPOs now say what actually happened.
    if (cached === 'failed') {
      rungs.push('SEBI:failed:cached_http_error');
      return failed('cached SEBI listing http error');
    }
    let rows = cached ? cached.rows : undefined;
    let listingEvidence: AnsweredResponse | null = cached ? cached.evidence : null;
    if (rows === undefined) {
      if (!this.spendEscalationGet(ipo.id)) {
        // r5, Class 1: a request we DECLINED to make says nothing about whether
        // the company filed. This used to return 'absent' - i.e. NOT_YET_FILED
        // written from a budget counter.
        rungs.push('SEBI:failed:budget');
        return failed('escalation budget exhausted before the SEBI listing');
      }
      const started = Date.now();
      const res = await this.request(listingUrl, SEBI_HEADERS, ipo.id);
      if (res.status !== 200) {
        attempts.push({
          source: 'SEBI',
          http: res.status,
          ms: Date.now() - started,
          outcome: 'http_error',
          url: listingUrl,
        });
        rungs.push('SEBI:failed:http_error');
        this.sebiListings.set(listingUrl, 'failed');
        return failed('SEBI listing http ' + res.status);
      }
      rows = parseSebiListing(res.body.toString('utf8'));
      listingEvidence = answeredFrom(res, listingUrl);
      if (listingEvidence) this.sebiListings.set(listingUrl, { rows, evidence: listingEvidence });
      attempts.push({
        source: 'SEBI',
        http: 200,
        ms: Date.now() - started,
        outcome: `listing_rows:${rows.length}`,
        url: listingUrl,
      });
    }

    const row = matchSebiRow(rows, ipo.companyName, docType);
    if (!row) {
      // The listing ANSWERED and does not name this company: real evidence, and
      // the 200 that carries it is what the absent arm is built from.
      if (!listingEvidence) {
        rungs.push('SEBI:failed:listing_without_evidence');
        return failed('SEBI listing parsed without a 200 behind it');
      }
      rungs.push('SEBI:not_listed');
      return absent(listingEvidence);
    }

    if (!this.spendEscalationGet(ipo.id)) {
      rungs.push('SEBI:failed:budget');
      return failed('escalation budget exhausted before the SEBI detail page');
    }
    const detailStarted = Date.now();
    const detail = await this.request(row.detailUrl, SEBI_HEADERS, ipo.id);
    if (detail.status !== 200) {
      attempts.push({
        source: 'SEBI',
        http: detail.status,
        ms: Date.now() - detailStarted,
        outcome: 'detail_http_error',
        url: row.detailUrl,
      });
      rungs.push('SEBI:failed:detail_http_error');
      return failed('SEBI detail http ' + detail.status);
    }

    const pdfUrl = parseSebiDetailPdfUrl(detail.body.toString('utf8'));
    if (!pdfUrl) {
      attempts.push({
        source: 'SEBI',
        http: 200,
        ms: Date.now() - detailStarted,
        outcome: 'no_pdf_on_detail_page',
        url: row.detailUrl,
      });
      // SEBI listed the filing and its detail page carried no PDF: the page
      // answered, so this is a failure of the SOURCE, not evidence of absence.
      rungs.push('SEBI:failed:no_pdf_on_detail_page');
      return failed('SEBI listed the filing and its detail page carried no PDF');
    }

    if (triedUrls.has(pdfUrl)) {
      // An earlier rung already tried this exact URL and did not return FOUND,
      // so it failed. SEBI naming the same URL is not evidence that the filing
      // does not exist - it is evidence that it does.
      rungs.push('SEBI:failed:already_tried');
      return failed('SEBI names a URL an earlier rung already failed to fetch');
    }
    triedUrls.add(pdfUrl);

    const stored = await this.tryStoreCandidate(
      { type: docType, url: pdfUrl, source: 'SEBI', title: row.title },
      ipo,
      docType,
      attempts,
      seenBySha
    );
    rungs.push(stored ? 'SEBI:found' : 'SEBI:failed:rejected');
    // A listed filing whose download or verification failed is a failure, not
    // an absence — it exists, we could not get it.
    return stored
      ? { kind: 'found', documentId: stored.documentId, bytes: stored.bytes }
      : failed('SEBI PDF download or verification failed');
  }

  /**
   * One investor page, fetched at most once per CYCLE (M-d).
   *
   * The rung runs per document type but the pages are per issuer, so the
   * un-cached version fetched the same URL once per due type — four GETs of one
   * investor page in the 2026-08-28 run, and up to 27 for an IPO with nine due
   * types. The cache also means a 404 is learned once.
   */
  private async fetchCompanyPage(
    ipo: DiscoveryIpo,
    pageUrl: string,
    attempts: FetchAttempt[]
  ): Promise<{ status: number; html: string; evidence: AnsweredResponse | null } | 'budget'> {
    const cached = this.companyPages.get(pageUrl);
    if (cached) return cached;
    if (!this.spendEscalationGet(ipo.id)) return 'budget';

    const started = Date.now();
    const res = await this.request(pageUrl, BROWSER_PAGE_HEADERS, ipo.id);
    const page = {
      status: res.status,
      html: res.status === 200 ? res.body.toString('utf8') : '',
      // The page's own proof that it answered, cached with it: a later type
      // reading this cache must be able to build `absent` from the SAME 200
      // that the first type saw, not from the fact that a map has a key.
      evidence: answeredFrom(res, pageUrl),
    };
    this.companyPages.set(pageUrl, page);
    if (res.status !== 200) {
      attempts.push({
        source: 'COMPANY',
        http: res.status,
        ms: Date.now() - started,
        outcome: 'http_error',
        url: pageUrl,
      });
    }
    return page;
  }

  /** Rung 4. At most three page GETs per issuer per CYCLE (R12 + M-d). */
  private async tryCompanyHost(
    ipo: DiscoveryIpo,
    docType: DocumentType,
    companyUrl: string,
    attempts: FetchAttempt[],
    rungs: string[],
    triedUrls: Set<string>,
    seenBySha: Map<string, { documentId: string; docType: DocumentType }>
  ): Promise<RungOutcome> {
    let anyPageFailed = false;
    let answer: AnsweredResponse | null = null;
    for (const pageUrl of companyInvestorUrls(companyUrl)) {
      const started = Date.now();
      const page = await this.fetchCompanyPage(ipo, pageUrl, attempts);
      if (page === 'budget') {
        // r5, Class 1: the remaining pages were never requested. Whatever the
        // pages we DID read said, we do not know what the unread ones carry, so
        // this rung cannot conclude the filing is absent.
        rungs.push('COMPANY:failed:budget');
        return failed('escalation budget exhausted before an investor page');
      }
      if (page.status !== 200) {
        // r5 (6): only a MISSING path is evidence. Most issuers simply do not
        // have `/investor-relations`, so 404/410 is normal and says the page is
        // not there. Everything else — 403, 429, 5xx, a transport failure — is
        // the server declining to tell us anything, which is not evidence of
        // anything either way.
        if (page.status !== 404 && page.status !== 410) anyPageFailed = true;
        continue;
      }
      if (page.evidence) answer = page.evidence;

      const links = parseCompanyHostLinks(page.html, pageUrl).filter(
        (l) =>
          l.docType === docType &&
          !triedUrls.has(l.url) &&
          // MIN-6: never store a filing a third party happens to host. An
          // investor page routinely links documents parked on a CDN or a
          // merchant bank; the owner's rule is issuer-or-exchange only, and it
          // applies on THIS rung too.
          isStorableFromCompanyPage(l.url, companyUrl)
      );
      attempts.push({
        source: 'COMPANY',
        http: 200,
        ms: Date.now() - started,
        outcome: `links:${links.length}`,
        url: pageUrl,
      });

      for (const link of links) {
        triedUrls.add(link.url);
        const stored = await this.tryStoreCandidate(
          { type: docType, url: link.url, source: 'COMPANY', title: link.text },
          ipo,
          docType,
          attempts,
          seenBySha
        );
        if (stored) {
          rungs.push('COMPANY:found');
          return { kind: 'found', documentId: stored.documentId, bytes: stored.bytes };
        }
        // The page linked this filing and the download failed: it exists.
        anyPageFailed = true;
      }
    }
    // H-2: three outcomes, three labels, because they are three different
    // facts and only two of them are failures:
    //   a link we could not download        -> failed  (the filing exists)
    //   no investor page answered at all    -> failed  (we learned nothing)
    //   a page answered and does not carry it -> absent (real evidence)
    if (anyPageFailed) {
      rungs.push('COMPANY:failed:no_usable_link');
      return failed('an investor page failed, or a linked filing would not download');
    }
    if (!answer) {
      rungs.push('COMPANY:failed:no_page');
      return failed('no investor page answered');
    }
    rungs.push('COMPANY:no_link');
    return absent(answer);
  }

  /**
   * The verifier. Reads the links Chittorgarh displays and follows one ONLY when
   * it points at an exchange or SEBI and we have not tried that exact URL. A
   * document is never stored from Chittorgarh's own host (owner rule) — that
   * filter lives in `extractVerifierLinks`, so no code here has to remember it.
   */
  private async tryVerifier(
    ipo: DiscoveryIpo,
    docType: DocumentType,
    attempts: FetchAttempt[],
    rungs: string[],
    triedUrls: Set<string>,
    seenBySha: Map<string, { documentId: string; docType: DocumentType }>
  ): Promise<RungOutcome> {
    const verifierUrl = ipo.verifierUrl as string;
    // Defence in depth: the caller filters on `isVerifierUrl` too. This rung is
    // the one that puts a stored URL on the wire, so it re-checks at the point
    // of use rather than trusting a guard three frames up.
    if (!isVerifierUrl(verifierUrl)) {
      rungs.push('VERIFIER:skipped:invalid_verifier_url');
      return failed('verifier_url is not an https chittorgarh.com URL');
    }

    // r5 (2): the page is per IPO but this rung runs per DOCUMENT TYPE, so the
    // un-cached version spent one escalation GET per due type on one URL — the
    // same defect M-d fixed for the company rung, left standing on this one.
    let page = this.verifierPages.get(verifierUrl);
    if (!page) {
      if (!this.spendEscalationGet(ipo.id)) {
        // r5, Class 1: the verifier page was never fetched.
        rungs.push('VERIFIER:failed:budget');
        return failed('escalation budget exhausted before the verifier page');
      }
      const started = Date.now();
      const res = await this.request(verifierUrl, BROWSER_PAGE_HEADERS, ipo.id);
      page = {
        status: res.status,
        html: res.status === 200 ? res.body.toString('utf8') : '',
        evidence: answeredFrom(res, verifierUrl),
      };
      this.verifierPages.set(verifierUrl, page);
      if (res.status !== 200) {
        attempts.push({
          source: 'VERIFIER',
          http: res.status,
          ms: Date.now() - started,
          outcome: 'http_error',
          url: verifierUrl,
        });
      }
    }
    if (page.status !== 200 || !page.evidence) {
      rungs.push('VERIFIER:failed:http_error');
      return failed('verifier page http ' + page.status);
    }
    const answer = page.evidence;

    const links = extractVerifierLinks(page.html, verifierUrl, triedUrls).filter(
      (l) => l.docType === docType
    );
    attempts.push({
      source: 'VERIFIER',
      http: 200,
      ms: 0,
      outcome: `untried_exchange_links:${links.length}`,
      url: verifierUrl,
    });

    let anyLinkFailed = false;
    for (const link of links) {
      triedUrls.add(link.url);
      const source = sourceOfDocumentUrl(link.url);
      const stored = await this.tryStoreCandidate(
        { type: docType, url: link.url, source, title: link.text },
        ipo,
        docType,
        attempts,
        seenBySha
      );
      if (stored) {
        rungs.push('VERIFIER:found_via_corrected_link');
        return { kind: 'found', documentId: stored.documentId, bytes: stored.bytes };
      }
      // The verifier pointed at an exchange URL and that download failed. The
      // filing exists; we could not fetch it.
      anyLinkFailed = true;
    }
    rungs.push(anyLinkFailed ? 'VERIFIER:failed:corrected_link_failed' : 'VERIFIER:no_new_link');
    return anyLinkFailed
      ? failed('the verifier pointed at an exchange URL that would not download')
      : absent(answer);
  }

  /**
   * Run one cycle for one IPO.
   *
   * The order here is the whole point: the PLAN is computed before any network
   * dependency is touched, so `skipIpo` short-circuits with zero requests.
   */
  async runIpo(ipo: DiscoveryIpo, existingRows: StateRow[]): Promise<IpoRunResult> {
    const now = this.now();
    const callsBefore = this.deps.counter.count(ipo.id);
    const attempts: FetchAttempt[] = [];

    const plan = planIpoCycle({
      stage: ipo.stage,
      rows: existingRows,
      issue: ipo.issue,
      options: { ...this.deps.cycleOptions, now },
    });

    const result: IpoRunResult = {
      ipoId: ipo.id,
      companyName: ipo.companyName,
      stage: ipo.stage,
      skipped: plan.skipIpo,
      skipReason: plan.reason,
      due: plan.due,
      found: [],
      notYetFiled: [],
      blocked: [],
      notApplicable: plan.toMarkNotApplicable,
      superseded: plan.toMarkSuperseded,
      leadManagers: [],
      attempts,
      networkCalls: 0,
    };

    // R9: record the impossible types once. No network needed.
    for (const docType of plan.toMarkNotApplicable) {
      const row = await this.deps.store.ensureRow(ipo.id, docType);
      await this.deps.store.update(row.id, { state: 'NOT_APPLICABLE', nextRetryAt: null });
    }

    // F-3: close the hunt for drafts a later filing has replaced. Also no
    // network, and it clears any BLOCKED_ALL that was alerting nightly about a
    // document nobody needs any more.
    for (const docType of plan.toMarkSuperseded) {
      const row = await this.deps.store.ensureRow(ipo.id, docType);
      await this.deps.store.update(row.id, {
        state: 'SUPERSEDED',
        nextRetryAt: null,
        blockedSinceAt: null,
      });
    }

    if (plan.skipIpo) {
      logger.debug({ ipoId: ipo.id, company: ipo.companyName }, plan.reason);
      result.networkCalls = this.deps.counter.count(ipo.id) - callsBefore;
      return result;
    }

    /**
     * sha256 -> the document row already stored for it THIS run (matrix E7/R2:
     * 'same hash from BSE and NSE = one row, two URLs').
     *
     * Not hypothetical. Verified live 2026-08-28: Skyways' BSE
     * `PriceBandAdvertisementSkyways.pdf` and NSE's `RATIOS_SKYWAYS.zip` are
     * byte-identical (6,585,368 bytes, same sha256) — in India the price-band
     * advertisement IS the document carrying the basis of issue price, and the
     * two exchanges publish it under different labels. Without this index we
     * store the same 6.5 MB twice and create two documents rows for one filing.
     */
    const seenBySha = new Map<string, { documentId: string; docType: DocumentType }>();

    // ONE exchange call set covers EVERY due type (§7.2).
    // EVERY candidate link per type, in source-preference order — not just the
    // first. Matrix F2: 'BSE API up, link present, download fails -> try the NSE
    // archive copy'. Keeping only the first link made that impossible, and the
    // acceptance run caught exactly that: Skyways' BSE RHP download timed out and
    // the NSE RHP zip, already discovered in the same cycle, was never tried.
    const discovered = new Map<DocumentType, DiscoveredDocument[]>();
    const isSme = ipo.segment === 'SME';

    const takeAll = (docs: DiscoveredDocument[]) => {
      for (const doc of docs) {
        const list = discovered.get(doc.type);
        if (list) {
          // Same URL twice is not a second candidate.
          if (!list.some((d) => d.url === doc.url)) list.push(doc);
        } else {
          discovered.set(doc.type, [doc]);
        }
      }
    };

    /** True when every due type now has at least one candidate link. */
    const allDueCovered = () => plan.due.every((t) => (discovered.get(t)?.length ?? 0) > 0);

    // Nothing to FETCH is not the same as nothing to DO. A cycle whose only
    // work is bookkeeping — marking a superseded draft or a not-applicable type
    // — has already done it above, and must not then go and ask an exchange
    // about documents it is not looking for. Caught by the acceptance run: the
    // cycle after an RHP was found still made a BSE call for an IPO with an
    // empty due list.
    if (plan.due.length === 0) {
      result.networkCalls = this.deps.counter.count(ipo.id) - callsBefore;
      return result;
    }

    if (!isSme) {
      const bse = await this.fetchBseCore(ipo, attempts);
      if (bse) {
        takeAll(parseBSEDocuments(bse.row));
        result.leadManagers = parseBseParties(bse.row as never).leadManagers;
        if (result.leadManagers.length > 0) result.leadManagerSource = 'BSE';
        if (ipo.bseIpoNo == null) result.resolvedBseIpoNo = bse.ipoNo;
        if (bse.boardRow?.isFixedPrice) ipo.issue = { ...ipo.issue, isFixedPrice: true };
      }
    }

    // NSE second for mainboard, FIRST-and-only-exchange for SME.
    //
    // Idempotent, and callable again LATER in this cycle. The first cut fetched
    // NSE only when BSE had left a due type without a link, which meant that if
    // BSE supplied every link and one of those downloads then failed, the NSE
    // copy was never consulted and the type went BLOCKED_ALL — the F2 rule says
    // to try the other exchange's copy. The download loop below calls this on
    // demand for exactly that case.
    let nseConsulted = false;
    const ensureNseCandidates = async (): Promise<boolean> => {
      if (nseConsulted) return false;
      nseConsulted = true;
      const issueInfo = await this.fetchNseIssueInfo(ipo, attempts);
      if (!issueInfo) return false;
      takeAll(parseNSEDocuments(issueInfo, ipo.symbol ?? ''));
      // F-2: BSE is the preferred source for parties, but "preferred" must not
      // mean "only". When BSE could not answer, NSE's payload is already in
      // memory and lists the same book running lead managers — discarding them
      // because a different source was down is a self-inflicted data loss.
      if (result.leadManagers.length === 0) {
        const fromNse = parseNseLeadManagers(issueInfo);
        if (fromNse.length > 0) {
          result.leadManagers = fromNse;
          result.leadManagerSource = 'NSE';
        }
      }
      return true;
    };

    if (!allDueCovered()) await ensureNseCandidates();

    // F3 vs F6, and the distinction is NOT 'did any exchange answer'.
    //
    // The 2026-08-28 re-run made the difference concrete: BSE timed out for
    // Skyways while NSE answered, and every BSE-ONLY type (price-band ad,
    // corrigendum, addendum) was recorded as NOT_YET_FILED — i.e. 'the company
    // has not filed it', which we had no evidence for and which suppresses the
    // retry ladder and the alert. A type may only be called NOT_YET_FILED when
    // EVERY exchange we consulted actually answered; if any consulted exchange
    // failed, the honest state is BLOCKED_ALL.
    const consulted = attempts.filter((a) => a.source === 'BSE' || a.source === 'NSE');
    // `not_on_board` / `no_symbol` are NOT failures: they mean this exchange does
    // not carry this issue at all (F13 — the mainboard board never lists SME).
    // Only a source that was asked and could not answer counts against us.
    const anyExchangeFailed = consulted.some((a) => EXCHANGE_FAILURE_OUTCOMES.includes(a.outcome));
    const exchangesAnswered = consulted.some((a) => a.outcome === 'ok') && !anyExchangeFailed;

    // B-1: did every exchange APPLICABLE to this IPO actually cover it?
    //
    // `exchangesAnswered` above only asks "did someone answer and nobody fail".
    // That is too weak to settle a type as "not filed yet": a mainboard IPO that
    // has dropped off the BSE board reports `not_on_board` — not a failure, but
    // BSE plainly did not cover it — and NSE answering alone must not be taken
    // as proof that a Prospectus does not exist. Same for an IPO with no NSE
    // symbol. Coverage is complete only when each applicable exchange said 'ok'.
    const bseApplicable = !isSme;
    const nseApplicable = Boolean(ipo.symbol);
    const bseOk = consulted.some((a) => a.source === 'BSE' && a.outcome === 'ok');
    const nseOk = consulted.some((a) => a.source === 'NSE' && a.outcome === 'ok');
    const exchangeCoverageComplete = (!bseApplicable || bseOk) && (!nseApplicable || nseOk);

    for (const docType of plan.due) {
      const stateRow = await this.deps.store.ensureRow(ipo.id, docType);
      const prior: StateRow =
        existingRows.find((r) => r.docType === docType) ??
        toStateRow(stateRow);

      const candidates = discovered.get(docType) ?? [];
      // r6 (Class 1, 4th instance): NOT a mutable `outcome`. The two verdicts
      // below are the raw FACTS each stage established; the single
      // `resolveFinalOutcome` call at the end derives the outcome from them.
      // The bug this replaces was a `no_link` assigned here and never
      // overwritten, which the write then read as "the company has not filed it".
      let exchanges: ExchangeVerdict;
      let escalation: EscalationVerdict = null;
      let documentId: string | null = null;
      let bytes: number | undefined;

      // G4: every rung tried for THIS type, in order, with its outcome. A rung
      // that was not applicable is recorded with an explicit reason rather than
      // omitted -- the state may not become BLOCKED_ALL until all four have an
      // entry, so silence is not an acceptable substitute for "we skipped it".
      const rungs: string[] = [];
      const triedUrls = new Set<string>();

      if (candidates.length === 0) {
        // Two very different facts, recorded distinctly: the exchanges ANSWERED
        // and had no link (the filing does not exist yet), versus the exchanges
        // could not be reached at all. Collapsing them into one label is the
        // same conflation F3-vs-F6 exists to prevent.
        rungs.push(exchangesAnswered ? 'EXCHANGES:no_link' : 'EXCHANGES:failed');
        // F3 vs F6: only when EVERY consulted exchange answered may the chain
        // even consider saying the filing does not exist yet.
        exchanges = exchangesAnswered ? 'no_link' : 'failed';
      } else if (this.deps.skipDownload) {
        rungs.push('EXCHANGES:found');
        exchanges = 'found';
      } else {
        // Default to failure and let a successful store overwrite it. This
        // initialiser is load-bearing: without it `exchanges` stays undefined
        // when every candidate is rejected, and the resolver's exhaustive match
        // then falls through. `strict: false` does not catch that.
        exchanges = 'failed';

        // A separate flag rather than comparing `exchanges`: assigning a literal
        // narrows its type, so `exchanges !== 'found'` is a compile error in this
        // workspace. The flag says the same thing without fighting it.
        let stored: { documentId: string; bytes: number } | null = null;
        const attemptCandidates = async (list: DiscoveredDocument[]): Promise<void> => {
          for (const candidate of list) {
            if (triedUrls.has(candidate.url)) continue;
            triedUrls.add(candidate.url);
            const attempt = await this.tryStoreCandidate(
              candidate,
              ipo,
              docType,
              attempts,
              seenBySha
            );
            if (!attempt) continue;
            stored = attempt;
            return;
          }
        };

        await attemptCandidates(candidates);

        // F2 rescue: everything we had failed and NSE has not been asked yet
        // (BSE covered every due type, so the cheap path skipped it).
        if (!stored && !nseConsulted && !isSme) {
          const gained = await ensureNseCandidates();
          if (gained) await attemptCandidates(discovered.get(docType) ?? []);
        }

        if (stored) {
          documentId = stored.documentId;
          bytes = stored.bytes;
          exchanges = 'found';
        }
        rungs.push(stored ? 'EXCHANGES:found' : 'EXCHANGES:failed');
      }

      // B-1: may the exchanges' answer SETTLE this type?
      //
      // Only when they can serve it at all (never the DRHP) AND every applicable
      // exchange actually covered this IPO. Otherwise a clean `no_link` is not
      // evidence of anything and the later rungs must still be consulted —
      // which is the whole point of having them.
      const settledByExchanges =
        isExchangeServedType(docType) && exchangeCoverageComplete;
      const needsEscalation =
        exchanges === 'failed' || (exchanges === 'no_link' && !settledByExchanges);

      // Rungs 3 and 4 (G1/G2). Reached when the exchanges failed, or when they
      // answered but cannot settle this type (a DRHP, or an IPO one of them no
      // longer lists).
      if (needsEscalation && !this.deps.skipDownload) {
        const escalated = await this.escalateBeyondExchanges(
          ipo,
          docType,
          attempts,
          rungs,
          triedUrls,
          seenBySha
        );
        // r6: the chain's verdict is RECORDED, including its `null` — "no rung
        // could be consulted". The old code acted on `found`/`failed` only, so
        // `null` left the earlier `outcome` standing and an unsettled `no_link`
        // was written as NOT_YET_FILED. `resolveFinalOutcome` now decides what
        // each verdict means, `null` included.
        if (escalated && isRungFound(escalated)) {
          documentId = escalated.documentId;
          bytes = escalated.bytes;
          escalation = 'found';
        } else if (escalated) {
          escalation = escalated.kind;
        }
      } else if (needsEscalation) {
        // Downloads are disabled for this run (call-counting / dry mode), so no
        // rung could produce a file. Recorded explicitly rather than left empty:
        // the G4 guard below asserts four entries, and an unrecorded skip would
        // make it fire and mask a genuine BLOCKED_ALL.
        rungs.push('SEBI:skipped:download_disabled');
        rungs.push('COMPANY:skipped:download_disabled');
        rungs.push('VERIFIER:skipped:download_disabled');
      } else {
        // The exchanges settled it (found, or an honest "not filed yet"), so the
        // later rungs are not consulted — and that is recorded, not implied.
        rungs.push('SEBI:skipped:exchanges_settled_it');
        rungs.push('COMPANY:skipped:exchanges_settled_it');
        rungs.push('VERIFIER:skipped:exchanges_settled_it');
      }

      // F-4: this type's chain line, kept as a reference so the per-row filter
      // below can keep THIS one and drop the other types'. Without the identity
      // check, `!a.url` matched every CHAIN entry in the cycle and each row's
      // last_attempt carried the rung chains of every other document type.
      const chainAttempt: FetchAttempt = {
        source: 'CHAIN',
        http: 0,
        ms: 0,
        outcome: `rungs[${docType}]: ${rungs.join(' -> ')}`,
      };
      attempts.push(chainAttempt);

      // r6: ONE derivation, at the end, from the facts each stage established.
      // There is no longer a variable that can carry a stale claim to the write.
      let outcome: AttemptOutcome = resolveFinalOutcome(exchanges, settledByExchanges, escalation);

      // G4 guard: BLOCKED_ALL asserts that every rung was consulted. If the
      // chain somehow ran short, that is a bug in the chain, not evidence that
      // the document is unreachable -- so it is logged loudly and the row is
      // left retryable rather than being marked blocked on incomplete evidence.
      if (outcome === 'all_sources_failed' && rungs.length < 4) {
        logger.error(
          { ipoId: ipo.id, docType, rungs },
          'Refusing BLOCKED_ALL: fewer than four rungs were consulted (G4)'
        );
        // r5 (4): this used to downgrade to `no_link`, i.e. NOT_YET_FILED — the
        // row settled as "the company has not filed it" on the strength of a
        // chain that did not finish. `chain_incomplete` says the one true thing:
        // we do not know, so stay WANTED and come back.
        outcome = 'chain_incomplete';
      }

      const transition = applyOutcome(prior, outcome, now);
      const patch: DocumentFetchStatePatch = {
        state: transition.state,
        nextRetryAt: transition.nextRetryAt,
        blockedSinceAt: transition.blockedSinceAt,
        attempts: (stateRow.attempts ?? 0) + 1,
        lastAttemptAt: now,
        // Only the attempts that concern THIS document type, plus the shared
        // exchange calls (N8 — storing the whole cycle's log on every row grew
        // with the number of due types and buried the relevant lines).
        //
        // M-3: filtered against `triedUrls`, which every rung adds to, NOT
        // against the exchange `candidates` list. The old filter kept only
        // exchange URLs, so every SEBI / COMPANY / VERIFIER attempt was dropped
        // from the persisted row — deleting the audit trail from precisely the
        // BLOCKED_ALL rows whose whole value is that trail.
        //
        // F-4: CHAIN lines are matched by IDENTITY, not by "has no url" — every
        // type's chain line lacks a url, so the old predicate put all of them on
        // every row.
        lastAttempt: attempts.filter((a) =>
          a.source === 'CHAIN'
            ? a === chainAttempt
            : !a.url || triedUrls.has(a.url) || !DOC_URL_RE.test(a.url)
        ),
      };
      if (documentId) patch.documentId = documentId;
      await this.deps.store.update(stateRow.id, patch);

      if (transition.state === 'FOUND') result.found.push(docType);
      else if (transition.state === 'NOT_YET_FILED') result.notYetFiled.push(docType);
      else if (transition.state === 'BLOCKED_ALL') result.blocked.push(docType);

      if (transition.alert) {
        logger.error(
          { ipoId: ipo.id, company: ipo.companyName, docType, attempts },
          'Document BLOCKED_ALL — every source failed (P2)'
        );
      }
      if (bytes !== undefined) {
        logger.info({ ipoId: ipo.id, docType, bytes }, 'Document FOUND and stored');
      }
    }

    const learned = this.companyUrlByIpo.get(ipo.id);
    if (learned && !ipo.companyWebsite) result.learnedCompanyWebsite = learned;

    result.networkCalls = this.deps.counter.count(ipo.id) - callsBefore;
    return result;
  }

  /** Run a whole cycle. Never throws for one IPO's sake. */
  async runCycle(ipos: DiscoveryIpo[]): Promise<IpoRunResult[]> {
    const results: IpoRunResult[] = [];
    for (const ipo of ipos) {
      try {
        const rows = (await this.deps.store.listForIpo(ipo.id)).map(toStateRow);
        results.push(await this.runIpo(ipo, rows));
      } catch (error) {
        // One IPO's failure must not abort the cycle (non-fatal-side-effects.md).
        logger.error(
          { ipoId: ipo.id, company: ipo.companyName, error: error instanceof Error ? error.message : String(error) },
          'Document discovery failed for one IPO (non-fatal) — continuing'
        );
      }
    }
    return results;
  }
}

/** Persisted row -> the pure shape the state machine reasons over. */
export function toStateRow(row: DocumentFetchStateRow): StateRow {
  return {
    docType: row.docType as DocumentType,
    state: row.state,
    attempts: row.attempts,
    nextRetryAt: row.nextRetryAt,
    blockedSinceAt: row.blockedSinceAt,
    filingDate: row.filingDate,
    extractorVersion: row.extractorVersion,
    lastAttemptAt: row.lastAttemptAt,
  };
}
