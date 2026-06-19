/**
 * Backfill subscriptions from NSE ipo-detail (Stage D). fetchIPODetail returns the
 * bid/subscription block; the NSE orchestrator only persists it for OPEN IPOs during a
 * full scrape run (which isn't run regularly → subscriptions ~2.6%). This backfill
 * persists the latest subscription snapshot for genuine OPEN IPOs (both segments) that
 * have no subscription rows yet, via the canonical createSubscriptionSnapshot.
 *
 * Run (tunnel creds, env-before-import):
 *   cd scraper && npx tsx -e "require('dotenv').config({path:'../web/.env.local',override:true}); import('./src/scripts/backfill-subscription.ts').then(m=>m.runSubscriptionBackfill({execute:false}))"
 */
import { sql } from 'drizzle-orm';
import { db, getRedisClient } from '@ipodhan/shared';
import { SubscriptionRepository } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { fetchIPODetail } from '../scrapers/nse-api-client.js';
import { createSubscriptionSnapshot } from '../services/data-persister.js';
import { validateSubscriptionData } from '../utils/validators.js';

export async function runSubscriptionBackfill(opts: { execute?: boolean } = {}): Promise<void> {
  const execute = opts.execute === true;
  logger.info({ execute }, `[sub-backfill] start (${execute ? 'EXECUTE' : 'DRY RUN'})`);

  const redis = getRedisClient();
  const subscriptionRepository = new SubscriptionRepository(db as any, redis as any);

  const candidates = await db.execute(sql`
    SELECT i.id, i.symbol, i.company_name, i.segment
    FROM ipos i
    WHERE i.offering_type = 'IPO' AND i.status = 'OPEN'
      AND i.symbol IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.ipo_id = i.id)
  `);
  const rows = (candidates as any).rows ?? candidates;
  logger.info({ count: rows.length }, '[sub-backfill] candidate OPEN IPOs');

  let populated = 0;
  for (const row of rows) {
    const series: 'EQ' | 'SME' = row.segment === 'SME' ? 'SME' : 'EQ';
    try {
      const detail = await fetchIPODetail(row.symbol, series);
      const subs = detail.subscriptions || [];
      logger.info({ symbol: row.symbol, company: row.company_name, subs: subs.length }, '[sub-backfill] fetched');
      if (subs.length === 0) continue;
      // Persist the first valid subscription snapshot for this IPO.
      for (const s of subs) {
        const v = validateSubscriptionData(s);
        if (!v.success) { logger.warn({ symbol: row.symbol }, '[sub-backfill] subscription failed validation'); continue; }
        if (!execute) { populated++; break; }
        await createSubscriptionSnapshot(subscriptionRepository, row.id, v.data!);
        populated++;
        break;
      }
    } catch (err) {
      logger.warn({ symbol: row.symbol, err: (err as Error).message }, '[sub-backfill] fetch/persist failed — skipping');
    }
  }

  logger.info({ execute, populated }, `[sub-backfill] done (${execute ? 'wrote' : 'would write'} subscription for ${populated} IPOs)`);

  const cov = await db.execute(sql`
    SELECT count(DISTINCT s.ipo_id)::int AS ipos FROM subscriptions s
    JOIN ipos i ON i.id = s.ipo_id AND i.offering_type = 'IPO'
  `);
  logger.info({ iposWithSubscription: (((cov as any).rows ?? cov)[0]).ipos }, '[sub-backfill] read-back: subscriptions coverage');
}
