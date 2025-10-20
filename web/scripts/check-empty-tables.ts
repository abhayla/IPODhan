/**
 * Check Empty Supporting Tables Script
 *
 * Queries database to check current state of empty supporting tables
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import {
  ipos,
  documents,
  ipoScores,
  peerCompanies,
  ipoReviews,
  marketHolidays
} from '../lib/db';
import { sql } from 'drizzle-orm';

async function checkEmptyTables() {
  console.log('\n📊 Checking Empty Supporting Tables...\n');
  console.log('='.repeat(60));

  try {
    // Count IPOs
    const ipoCount = await db.select({ count: sql<number>`count(*)::int` }).from(ipos);
    console.log(`\n✓ IPOs: ${ipoCount[0].count} records`);

    // Count market holidays
    const holidayCount = await db.select({ count: sql<number>`count(*)::int` }).from(marketHolidays);
    console.log(`✓ Market Holidays: ${holidayCount[0].count} records`);

    // Count documents
    const docCount = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
    const docStatus = docCount[0].count === 0 ? '❌ (EMPTY)' : '✅';
    console.log(`\n${docStatus} Documents: ${docCount[0].count} records`);

    // Count IPO scores
    const scoreCount = await db.select({ count: sql<number>`count(*)::int` }).from(ipoScores);
    const scoreStatus = scoreCount[0].count === 0 ? '❌ (EMPTY)' : '✅';
    console.log(`${scoreStatus} IPO Scores: ${scoreCount[0].count} records`);

    // Count peer companies
    const peerCount = await db.select({ count: sql<number>`count(*)::int` }).from(peerCompanies);
    const peerStatus = peerCount[0].count === 0 ? '❌ (EMPTY)' : '✅';
    console.log(`${peerStatus} Peer Companies: ${peerCount[0].count} records`);

    // Count IPO reviews
    const reviewCount = await db.select({ count: sql<number>`count(*)::int` }).from(ipoReviews);
    const reviewStatus = reviewCount[0].count === 0 ? '❌ (EMPTY)' : '✅';
    console.log(`${reviewStatus} IPO Reviews: ${reviewCount[0].count} records`);

    console.log('\n' + '='.repeat(60));
    console.log('\n📈 Summary:');
    console.log(`   Total IPOs: ${ipoCount[0].count}`);
    console.log(`   Market Holidays: ${holidayCount[0].count} ${holidayCount[0].count > 0 ? '✅' : '❌'}`);
    console.log(`   Documents: ${docCount[0].count} ${docCount[0].count > 0 ? '✅' : '❌'}`);
    console.log(`   IPO Scores: ${scoreCount[0].count} ${scoreCount[0].count > 0 ? '✅' : '❌'}`);
    console.log(`   Peer Companies: ${peerCount[0].count} ${peerCount[0].count > 0 ? '✅' : '❌'}`);
    console.log(`   IPO Reviews: ${reviewCount[0].count} ${reviewCount[0].count > 0 ? '✅' : '❌'}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Error checking tables:', error);
    throw error;
  }
}

checkEmptyTables()
  .then(() => {
    console.log('✓ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Check failed:', error);
    process.exit(1);
  });
