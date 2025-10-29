/**
 * Backfill ISIN Data from NSE Website
 *
 * Purpose: Extract and populate ISIN for 11 NSE-only IPOs
 * Method: Use NSE website scraper with Puppeteer
 * Target: IPOs with NULL isin in database
 *
 * Usage: npx tsx src/scripts/backfill-isin-from-nse.ts
 */

import pkg from 'pg';
const { Client } = pkg;
import logger from '../utils/logger.js';
import { scrapeMultipleISINs, type NSEISINResult } from '../scrapers/nse-isin-scraper.js';

interface IPOToUpdate {
  id: string;
  companyName: string;
  symbol: string;
  currentISIN: string | null;
}

async function backfillISINFromNSE() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ||
                     'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('\n✅ Connected to database');

    // Step 1: Query IPOs needing ISIN
    console.log('\n📊 Querying IPOs without ISIN...\n');

    const query = `
      SELECT
        id,
        company_name as "companyName",
        symbol,
        isin
      FROM ipos
      WHERE isin IS NULL
        AND symbol IS NOT NULL
        AND listing_exchanges::text LIKE '%NSE%'
        AND listing_exchanges::text NOT LIKE '%BSE%'
      ORDER BY company_name
      LIMIT 50
    `;

    const result = await client.query<IPOToUpdate>(query);
    const iposToUpdate = result.rows;

    if (iposToUpdate.length === 0) {
      console.log('✅ No IPOs found needing ISIN update');
      await client.end();
      return;
    }

    console.log(`Found ${iposToUpdate.length} NSE-only IPO(s) without ISIN:\n`);
    iposToUpdate.forEach((ipo, i) => {
      console.log(`   ${i + 1}. ${ipo.companyName} (${ipo.symbol})`);
    });

    console.log('\n' + '═'.repeat(80));
    console.log('🚀 Starting ISIN extraction from NSE website...');
    console.log('═'.repeat(80) + '\n');

    // Step 2: Scrape ISINs from NSE
    const scrapeItems = iposToUpdate.map(ipo => ({
      symbol: ipo.symbol,
      companyName: ipo.companyName,
    }));

    const scrapeResults = await scrapeMultipleISINs(scrapeItems);

    // Step 3: Update database with results
    console.log('\n' + '═'.repeat(80));
    console.log('💾 Updating database with ISIN data...');
    console.log('═'.repeat(80) + '\n');

    let successCount = 0;
    let failureCount = 0;
    const updateResults: Array<{
      companyName: string;
      symbol: string;
      isin: string | null;
      status: 'success' | 'failed' | 'not_found';
      source?: string;
    }> = [];

    for (let i = 0; i < scrapeResults.length; i++) {
      const scrapeResult = scrapeResults[i];
      const ipo = iposToUpdate[i];

      if (scrapeResult.success && scrapeResult.isin) {
        // Update database
        try {
          await client.query(
            `UPDATE ipos SET isin = $1, updated_at = NOW() WHERE id = $2`,
            [scrapeResult.isin, ipo.id]
          );

          console.log(`✅ ${i + 1}/${iposToUpdate.length} ${ipo.companyName}`);
          console.log(`   ISIN: ${scrapeResult.isin} (source: ${scrapeResult.source})`);

          successCount++;
          updateResults.push({
            companyName: ipo.companyName,
            symbol: ipo.symbol,
            isin: scrapeResult.isin,
            status: 'success',
            source: scrapeResult.source || undefined,
          });
        } catch (updateError) {
          console.error(`❌ ${i + 1}/${iposToUpdate.length} ${ipo.companyName}`);
          console.error(`   Database update failed: ${updateError}`);

          failureCount++;
          updateResults.push({
            companyName: ipo.companyName,
            symbol: ipo.symbol,
            isin: null,
            status: 'failed',
          });
        }
      } else {
        console.log(`⚠️  ${i + 1}/${iposToUpdate.length} ${ipo.companyName}`);
        console.log(`   ISIN not found: ${scrapeResult.error || 'Unknown error'}`);

        failureCount++;
        updateResults.push({
          companyName: ipo.companyName,
          symbol: ipo.symbol,
          isin: null,
          status: 'not_found',
        });
      }
    }

    // Step 4: Display summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 BACKFILL SUMMARY');
    console.log('═'.repeat(80) + '\n');

    console.log(`Total IPOs processed: ${iposToUpdate.length}`);
    console.log(`✅ Successfully updated: ${successCount} (${((successCount / iposToUpdate.length) * 100).toFixed(1)}%)`);
    console.log(`❌ Failed/Not found: ${failureCount} (${((failureCount / iposToUpdate.length) * 100).toFixed(1)}%)`);

    if (successCount > 0) {
      console.log('\n✅ Successfully Updated IPOs:\n');
      updateResults
        .filter(r => r.status === 'success')
        .forEach((r, i) => {
          console.log(`   ${i + 1}. ${r.companyName}`);
          console.log(`      Symbol: ${r.symbol}, ISIN: ${r.isin}, Source: ${r.source}`);
        });
    }

    if (failureCount > 0) {
      console.log('\n⚠️  Failed/Not Found IPOs:\n');
      updateResults
        .filter(r => r.status !== 'success')
        .forEach((r, i) => {
          console.log(`   ${i + 1}. ${r.companyName} (${r.symbol})`);
          console.log(`      Status: ${r.status}`);
        });

      console.log('\n💡 Recommendations for failed IPOs:');
      console.log('   1. Manually search ISIN on NSE website');
      console.log('   2. Check SEBI website for official ISIN');
      console.log('   3. Google "{Company Name} ISIN NSE"');
    }

    // Step 5: Check overall ISIN coverage
    const coverageQuery = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(isin) as with_isin,
        ROUND(COUNT(isin)::numeric / COUNT(*)::numeric * 100, 2) as percentage
      FROM ipos
    `);

    const coverage = coverageQuery.rows[0];

    console.log('\n' + '═'.repeat(80));
    console.log('📈 OVERALL ISIN COVERAGE');
    console.log('═'.repeat(80) + '\n');
    console.log(`Total IPOs in database: ${coverage.total}`);
    console.log(`IPOs with ISIN: ${coverage.with_isin} (${coverage.percentage}%)`);
    console.log(`IPOs without ISIN: ${coverage.total - coverage.with_isin} (${(100 - parseFloat(coverage.percentage)).toFixed(2)}%)`);

    console.log('\n' + '═'.repeat(80));
    console.log('✅ Backfill completed!');
    console.log('═'.repeat(80) + '\n');

    await client.end();
  } catch (error) {
    console.error('\n❌ Fatal error during backfill:', error);
    await client.end();
    process.exit(1);
  }
}

// Run the backfill
backfillISINFromNSE().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
