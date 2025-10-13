/**
 * Scraper Execution Script
 *
 * Manual execution script for running all scrapers
 * Usage: npx tsx scripts/run-scrapers.ts
 */

import { marketHolidaysScraper } from '../lib/scrapers/sources/market-holidays-scraper';
import { ipoReviewsScraper } from '../lib/scrapers/sources/ipo-reviews-scraper';
import { prospectusScraper } from '../lib/scrapers/sources/prospectus-scraper';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log('IPODhan Data Scraper Execution');
  console.log('========================================\n');

  const startTime = Date.now();

  // 1. Market Holidays
  console.log('1. Scraping Market Holidays...');
  try {
    const currentYear = new Date().getFullYear();
    const holidaysResult = await marketHolidaysScraper.scrape(currentYear);

    if (holidaysResult.success && holidaysResult.data) {
      console.log(`   SUCCESS: Scraped ${holidaysResult.data.length} holidays`);
      console.log(`   Year: ${currentYear}`);
    } else {
      console.log(`   FAILED: ${holidaysResult.error}`);
    }
  } catch (error) {
    console.error(`   CRASHED:`, error);
  }

  await sleep(5000); // Rate limiting

  // 2. IPO Reviews
  console.log('\n2. Scraping IPO Reviews...');
  try {
    const reviewsResult = await ipoReviewsScraper.scrape('ALL');

    if (reviewsResult.success && reviewsResult.data) {
      console.log(`   SUCCESS: Scraped ${reviewsResult.data.length} reviews`);

      const mainboard = reviewsResult.data.filter(r => r.category === 'MAINBOARD').length;
      const sme = reviewsResult.data.filter(r => r.category === 'SME').length;

      console.log(`   Mainboard: ${mainboard} | SME: ${sme}`);
    } else {
      console.log(`   FAILED: ${reviewsResult.error}`);
    }
  } catch (error) {
    console.error(`   CRASHED:`, error);
  }

  await sleep(5000); // Rate limiting

  // 3. Prospectus Documents
  console.log('\n3. Scraping Prospectus Documents...');
  try {
    const prospectusResult = await prospectusScraper.scrape();

    if (prospectusResult.success && prospectusResult.data) {
      console.log(`   SUCCESS: Scraped ${prospectusResult.data.length} documents`);

      const nse = prospectusResult.data.filter(d => d.exchange === 'NSE').length;
      const bse = prospectusResult.data.filter(d => d.exchange === 'BSE').length;
      const matched = prospectusResult.data.filter(d => d.ipoId).length;

      console.log(`   NSE: ${nse} | BSE: ${bse} | Matched: ${matched}`);
    } else {
      console.log(`   FAILED: ${prospectusResult.error}`);
    }
  } catch (error) {
    console.error(`   CRASHED:`, error);
  }

  // Future scrapers:
  // 4. Historical IPO Data
  // 5. Rights Issues

  const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n========================================');
  console.log('All scrapers completed!');
  console.log(`Total execution time: ${executionTime}s`);
  console.log('========================================\n');
}

main().catch(error => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
