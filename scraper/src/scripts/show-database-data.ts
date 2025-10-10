/**
 * Script to display database IPO data
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from scraper/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { db } from '@ipodhan/shared';

async function showData() {
  try {
    console.log('\n=== FETCHING IPO DATA FROM DATABASE ===\n');

    const ipos = await db.query.ipos.findMany({
      limit: 30,
      orderBy: (ipos, { desc }) => [desc(ipos.createdAt)]
    });

    console.log(`Total IPOs found: ${ipos.length}\n`);

    if (ipos.length === 0) {
      console.log('No IPOs in database');
      return;
    }

    // Group by status
    const byStatus = ipos.reduce((acc, ipo) => {
      acc[ipo.status] = (acc[ipo.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Group by category
    const byCategory = ipos.reduce((acc, ipo) => {
      acc[ipo.category] = (acc[ipo.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('Summary by Status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log('\nSummary by Category:');
    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });

    console.log('\n=== IPO DETAILS ===\n');
    ipos.forEach((ipo, i) => {
      console.log(`${i + 1}. ${ipo.companyName}`);
      console.log(`   Status: ${ipo.status} | Category: ${ipo.category}`);
      console.log(`   Dates: ${ipo.openDate || 'N/A'} to ${ipo.closeDate || 'N/A'}`);
      console.log(`   Listing: ${(ipo.listingExchanges as string[]).join(', ')}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error fetching data:', error);
  } finally {
    process.exit(0);
  }
}

showData();
