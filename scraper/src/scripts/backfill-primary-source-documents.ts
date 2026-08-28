/**
 * Backfill `documents` from the NSE primary source (Stage B-live). For each genuine
 * current IPO with an NSE symbol, fetch the live ipo-detail issueInfo, parse the titled
 * document rows (RHP / Anchor / Ratios / …), and upsert a `documents` row per discovered
 * URL with the correct documentTypeEnum. This is the PRIMARY-source spine (vs the
 * Chittorgarh aggregator fallback). The PDF download + extraction is a separate step
 * (Stage C) driven off these rows + extraction_status=PENDING.
 *
 * Idempotent: upsertDocument dedups by URL. SME uses NSE &series=SME (C-1). Run:
 *   cd scraper && npx tsx -e "require('dotenv').config({path:'../web/.env.local',override:true}); import('./src/scripts/backfill-primary-source-documents.ts').then(m=>m.runPrimaryDocBackfill({execute:false}))"
 */
import { sql } from 'drizzle-orm';
import { db, getRedisClient } from '@ipodhan/shared';
import { DocumentRepository } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { fetchNSEIssueInfo } from '../scrapers/nse-api-client.js';
import { parseNSEDocuments } from '../services/primary-source-discovery.js';
import { toPre0035DocumentType } from '../services/document-types.js';

// T-311F MEDIUM: this backfill is `await`ed from index.ts's
// triggerPrimarySourceDiscovery(), itself inside the same one-shot
// `--source=all` process as the job-completion heartbeat/watchdog, on a
// `*/30` cron cycle (deploy-linux.sh / pm2-scheduled-one-shot-scraper.md).
// The original loop had NO bound: one slow/hanging NSE response, or growth
// in the OPEN/UPCOMING/CLOSED candidate count, could make this
// once-daily-cadence-gated backfill run past its own `*/30` cycle and
// starve the heartbeat. Two independent guards close that: a PER-FETCH
// timeout (one hung request cannot stall the whole loop) and a TOTAL time
// budget (skip-remaining + log once the budget is exhausted, rather than
// running unbounded).
const PER_FETCH_TIMEOUT_MS = 15_000;
const TOTAL_BUDGET_MS = 5 * 60_000;

/** Races `promise` against a timeout, rejecting with a labeled error if the
 * timeout wins. Exported for direct unit coverage without a DB/network mock. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Pure predicate for "has the total time budget for this cycle run out?" —
 * exported for direct unit coverage without a DB/network mock. */
export function isBudgetExhausted(startedAtMs: number, budgetMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - startedAtMs >= budgetMs;
}

export async function runPrimaryDocBackfill(opts: { execute?: boolean; statuses?: string[]; budgetMs?: number; perFetchTimeoutMs?: number } = {}): Promise<void> {
  const execute = opts.execute === true;
  const statuses = opts.statuses ?? ['OPEN', 'UPCOMING', 'CLOSED'];
  const budgetMs = opts.budgetMs ?? TOTAL_BUDGET_MS;
  const perFetchTimeoutMs = opts.perFetchTimeoutMs ?? PER_FETCH_TIMEOUT_MS;
  logger.info({ execute, statuses, budgetMs, perFetchTimeoutMs }, `[primary-doc-backfill] start (${execute ? 'EXECUTE' : 'DRY RUN'})`);

  const redis = getRedisClient();
  const documentRepository = new DocumentRepository(db as any, redis as any);

  const statusList = statuses.map((s) => `'${s}'`).join(',');
  const candidates = await db.execute(sql`
    SELECT i.id, i.symbol, i.company_name, i.segment
    FROM ipos i
    WHERE i.offering_type = 'IPO' AND i.symbol IS NOT NULL
      AND i.status IN (${sql.raw(statusList)})
  `);
  const rows = (candidates as any).rows ?? candidates;
  logger.info({ count: rows.length }, '[primary-doc-backfill] candidate IPOs with NSE symbol');

  const startedAtMs = Date.now();
  let iposWithDocs = 0;
  let docsUpserted = 0;
  let skippedForBudget = 0;
  for (let i = 0; i < rows.length; i++) {
    if (isBudgetExhausted(startedAtMs, budgetMs)) {
      skippedForBudget = rows.length - i;
      logger.warn(
        { processed: i, remaining: skippedForBudget, budgetMs },
        '[primary-doc-backfill] time budget exhausted — skipping remaining candidates this cycle (they will be retried on the next daily-cadence run)'
      );
      break;
    }
    const row = rows[i];
    const series: 'EQ' | 'SME' = row.segment === 'SME' ? 'SME' : 'EQ';
    try {
      const issueInfo = await withTimeout(fetchNSEIssueInfo(row.symbol, series), perFetchTimeoutMs, `fetchNSEIssueInfo(${row.symbol})`);
      const docs = parseNSEDocuments(issueInfo, row.symbol);
      if (docs.length === 0) continue;
      logger.info({ symbol: row.symbol, company: row.company_name, docs: docs.length, types: docs.map((d) => d.type) }, '[primary-doc-backfill] discovered');
      iposWithDocs++;
      if (!execute) { docsUpserted += docs.length; continue; }
      for (const d of docs) {
        await documentRepository.upsertDocument({
          ipoId: row.id,
          // T-403 M5: this LEGACY path may run against a database that has not
          // had migration 0035 applied, so it must never emit an enum value that
          // predates it. The state-machine path stores the true type.
          type: toPre0035DocumentType(d.type) as any,
          title: d.title,
          url: d.url,
          exchange: 'NSE',
          mediaType: 'PDF',
          extractionStatus: 'PENDING',
          isActive: true,
        } as any);
        docsUpserted++;
      }
    } catch (err) {
      logger.warn({ symbol: row.symbol, err: (err as Error).message }, '[primary-doc-backfill] failed — skipping');
    }
  }

  logger.info({ execute, iposWithDocs, docsUpserted, skippedForBudget }, `[primary-doc-backfill] done`);

  const cov = await db.execute(sql`
    SELECT count(DISTINCT d.ipo_id)::int AS ipos, count(*)::int AS docs,
           count(*) FILTER (WHERE d.exchange = 'NSE')::int AS nse_docs
    FROM documents d JOIN ipos i ON i.id = d.ipo_id AND i.offering_type = 'IPO'
  `);
  const c = ((cov as any).rows ?? cov)[0];
  logger.info({ iposWithDocs: c.ipos, totalDocs: c.docs, nseDocs: c.nse_docs }, '[primary-doc-backfill] read-back: documents coverage');
}
