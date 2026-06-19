/**
 * Backfill ipo_demand_graph from NSE ipo-detail (Stage D). The NSE demand block is
 * fetched by fetchIPODetail but was never persisted (no writer existed → 0% coverage).
 * For each genuine OPEN mainboard IPO with an NSE symbol and NO existing demand rows,
 * fetch the live demand graph and persist it via createDemandGraphSnapshot.
 *
 * Run (env-before-import via the tunnel creds, per the C3b learning):
 *   cd scraper && npx tsx -e "require('dotenv').config({path:'../web/.env.local',override:true}); import('./src/scripts/backfill-demand-graph.ts').then(m=>m.runDemandBackfill({execute:false}))"
 *   ... {execute:true} to write.
 *
 * Idempotent: skips IPOs that already have demand rows. SME IPOs are fetched with
 * NSE &series=SME (C-1, mandatory or issueInfo is empty); mainboard with no series.
 */
import { sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared/db';
import logger from '../utils/logger.js';
import { fetchIPODetail } from '../scrapers/nse-api-client.js';
import { createDemandGraphSnapshot, type ScrapedDemandPoint } from '../services/data-persister.js';

export async function runDemandBackfill(opts: { execute?: boolean } = {}): Promise<void> {
  const execute = opts.execute === true;
  logger.info({ execute }, `[demand-backfill] start (${execute ? 'EXECUTE' : 'DRY RUN'})`);

  // Genuine OPEN IPOs (both segments) with an NSE symbol and no demand rows yet.
  const candidates = await db.execute(sql`
    SELECT i.id, i.symbol, i.company_name, i.segment
    FROM ipos i
    WHERE i.offering_type = 'IPO' AND i.status = 'OPEN'
      AND i.symbol IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ipo_demand_graph g WHERE g.ipo_id = i.id)
  `);
  const rows = (candidates as any).rows ?? candidates;
  logger.info({ count: rows.length }, '[demand-backfill] candidate OPEN IPOs (both segments)');

  let populated = 0;
  let totalPoints = 0;
  for (const row of rows) {
    const symbol: string = row.symbol;
    const ipoId: string = row.id;
    const series: 'EQ' | 'SME' = row.segment === 'SME' ? 'SME' : 'EQ';
    try {
      const detail = await fetchIPODetail(symbol, series);
      const points = (detail.demandGraph || []) as ScrapedDemandPoint[];
      logger.info({ symbol, company: row.company_name, points: points.length }, '[demand-backfill] fetched');
      if (points.length === 0) continue;
      if (!execute) { totalPoints += points.length; populated++; continue; }
      const n = await createDemandGraphSnapshot(ipoId, points);
      if (n > 0) { populated++; totalPoints += n; }
    } catch (err) {
      logger.warn({ symbol, err: (err as Error).message }, '[demand-backfill] fetch/persist failed — skipping');
    }
  }

  logger.info({ execute, populated, totalPoints }, `[demand-backfill] done (${execute ? 'wrote' : 'would write'} demand for ${populated} IPOs, ${totalPoints} points)`);

  // Read-back (G-PERSIST)
  const cov = await db.execute(sql`
    SELECT count(DISTINCT g.ipo_id)::int AS ipos, count(*)::int AS points
    FROM ipo_demand_graph g JOIN ipos i ON i.id = g.ipo_id AND i.offering_type = 'IPO'
  `);
  const c = ((cov as any).rows ?? cov)[0];
  logger.info({ iposWithDemand: c.ipos, totalRows: c.points }, '[demand-backfill] read-back: ipo_demand_graph coverage');
}
