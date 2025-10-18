#!/usr/bin/env tsx
/**
 * Phase 3.1: Select sample IPOs for field verification
 */
import { getDb } from '../lib/db/index.js';
import { sql } from 'drizzle-orm';

async function selectSampleIPOs() {
  const db = await getDb();

  console.log('=== Phase 3.1: Sample IPO Selection ===\n');

  const statuses = ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'];
  const samples = new Map();

  for (const status of statuses) {
    const result = await db.execute(sql`
      SELECT
        id,
        company_name,
        slug,
        status,
        category,
        listing_exchanges,
        open_date,
        close_date,
        listing_date,
        last_scraped_at
      FROM ipos
      WHERE status = ${status}
      ORDER BY last_scraped_at DESC NULLS LAST, created_at DESC
      LIMIT 5
    `);
    samples.set(status, result.rows);

    console.log(`${status} IPOs (Sample: ${result.rows.length}):`);
    result.rows.forEach((ipo: any, idx: number) => {
      console.log(`  ${idx + 1}. ${ipo.company_name} (${ipo.slug})`);
      console.log(`     Category: ${ipo.category} | Exchanges: ${ipo.listing_exchanges}`);
      console.log(`     Last Scraped: ${ipo.last_scraped_at || 'Never'}`);
    });
    console.log('');
  }

  // Summary
  const totalSamples = Array.from(samples.values()).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Total Sample IPOs Selected: ${totalSamples}`);

  // Return sample IDs for next phase
  const sampleIds = Array.from(samples.values()).flat().map((ipo: any) => ipo.id);
  console.log(`\nSample IDs for Phase 3.2: ${sampleIds.slice(0, 5).join(', ')}...`);

  process.exit(0);
}

selectSampleIPOs().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
