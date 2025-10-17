/**
 * Test BSE Detail Page Scraper
 * Quick test to verify detail page scraping works
 */

import { scrapeBSEIPODetail } from '../scrapers/bse-detail-scraper.js';
import logger from '../utils/logger.js';

async function testBSEDetailScraper() {
  const testUrl = 'https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025';

  logger.info({ testUrl }, 'Testing BSE detail scraper');

  try {
    const result = await scrapeBSEIPODetail(testUrl);

    logger.info('BSE Detail Scraper Test Result:');
    console.log(JSON.stringify(result, null, 2));

    // Verify expected data
    const checks = {
      'Symbol exists': !!result.symbol,
      'Issue size > 0': result.issueSize > 0,
      'Lot size > 0': result.lotSize > 0,
      'Price range valid': result.priceRangeMin > 0 && result.priceRangeMax > 0,
      'Dates exist': !!result.openDate && !!result.closeDate,
    };

    logger.info('Data validation checks:');
    console.log(checks);

    const allPassed = Object.values(checks).every(v => v === true);

    if (allPassed) {
      logger.info('✅ All checks passed!');
    } else {
      logger.warn('⚠️ Some checks failed');
    }

  } catch (error) {
    logger.error({ error }, 'BSE detail scraper test failed');
    throw error;
  }
}

testBSEDetailScraper()
  .then(() => {
    logger.info('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed');
    process.exit(1);
  });
