/**
 * Script to scrape data for Cool Caps Industries Limited (COOLCAPSR)
 */
import { scrapeNSEAPI } from '../scrapers/nse-api-client.js';
import { db } from '@ipodhan/shared';
import { ipos, subscriptions } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { readDatabaseNow } from '@ipodhan/shared/db/database-clock';
import { writeIposRebuildingPlanInTx } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import { loadPlanManifest } from '../config/field-manifest-loader.js';
import logger from '../utils/logger.js';

async function scrapeCoolCaps() {
  try {
    logger.info('Starting scrape for Cool Caps Industries Limited (COOLCAPSR)');

    // Run NSE API scraper to get all current IPOs
    const result = await scrapeNSEAPI();

    logger.info({ count: result.ipos.length }, 'Fetched IPOs from NSE API');

    // Find Cool Caps in the results
    const coolCaps = result.ipos.find(ipo =>
      ipo.symbol === 'COOLCAPSR' ||
      ipo.companyName?.toLowerCase().includes('cool caps')
    );

    if (!coolCaps) {
      logger.warn('Cool Caps Industries Limited not found in NSE API results');
      logger.info('Available IPOs:', result.ipos.map(i => ({ name: i.companyName, symbol: i.symbol })));
      process.exit(1);
    }

    logger.info({ ipo: coolCaps }, 'Found Cool Caps in NSE data');

    // Update the existing record
    // #1402 (spec §2.8): the NSE record can carry segment / offeringType / listingExchanges (plan
    // inputs); the write rebuilds the plan in the same transaction.
    const [target] = await db.select({ id: ipos.id }).from(ipos).where(eq(ipos.slug, 'cool-caps-industries-limited'));
    if (!target) throw new Error('Cool Caps IPO row not found');
    const manifest = loadPlanManifest();
    await db.transaction(async (tx) => {
      const now = await readDatabaseNow(tx as never);
      await writeIposRebuildingPlanInTx(tx as never, target.id, { ...coolCaps, lastScrapedAt: now, updatedAt: now }, manifest);
    });
    const updated = await db.select().from(ipos).where(eq(ipos.id, target.id));

    logger.info({ updated: updated[0] }, 'Updated Cool Caps IPO record');

    // Check for subscription data
    const coolCapsSubscriptions = result.subscriptions.filter(sub =>
      sub.symbol === 'COOLCAPSR'
    );

    if (coolCapsSubscriptions.length > 0) {
      logger.info({ count: coolCapsSubscriptions.length }, 'Found subscription data');

      // Insert subscription data
      for (const sub of coolCapsSubscriptions) {
        await db.insert(subscriptions)
          .values({
            ...sub,
            ipoId: updated[0].id,
          })
          .onConflictDoNothing();
      }

      logger.info('Inserted subscription data');
    } else {
      logger.warn('No subscription data found for Cool Caps');
    }

    logger.info('✅ Successfully scraped and updated Cool Caps Industries Limited');
    process.exit(0);

  } catch (error) {
    logger.error({ error }, 'Failed to scrape Cool Caps data');
    process.exit(1);
  }
}

scrapeCoolCaps();
