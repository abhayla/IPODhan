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
import { recordBseDiscoveryMetadata } from './data-persister.js';
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
import { isInLiveWindow, CYCLE_BUDGET } from './document-state-machine.js';
import { isPurgeDue, purgeIpoDocuments, getRetentionDays } from './document-store.js';

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

/** Candidate IPOs: live-window only (R10 — history is WP F's job, not the cycle's). */
export async function loadCandidateIpos(): Promise<DiscoveryIpo[]> {
  const result = await db.execute(sql`
    SELECT id, company_name, symbol, segment, status, price_range_min,
           listing_date, bse_ipo_no
      FROM ipos
     WHERE offering_type = 'IPO'
       AND status IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED')
  `);
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  return rows
    .filter((r) =>
      isInLiveWindow({
        status: r.status as string | null,
        listingDate: (r.listing_date as Date | null) ?? null,
      })
    )
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
    }));
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
    documents: documents as never,
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
      const rows = (await store.listForIpo(ipo.id)).map(toStateRow);
      const result = await runner.runIpo(ipo, rows);
      results.push(result);

      // Remember the IPO_NO while the IPO is still on the board (it leaves once
      // closed, exactly when the Prospectus becomes due) and how many lead
      // managers BSE listed (so the nightly audit can catch the co-BRLM class).
      //
      // Routed through data-persister, NOT written here: `scraper-write-path.md`
      // and the R0 write ratchet require every `ipos` write to go through the
      // shared write path. Non-fatal — bookkeeping must never fail a cycle.
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
  const result = await db.execute(sql`
    SELECT id, close_date, status FROM ipos
     WHERE offering_type = 'IPO' AND close_date IS NOT NULL
  `);
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  const summary: PurgeSummary = { candidates: 0, purged: 0, filesDeleted: 0, bytesFreed: 0 };
  for (const row of rows) {
    const withdrawn = String(row.status ?? '').toUpperCase() === 'WITHDRAWN';
    if (!isPurgeDue({ closeDate: row.close_date as Date | null, withdrawn, retentionDays })) continue;
    summary.candidates++;
    const purge = await purgeIpoDocuments(String(row.id));
    if (!purge.purged) continue;
    summary.purged++;
    summary.filesDeleted += purge.filesDeleted;
    summary.bytesFreed += purge.bytesFreed;
  }
  return summary;
}
