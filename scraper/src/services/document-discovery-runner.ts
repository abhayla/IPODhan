/**
 * Document discovery runner — T-403 WP A, the live side of the decision tree
 * (decision-matrix §1) driven by the state machine (§7).
 *
 * BSE-FIRST, per the owner's 2026-08-28 rule: "BSE or NSE first, always."
 * Mainboard order is BSE core API -> NSE ipo-detail -> (SEBI, company host:
 * WP A+B stops at the exchanges; those two rungs are declared here and are the
 * next thing to wire, they are not silently pretended to exist).
 * SME order is NSE first, because BSE's mainboard board does not carry SME.
 *
 * What replaces what: the old `runPrimaryDocBackfill` fetched NSE for EVERY
 * candidate IPO, once a day, with a 15 s cap and no retry, and kept no record of
 * what happened. This runner asks the state machine what is outstanding FIRST
 * and makes no request at all for an IPO with nothing due.
 *
 * Every dependency — fetching, the state store, the document sink, the clock —
 * is injected. That is what lets the acceptance harness run the real decision
 * logic against real exchange payloads with an in-memory store, which is the
 * only way to demonstrate the zero-calls property while the dev database is
 * unavailable.
 */

import {
  parseBSEDocuments,
  parseNSEDocuments,
  encodeDocumentUrl,
  type DiscoveredDocument,
} from './primary-source-discovery.js';
import { parseBseBoard, resolveBseBoardRow, extractBseCoreRow, type BseBoardRow } from './bse-ipo-board.js';
import { parseBseParties } from './bse-party-parser.js';
import { verifyDownload, type VerifyResult } from './document-download-verifier.js';
import { storeDocument, getStoreDir } from './document-store.js';
import {
  planIpoCycle,
  applyOutcome,
  type AttemptOutcome,
  type CycleOptions,
  type IssueShape,
  type StateRow,
} from './document-state-machine.js';
import type { DocumentType } from './document-types.js';
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

/** Per-request ceiling. Generous vs the old 15 s cap because retries follow. */
export const FETCH_TIMEOUT_MS = 20_000;

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

/** Where a verified document is recorded. Implemented by DocumentRepository. */
export interface DocumentSink {
  upsertDocument(doc: {
    ipoId: string;
    type: string;
    title: string;
    url: string;
    exchange: string;
    mediaType: string;
    extractionStatus: string;
    isActive: boolean;
    fileSize?: number;
  }): Promise<{ id: string }>;
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
  leadManagers: string[];
  attempts: FetchAttempt[];
  networkCalls: number;
  /**
   * The IPO_NO resolved from the board this cycle, when it was not already
   * known. The caller MUST persist it to `ipos.bse_ipo_no`; see the note on
   * DiscoveryIpo.bseIpoNo for why re-deriving it later is not possible.
   */
  resolvedBseIpoNo?: number;
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
  private boardFetched = false;

  constructor(private readonly deps: RunnerDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** One counted request. Records the call before returning, success or not. */
  private async request(
    url: string,
    headers: Record<string, string>,
    ipoKey?: string
  ): Promise<HttpResponse> {
    const started = Date.now();
    const res = await this.deps.fetcher(url, { headers, timeoutMs: FETCH_TIMEOUT_MS });
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
    const res = await this.request(`${BSE_API_BASE}IPO_HomePageDetail/w`, BSE_HEADERS);
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
      const board = await this.getBoard();
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
    const res = await this.request(url, BSE_HEADERS, ipo.id);
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
        await new Promise((r) => setTimeout(r, NSE_RETRY_BACKOFF_MS[attempt]));
      }
    }
    return null;
  }

  /** Download + verify one discovered link. */
  private async fetchAndVerify(
    doc: DiscoveredDocument,
    ipo: DiscoveryIpo,
    attempts: FetchAttempt[]
  ): Promise<VerifyResult | null> {
    const url = encodeDocumentUrl(doc.url);
    const headers = doc.source === 'BSE' ? BSE_HEADERS : NSE_HEADERS;
    const started = Date.now();
    const res = await this.request(url, { ...headers, Accept: '*/*' }, ipo.id);
    const verdict = verifyDownload(
      res.body,
      { status: res.status, contentType: res.contentType, url: res.url },
      { expectedCompanyName: ipo.companyName }
    );
    attempts.push({
      source: doc.source,
      http: res.status,
      ms: Date.now() - started,
      outcome: verdict.ok ? 'downloaded' : `rejected:${verdict.reason}`,
      url,
    });
    return verdict;
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
      leadManagers: [],
      attempts,
      networkCalls: 0,
    };

    // R9: record the impossible types once. No network needed.
    for (const docType of plan.toMarkNotApplicable) {
      const row = await this.deps.store.ensureRow(ipo.id, docType);
      await this.deps.store.update(row.id, { state: 'NOT_APPLICABLE', nextRetryAt: null });
    }

    if (plan.skipIpo) {
      logger.debug({ ipoId: ipo.id, company: ipo.companyName }, plan.reason);
      result.networkCalls = this.deps.counter.count(ipo.id) - callsBefore;
      return result;
    }

    // ONE exchange call set covers EVERY due type (§7.2).
    const discovered = new Map<DocumentType, DiscoveredDocument>();
    const isSme = ipo.segment === 'SME';

    const takeAll = (docs: DiscoveredDocument[]) => {
      for (const doc of docs) {
        // First verified source wins (R2); a later source never displaces it.
        if (!discovered.has(doc.type)) discovered.set(doc.type, doc);
      }
    };

    /** True when every due type now has a candidate link. */
    const allDueCovered = () => plan.due.every((t) => discovered.has(t));

    if (!isSme) {
      const bse = await this.fetchBseCore(ipo, attempts);
      if (bse) {
        takeAll(parseBSEDocuments(bse.row));
        result.leadManagers = parseBseParties(bse.row as never).leadManagers;
        if (ipo.bseIpoNo == null) result.resolvedBseIpoNo = bse.ipoNo;
        if (bse.boardRow?.isFixedPrice) ipo.issue = { ...ipo.issue, isFixedPrice: true };
      }
    }

    // NSE second for mainboard, FIRST-and-only-exchange for SME. Skipped when
    // BSE already produced a link for every due type — the cheapest correct move.
    if (!allDueCovered()) {
      const issueInfo = await this.fetchNseIssueInfo(ipo, attempts);
      if (issueInfo) takeAll(parseNSEDocuments(issueInfo, ipo.symbol ?? ''));
    }

    const exchangesAnswered = attempts.some(
      (a) => (a.source === 'BSE' || a.source === 'NSE') && a.outcome === 'ok'
    );

    for (const docType of plan.due) {
      const stateRow = await this.deps.store.ensureRow(ipo.id, docType);
      const prior: StateRow =
        existingRows.find((r) => r.docType === docType) ??
        toStateRow(stateRow);

      const candidate = discovered.get(docType);
      let outcome: AttemptOutcome;
      let documentId: string | null = null;
      let bytes: number | undefined;

      if (!candidate) {
        // F3 vs F6: an exchange that ANSWERED with an empty field means the
        // filing does not exist yet; no exchange answering at all is a failure.
        // Conflating the two is what would turn "the anchor report is not filed
        // until tomorrow" into a P2 page every 30 minutes.
        outcome = exchangesAnswered ? 'no_link' : 'all_sources_failed';
      } else if (this.deps.skipDownload) {
        outcome = 'found';
      } else {
        const verdict = await this.fetchAndVerify(candidate, ipo, attempts);
        if (verdict && verdict.ok) {
          const stored = await storeDocument({
            ipoId: ipo.id,
            docType,
            pdf: verdict.pdf,
            sha256: verdict.sha256,
            storeDir: this.deps.storeDir ?? getStoreDir(),
          });
          if (stored.stored) {
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
            });
            documentId = doc.id;
            bytes = verdict.bytes;
            outcome = 'found';
          } else {
            // The store is full. That is an infrastructure failure, not a
            // missing filing — it must not be recorded as NOT_YET_FILED.
            outcome = 'all_sources_failed';
          }
        } else {
          outcome = 'all_sources_failed';
        }
      }

      const transition = applyOutcome(prior, outcome, now);
      const patch: DocumentFetchStatePatch = {
        state: transition.state,
        nextRetryAt: transition.nextRetryAt,
        blockedSinceAt: transition.blockedSinceAt,
        attempts: (stateRow.attempts ?? 0) + 1,
        lastAttemptAt: now,
        lastAttempt: attempts,
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
