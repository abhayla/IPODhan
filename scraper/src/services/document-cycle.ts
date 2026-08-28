/**
 * The per-cycle document step — T-403 WP B wiring.
 *
 * This is what `scraper/src/index.ts`'s `primarySourceDiscovery` step calls when
 * `ENABLE_DOCUMENT_STATE_MACHINE` is on. It is a separate module rather than
 * inline in `index.ts` so the query -> plan -> run -> log flow is unit-testable
 * without booting the whole one-shot cycle.
 *
 * Cadence: EVERY cycle (30 min), not once a day. That is the point. The old step
 * was daily because it re-fetched NSE for every candidate IPO unconditionally,
 * so running it per cycle would have been 48x the traffic for no new data. With
 * the state machine deciding what is outstanding, a cycle where nothing has
 * changed costs zero requests, so there is no reason to wait a day to notice
 * that a Prospectus has been filed.
 *
 * Logging contract (decision-matrix §7.4): the attempt json goes on each state
 * row, the step ledger row is written by `index.ts`'s `runStep` wrapper with the
 * counts this function returns in `reason`, and one `scraper_logs` row per cycle
 * with `source='DOCUMENTS'` is written here so the existing metrics tracker and
 * alert thresholds cover documents like any other source.
 */

import { sql } from 'drizzle-orm';
import { db, getRedisClient } from '@ipodhan/shared';
import { DocumentRepository, DocumentFetchStateRepository, IPORepository } from '@ipodhan/shared';
import { recordBseDiscoveryMetadata, recordDocumentSourceHints } from './data-persister.js';
import { scraperLogs } from '@ipodhan/shared/db/schema';
import logger from '../utils/logger.js';
import {
  DocumentDiscoveryRunner,
  defaultFetcher,
  toStateRow,
  type DiscoveryIpo,
  type IpoRunResult,
} from './document-discovery-runner.js';
import { NetworkCounter } from '../utils/network-counter.js';
import { deriveLifecycleStage } from '../scheduler/stage-reconciler.js';
import { isInLiveWindow, CYCLE_BUDGET, type IssueShape } from './document-state-machine.js';
import type { DocumentFetchStateRow } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import {
  decidePurge,
  purgeIpoDocuments,
  getRetentionDays,
  getMaxRetentionDays,
  hasStoredFile,
  getStoreDir,
} from './document-store.js';

export interface DocumentCycleSummary {
  ipos: number;
  skipped: number;
  found: number;
  notYetFiled: number;
  blocked: number;
  networkCalls: number;
  durationMs: number;
  budgetExhausted: boolean;
}

/** `ipos=4 skipped=2 found=3 not_yet=1 blocked=0 calls=5` — the ledger `reason`. */
export function formatCycleReason(s: DocumentCycleSummary): string {
  return (
    `ipos=${s.ipos} skipped=${s.skipped} found=${s.found} not_yet=${s.notYetFiled} ` +
    `blocked=${s.blocked} calls=${s.networkCalls}${s.budgetExhausted ? ' budget=exhausted' : ''}`
  );
}

/** Aggregate per-IPO results into the one line the ledger and audit read. */
export function summarize(
  results: IpoRunResult[],
  durationMs: number,
  budgetExhausted = false
): DocumentCycleSummary {
  return {
    ipos: results.length,
    skipped: results.filter((r) => r.skipped).length,
    found: results.reduce((n, r) => n + r.found.length, 0),
    notYetFiled: results.reduce((n, r) => n + r.notYetFiled.length, 0),
    blocked: results.reduce((n, r) => n + r.blocked.length, 0),
    networkCalls: results.reduce((n, r) => n + r.networkCalls, 0),
    durationMs,
    budgetExhausted,
  };
}

/**
 * What we know about the issue that makes some document types impossible (R9/F15).
 *
 * The first cut never populated this, so `notApplicableTypes` could never fire:
 * a fixed-price issue would be asked for a PRICE_BAND_AD and an anchor report
 * every 30 minutes forever, find neither, and eventually drift into BLOCKED_ALL
 * — a self-inflicted alert that would drown the real ones.
 *
 * `isFixedPrice` is derived from the band we already store: a fixed-price issue
 * has one price, so min === max (and a book-built issue never does). The BSE
 * board's `IR_FLAG_FULL` refines this inside the runner when it is fetched, but
 * that arrives after the plan is computed, so the DB-derived value is what makes
 * the FIRST cycle correct.
 */
export function deriveIssueShape(row: Record<string, unknown>): IssueShape {
  const status = String(row.status ?? '').toUpperCase();
  const min = row.price_range_min === null || row.price_range_min === undefined ? null : Number(row.price_range_min);
  const max = row.price_range_max === null || row.price_range_max === undefined ? null : Number(row.price_range_max);
  const isFixedPrice =
    min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min > 0 && min === max;
  return {
    isFixedPrice,
    withdrawn: status === 'WITHDRAWN' || status === 'POSTPONED',
  };
}

/** Candidate IPOs: live-window only (R10 — history is WP F's job, not the cycle's). */
export async function loadCandidateIpos(): Promise<DiscoveryIpo[]> {
  const result = await db.execute(sql`
    SELECT id, company_name, symbol, segment, status, price_range_min,
           price_range_max, listing_date, bse_ipo_no
      FROM ipos
     WHERE offering_type = 'IPO'
       AND i.status IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED', 'WITHDRAWN', 'POSTPONED')
  `);
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  return rows
    .filter((r) => {
      // A WITHDRAWN/POSTPONED issue is outside the live window but must still be
      // visited once, to close its open rows as NOT_APPLICABLE (F15/M3).
      const status = String(r.status ?? '').toUpperCase();
      if (status === 'WITHDRAWN' || status === 'POSTPONED') return true;
      return isInLiveWindow({
        status: r.status as string | null,
        listingDate: (r.listing_date as Date | null) ?? null,
      });
    })
    .map((r) => ({
      id: String(r.id),
      companyName: String(r.company_name ?? ''),
      symbol: (r.symbol as string | null) ?? null,
      segment: (r.segment as string | null) ?? null,
      stage: deriveLifecycleStage({
        status: r.status as string | null,
        priceRangeMin: (r.price_range_min as string | null) ?? null,
      }),
      bseIpoNo: r.bse_ipo_no === null || r.bse_ipo_no === undefined ? null : Number(r.bse_ipo_no),
      companyWebsite: (r.company_website as string | null) ?? null,
      verifierUrl: (r.verifier_url as string | null) ?? null,
      issue: deriveIssueShape(r),
    }));
}

/**
 * Demote any FOUND row whose file is no longer on disk back to WANTED (M7).
 *
 * Purged too early, disk wiped, a failed rename — whatever the cause, without
 * this the state says FOUND forever and the document is silently absent: the
 * worst of both outcomes, because nothing re-fetches it and nothing reports it.
 *
 * Mutates `rows` in place as well as writing, so the caller's plan sees the
 * demoted state in the SAME cycle rather than a cycle later.
 */
export async function demoteMissingFiles(
  store: Pick<DocumentFetchStateRepository, 'update'>,
  ipoId: string,
  rows: DocumentFetchStateRow[],
  storeDir: string = getStoreDir()
): Promise<number> {
  let demoted = 0;
  for (const row of rows) {
    if (row.state !== 'FOUND') continue;
    if (hasStoredFile(ipoId, row.docType, storeDir)) continue;
    logger.warn(
      { ipoId, docType: row.docType },
      'FOUND document has no file on disk — demoting to WANTED so it is re-fetched'
    );
    await store.update(row.id, { state: 'WANTED', nextRetryAt: null, documentId: null });
    row.state = 'WANTED';
    row.documentId = null;
    demoted++;
  }
  return demoted;
}

/**
 * Run one document-discovery cycle.
 *
 * The wall-clock budget (R12) is checked between IPOs: discovery must never
 * starve the 30-minute scrape it shares a process with. Remaining IPOs are not
 * lost, they are simply next cycle's work — which is safe precisely because the
 * state table remembers where we stopped.
 */
export async function runDocumentCycle(options: { budgetMs?: number } = {}): Promise<DocumentCycleSummary> {
  const budgetMs = options.budgetMs ?? CYCLE_BUDGET.DISCOVERY_MS;
  const startedAt = Date.now();
  const redis = getRedisClient();
  const store = new DocumentFetchStateRepository(db as never, redis as never);
  const documents = new DocumentRepository(db as never, redis as never);
  const ipoRepository = new IPORepository(db as never, redis as never);
  const counter = new NetworkCounter();

  const runner = new DocumentDiscoveryRunner({
    fetcher: defaultFetcher,
    store,
    documents,
    counter,
  });

  const candidates = await loadCandidateIpos();
  const results: IpoRunResult[] = [];
  let budgetExhausted = false;

  for (const ipo of candidates) {
    if (Date.now() - startedAt >= budgetMs) {
      budgetExhausted = true;
      logger.warn(
        { processed: results.length, remaining: candidates.length - results.length, budgetMs },
        'Document discovery budget exhausted — remaining IPOs resume next cycle (state is persisted)'
      );
      break;
    }
    try {
      const persisted = await store.listForIpo(ipo.id);

      await demoteMissingFiles(store, ipo.id, persisted);

      const rows = persisted.map(toStateRow);
      const result = await runner.runIpo(ipo, rows);
      results.push(result);

      // Remember the IPO_NO while the IPO is still on the board (it leaves once
      // closed, exactly when the Prospectus becomes due) and how many lead
      // managers BSE listed (so the nightly audit can catch the co-BRLM class).
      //
      // Routed through data-persister, NOT written here: `scraper-write-path.md`
      // and the R0 write ratchet require every `ipos` write to go through the
      // shared write path. Non-fatal — bookkeeping must never fail a cycle.
      // T-403 M-6: persist the issuer website read off a filing cover, so rung
      // 4 (the investor page) becomes reachable for the NEXT document this IPO
      // needs. Non-fatal, and routed through data-persister.
      if (result.learnedCompanyWebsite) {
        try {
          await recordDocumentSourceHints(db, ipo.id, {
            companyWebsite: result.learnedCompanyWebsite,
          });
        } catch (error) {
          logger.warn(
            { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
            'Failed to record company website (non-fatal)'
          );
        }
      }

      if (result.resolvedBseIpoNo || result.leadManagers.length > 0) {
        try {
          await recordBseDiscoveryMetadata(ipoRepository, ipo.id, {
            bseIpoNo: result.resolvedBseIpoNo ?? null,
            bsePayloadLeadManagerCount:
              result.leadManagers.length > 0 ? result.leadManagers.length : null,
          });
        } catch (error) {
          logger.warn(
            { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
            'Failed to record BSE discovery metadata (non-fatal)'
          );
        }
      }
    } catch (error) {
      logger.error(
        {
          ipoId: ipo.id,
          company: ipo.companyName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Document discovery failed for one IPO (non-fatal) — continuing'
      );
    }
  }

  const summary = summarize(results, Date.now() - startedAt, budgetExhausted);

  // One scraper_logs row per cycle for source=DOCUMENTS, so the existing metrics
  // tracker and alert thresholds cover documents like any other source (§7.4).
  // Non-fatal: a logging failure must never fail the cycle.
  try {
    await db.insert(scraperLogs).values({
      source: 'DOCUMENTS',
      status: summary.blocked > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: summary.found,
      recordsFailed: summary.blocked,
      durationMs: summary.durationMs,
    } as never);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to write DOCUMENTS scraper_logs row (non-fatal)'
    );
  }

  logger.info({ ...summary, byHost: counter.byHost() }, 'Document discovery cycle complete');
  return summary;
}

export interface PurgeSummary {
  candidates: number;
  purged: number;
  filesDeleted: number;
  bytesFreed: number;
}

/**
 * PURGE_PDFS (D4). Deletes local PDFs for IPOs past
 * `close_date + PROSPECTUS_RETENTION_DAYS`, or withdrawn. FILES ONLY — the
 * `documents` and `document_fetch_state` rows and everything extracted from the
 * PDFs are retained, so nothing we learned is lost with the bytes.
 */
export async function runDocumentPurge(): Promise<PurgeSummary> {
  const retentionDays = getRetentionDays();
  const maxRetentionDays = getMaxRetentionDays();

  // One query, bounded to IPOs that can possibly be due: a close date exists and
  // is already past the soft window. The first cut scanned every IPO row with a
  // close date, which grows without limit as the table does (N4).
  const result = await db.execute(sql`
    SELECT i.id,
           i.close_date,
           i.status,
           count(s.id) FILTER (
             WHERE s.state NOT IN ('EXTRACTED', 'NOT_APPLICABLE')
           )::int AS unread_count
      FROM ipos i
      LEFT JOIN document_fetch_state s ON s.ipo_id = i.id
     WHERE i.offering_type = 'IPO'
       AND i.close_date IS NOT NULL
       AND (
         i.close_date < now() - make_interval(days => ${retentionDays})
         OR upper(i.status) IN ('WITHDRAWN', 'POSTPONED')
       )
     GROUP BY i.id, i.close_date, i.status
  `);
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  const summary: PurgeSummary = { candidates: 0, purged: 0, filesDeleted: 0, bytesFreed: 0 };
  for (const row of rows) {
    const status = String(row.status ?? '').toUpperCase();
    const decision = decidePurge({
      closeDate: row.close_date as Date | null,
      withdrawn: status === 'WITHDRAWN' || status === 'POSTPONED',
      allDocumentsRead: Number(row.unread_count ?? 0) === 0,
      retentionDays,
      maxRetentionDays,
    });
    if (!decision.purge) continue;

    summary.candidates++;
    const purge = await purgeIpoDocuments(String(row.id));
    if (!purge.purged) continue;
    summary.purged++;
    summary.filesDeleted += purge.filesDeleted;
    summary.bytesFreed += purge.bytesFreed;
    logger.info({ ipoId: String(row.id), reason: decision.reason }, 'Purged IPO document PDFs');
  }
  return summary;
}
