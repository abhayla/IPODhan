/**
 * Historical IPO Scraper CLI Script
 * Story 7.10: Historical IPO Data Scraper Implementation
 *
 * Usage:
 * - npm run scrape:historical                              (full scrape 2020-2025)
 * - npm run scrape:historical:incremental                  (incremental - current + previous year)
 * - npm run scrape:historical -- --years 2024,2025         (specific years)
 *
 * AC: 13 - CLI execution support
 */

// CRITICAL: Load environment variables BEFORE any other imports
// This ensures the database module gets the correct configuration
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local file from the web directory
const envPath = resolve(process.cwd(), '.env.local');
const result = config({ path: envPath });

if (result.error) {
  console.error('Failed to load .env.local file:', result.error);
  process.exit(1);
}

// Verify critical environment variables are loaded
if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
  console.error('ERROR: DATABASE_URL or DATABASE_HOST not found in environment');
  console.error('Loaded env file from:', envPath);
  console.error('Available vars:', Object.keys(result.parsed || {}).join(', '));
  process.exit(1);
}

// Now import modules that depend on environment variables
import { historicalIPOScraper } from '@/lib/scrapers/sources/historical-ipo-scraper';
import { logger } from '@/lib/logger';

async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const options: {
    years?: number[];
    incrementalUpdate?: boolean;
  } = {};

  if (args.includes('--incremental')) {
    options.incrementalUpdate = true;
    console.log('Running in incremental update mode (current + previous year)...\n');
  } else if (args.includes('--years')) {
    const yearIndex = args.indexOf('--years') + 1;
    const yearArg = args[yearIndex];

    if (yearArg) {
      options.years = yearArg.split(',').map(y => parseInt(y.trim()));
      console.log(`Scraping specific years: ${options.years.join(', ')}\n`);
    } else {
      console.error('Error: --years flag requires comma-separated year values');
      console.error('Example: npm run scrape:historical -- --years 2024,2025');
      process.exit(1);
    }
  } else {
    console.log('Running full historical scrape (2020-2025)...\n');
  }

  console.log('========================================');
  console.log('Historical IPO Data Scraper');
  console.log('========================================\n');

  const startTime = Date.now();

  try {
    const result = await historicalIPOScraper.scrape(options);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result.success && result.data) {
      const matchedCount = result.data.filter(d => d.ipoId).length;
      const unmatchedCount = result.data.length - matchedCount;
      const matchRate = ((matchedCount / result.data.length) * 100).toFixed(1);

      console.log('\n========================================');
      console.log('Scraper completed successfully!');
      console.log('========================================');
      console.log(`Total IPOs processed:    ${result.data.length}`);
      console.log(`IPOs matched to DB:      ${matchedCount}`);
      console.log(`IPOs not matched:        ${unmatchedCount}`);
      console.log(`Match rate:              ${matchRate}%`);
      console.log(`Execution time:          ${duration}s`);
      console.log('========================================\n');

      // Log unmatched IPOs for manual review
      if (unmatchedCount > 0) {
        console.log('Unmatched IPOs (for manual review):');
        result.data
          .filter(d => !d.ipoId)
          .slice(0, 10) // Show first 10
          .forEach((ipo, index) => {
            console.log(`  ${index + 1}. ${ipo.ipoName} (best match: ${ipo.matchScore.toFixed(1)}%)`);
          });

        if (unmatchedCount > 10) {
          console.log(`  ... and ${unmatchedCount - 10} more`);
        }
        console.log('');
      }

      logger.info({
        script: 'run-historical-scraper',
        status: 'success',
        iposProcessed: result.data.length,
        iposMatched: matchedCount,
        matchRate: parseFloat(matchRate),
        durationSeconds: parseFloat(duration),
      }, 'Historical scraper completed successfully');

      process.exit(0);
    } else {
      console.error('\n========================================');
      console.error('Scraper failed!');
      console.error('========================================');
      console.error(`Error: ${result.error || 'Unknown error'}`);
      console.error(`Execution time: ${duration}s`);
      console.error('========================================\n');

      logger.error({
        script: 'run-historical-scraper',
        status: 'failure',
        error: result.error,
        durationSeconds: parseFloat(duration),
      }, 'Historical scraper failed');

      process.exit(1);
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error('\n========================================');
    console.error('Fatal error!');
    console.error('========================================');
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Execution time: ${duration}s`);
    console.error('========================================\n');

    logger.error({
      script: 'run-historical-scraper',
      status: 'fatal-error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationSeconds: parseFloat(duration),
    }, 'Historical scraper fatal error');

    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  logger.error({
    script: 'run-historical-scraper',
    type: 'unhandled-rejection',
    error: error instanceof Error ? error.message : String(error),
  }, 'Unhandled rejection');
  process.exit(1);
});

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  logger.error({
    script: 'run-historical-scraper',
    type: 'fatal-catch',
    error: error instanceof Error ? error.message : String(error),
  }, 'Fatal error in main catch');
  process.exit(1);
});
