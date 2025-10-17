// AC Validation Script for Story 10.5
import { getDb } from './lib/db/index.js';
import { sql } from 'drizzle-orm';

async function runACValidation() {
  console.log('=== Story 10.5 AC Validation ===\n');

  try {
    const db = await getDb();

    // AC-1: Check financial data count (expect 150)
    console.log('AC-1: Checking financial data population...');
    const financialCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM ipo_financials
    `);
    const count = financialCount.rows[0].count;
    const ac1Pass = count >= 150;
    console.log(`  - Financial records: ${count}`);
    console.log(`  - Status: ${ac1Pass ? 'PASS ✓' : 'FAIL ✗'}\n`);

    // AC-5: Check for orphaned records (expect 0)
    console.log('AC-5: Checking foreign key integrity...');
    const orphanedRecords = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM ipo_financials f
      WHERE NOT EXISTS (
        SELECT 1 FROM ipos i WHERE i.id = f.ipo_id
      )
    `);
    const orphanCount = orphanedRecords.rows[0].count;
    const ac5Pass = orphanCount === 0;
    console.log(`  - Orphaned records: ${orphanCount}`);
    console.log(`  - Status: ${ac5Pass ? 'PASS ✓' : 'FAIL ✗'}\n`);

    // AC-6: Test API response for specific IPO
    console.log('AC-6: Testing API response structure...');
    const testIPO = await db.execute(sql`
      SELECT i.slug, i.company_name,
             f.revenue_cy, f.profit_cy, f.pe_ratio
      FROM ipos i
      LEFT JOIN ipo_financials f ON i.id = f.ipo_id
      WHERE i.slug = 'royal-technology-enterprises'
      LIMIT 1
    `);

    if (testIPO.rows.length > 0) {
      const row = testIPO.rows[0];
      const hasFinancials = row.revenue_cy !== null || row.profit_cy !== null;
      console.log(`  - IPO: ${row.company_name}`);
      console.log(`  - Slug: ${row.slug}`);
      console.log(`  - Has Financials: ${hasFinancials ? 'Yes' : 'No'}`);
      console.log(`  - Revenue CY: ${row.revenue_cy || 'N/A'}`);
      console.log(`  - Profit CY: ${row.profit_cy || 'N/A'}`);
      console.log(`  - PE Ratio: ${row.pe_ratio || 'N/A'}`);
      console.log(`  - Status: ${hasFinancials ? 'PASS ✓' : 'FAIL ✗'}\n`);
    } else {
      console.log(`  - Status: FAIL ✗ (IPO not found)\n`);
    }

    // Summary
    console.log('=== VALIDATION SUMMARY ===');
    console.log(`AC-1 (Financial Data): ${ac1Pass ? 'PASS' : 'FAIL'}`);
    console.log(`AC-5 (Foreign Keys): ${ac5Pass ? 'PASS' : 'FAIL'}`);
    console.log(`AC-6 (API Structure): ${testIPO.rows.length > 0 && (testIPO.rows[0].revenue_cy !== null || testIPO.rows[0].profit_cy !== null) ? 'PASS' : 'FAIL'}`);

    const allPass = ac1Pass && ac5Pass && testIPO.rows.length > 0;
    console.log(`\nOVERALL: ${allPass ? 'PASS ✓' : 'FAIL ✗'}`);

    process.exit(allPass ? 0 : 1);
  } catch (error) {
    console.error('Error during AC validation:', error);
    process.exit(1);
  }
}

runACValidation();
