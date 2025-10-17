/**
 * Test Script for GMP API Scraper
 * Story 10.7: Implement GMP API Scraper
 *
 * Tests the GMP scraper by:
 * 1. Running the scraper
 * 2. Displaying scraped GMP data
 * 3. Verifying database insertion
 *
 * Usage:
 *   npm run scrape:gmp
 *   npm run scrape:gmp -- --status=OPEN
 *   npm run scrape:gmp -- --status=OPEN,UPCOMING,CLOSED
 */

import { gmpAPIScraper } from '../lib/scrapers/sources/gmp-api-scraper';
import { getDb } from '../lib/db';
import { gmpRecords } from '../lib/db';
import { desc, eq } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ==================== CLI ARGUMENT PARSING ====================

interface CLIOptions {
  status?: ('OPEN' | 'UPCOMING' | 'CLOSED')[];
  help?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--status=')) {
      const statusValue = arg.split('=')[1];
      const statuses = statusValue.split(',').map(s => s.trim().toUpperCase()) as ('OPEN' | 'UPCOMING' | 'CLOSED')[];
      options.status = statuses;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
GMP API Scraper Test Script

Usage:
  npm run scrape:gmp [options]

Options:
  --status=STATUS    Filter IPOs by status (comma-separated)
                     Valid values: OPEN, UPCOMING, CLOSED
                     Example: --status=OPEN,UPCOMING

  --help, -h         Show this help message

Examples:
  npm run scrape:gmp
  npm run scrape:gmp -- --status=OPEN
  npm run scrape:gmp -- --status=OPEN,UPCOMING,CLOSED
  `);
}

// ==================== MAIN FUNCTION ====================

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('========================================');
  console.log('   GMP API Scraper Test Script');
  console.log('========================================\n');

  console.log('Configuration:');
  console.log(`  - Status Filter: ${options.status ? options.status.join(', ') : 'All'}`);
  console.log(`  - Source: Chittorgarh.com`);
  console.log(`  - Rate Limit: 3 seconds between requests\n`);

  // Step 1: Run the scraper
  console.log('Step 1: Running GMP scraper...');
  console.log('----------------------------------------\n');

  const result = await gmpAPIScraper.scrape({
    filterStatus: options.status,
  });

  console.log('\n----------------------------------------');
  console.log(`Scraper Result: ${result.success ? '✅ SUCCESS' : '❌ FAILURE'}`);
  console.log('----------------------------------------\n');

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  // Step 2: Display scraped data
  console.log('Step 2: Scraped GMP Data:');
  console.log('----------------------------------------\n');

  if (!result.data || result.data.length === 0) {
    console.log('No GMP data found.');
  } else {
    console.log(`Total GMP records scraped: ${result.data.length}`);
    console.log(`Matched to IPOs: ${result.data.filter(d => d.ipoId).length}`);
    console.log(`Unmatched: ${result.data.filter(d => !d.ipoId).length}\n`);

    console.log('Sample GMP records:');
    const sampleData = result.data.slice(0, 5);
    for (const gmp of sampleData) {
      console.log(`
  IPO: ${gmp.ipoName}
  Match Score: ${gmp.matchScore.toFixed(1)}%
  Match Status: ${gmp.ipoId ? '✅ Matched' : '❌ Unmatched'}
  GMP: ₹${gmp.gmp} (${gmp.gmpPercentage !== null ? gmp.gmpPercentage.toFixed(2) + '%' : 'N/A'})
  Expected Listing Price: ₹${gmp.expectedListingPrice}
  Subject Rate: ${gmp.subjectRate !== null ? '₹' + gmp.subjectRate : 'N/A'}
  Kostak Rate: ${gmp.kostakRate !== null ? '₹' + gmp.kostakRate : 'N/A'}
  Sauda Details: ${gmp.saudaDetails || 'N/A'}
      `);
    }

    if (result.data.length > 5) {
      console.log(`\n  ... and ${result.data.length - 5} more records`);
    }
  }

  // Step 3: Verify database insertion
  console.log('\n----------------------------------------');
  console.log('Step 3: Verifying Database Insertion:');
  console.log('----------------------------------------\n');

  const db = await getDb();
  const matchedData = result.data ? result.data.filter(d => d.ipoId) : [];

  if (matchedData.length === 0) {
    console.log('No matched IPOs to verify in database.');
  } else {
    console.log(`Checking database for ${matchedData.length} matched IPOs...\n`);

    for (const gmpData of matchedData.slice(0, 3)) {
      if (!gmpData.ipoId) continue;

      const [latestRecord] = await db
        .select()
        .from(gmpRecords)
        .where(eq(gmpRecords.ipoId, gmpData.ipoId))
        .orderBy(desc(gmpRecords.timestamp))
        .limit(1);

      if (latestRecord) {
        console.log(`✅ ${gmpData.ipoName}`);
        console.log(`   Latest GMP: ₹${latestRecord.gmp}`);
        console.log(`   Expected Listing: ₹${latestRecord.expectedListingPrice}`);
        console.log(`   Source: ${latestRecord.source}`);
        console.log(`   Timestamp: ${latestRecord.timestamp.toISOString()}\n`);
      } else {
        console.log(`❌ ${gmpData.ipoName} - No records found in database\n`);
      }
    }

    if (matchedData.length > 3) {
      console.log(`... and ${matchedData.length - 3} more IPOs verified`);
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('   Summary');
  console.log('========================================\n');

  const dataLength = result.data?.length ?? 0;
  const matchedCount = result.data?.filter(d => d.ipoId).length ?? 0;
  const unmatchedCount = result.data?.filter(d => !d.ipoId).length ?? 0;

  const successRate = dataLength > 0
    ? ((matchedCount / dataLength) * 100).toFixed(1)
    : '0';

  console.log(`Total GMP records: ${dataLength}`);
  console.log(`Matched IPOs: ${matchedCount}`);
  console.log(`Unmatched IPOs: ${unmatchedCount}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Target Success Rate: 90%+ (AC: 6)`);
  console.log(`Status: ${parseFloat(successRate) >= 90 ? '✅ PASSED' : '⚠️ BELOW TARGET'}\n`);

  // Unmatched IPOs (for manual review)
  const unmatchedIPOs = result.data?.filter(d => !d.ipoId) ?? [];
  if (unmatchedIPOs.length > 0) {
    console.log('Unmatched IPOs (for manual review):');
    for (const ipo of unmatchedIPOs) {
      console.log(`  - ${ipo.ipoName} (best match score: ${ipo.matchScore.toFixed(1)}%)`);
    }
    console.log();
  }

  console.log('Test completed successfully! ✅\n');
}

// ==================== RUN SCRIPT ====================

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error({
      script: 'test-gmp-scraper',
      error: error instanceof Error ? error.message : String(error),
    }, 'Test script failed');
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });
