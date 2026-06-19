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

export async function runPrimaryDocBackfill(opts: { execute?: boolean; statuses?: string[] } = {}): Promise<void> {
  const execute = opts.execute === true;
  const statuses = opts.statuses ?? ['OPEN', 'UPCOMING', 'CLOSED'];
  logger.info({ execute, statuses }, `[primary-doc-backfill] start (${execute ? 'EXECUTE' : 'DRY RUN'})`);

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

  let iposWithDocs = 0;
  let docsUpserted = 0;
  for (const row of rows) {
    const series: 'EQ' | 'SME' = row.segment === 'SME' ? 'SME' : 'EQ';
    try {
      const issueInfo = await fetchNSEIssueInfo(row.symbol, series);
      const docs = parseNSEDocuments(issueInfo, row.symbol);
      if (docs.length === 0) continue;
      logger.info({ symbol: row.symbol, company: row.company_name, docs: docs.length, types: docs.map((d) => d.type) }, '[primary-doc-backfill] discovered');
      iposWithDocs++;
      if (!execute) { docsUpserted += docs.length; continue; }
      for (const d of docs) {
        await documentRepository.upsertDocument({
          ipoId: row.id,
          type: d.type as any,
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

  logger.info({ execute, iposWithDocs, docsUpserted }, `[primary-doc-backfill] done`);

  const cov = await db.execute(sql`
    SELECT count(DISTINCT d.ipo_id)::int AS ipos, count(*)::int AS docs,
           count(*) FILTER (WHERE d.exchange = 'NSE')::int AS nse_docs
    FROM documents d JOIN ipos i ON i.id = d.ipo_id AND i.offering_type = 'IPO'
  `);
  const c = ((cov as any).rows ?? cov)[0];
  logger.info({ iposWithDocs: c.ipos, totalDocs: c.docs, nseDocs: c.nse_docs }, '[primary-doc-backfill] read-back: documents coverage');
}
