// Direct AC Validation Script for Story 10.5
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.local') });

const { Pool } = pg;

async function runACValidation() {
  console.log('=== Story 10.5 AC Validation ===\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // AC-1: Check financial data count (expect 150)
    console.log('AC-1: Checking financial data population...');
    const financialResult = await pool.query('SELECT COUNT(*) as count FROM ipo_financials');
    const count = parseInt(financialResult.rows[0].count);
    const ac1Pass = count >= 150;
    console.log(`  - Financial records: ${count}`);
    console.log(`  - Expected: >= 150`);
    console.log(`  - Status: ${ac1Pass ? 'PASS ✓' : 'FAIL ✗'}\n`);

    // AC-5: Check for orphaned records (expect 0)
    console.log('AC-5: Checking foreign key integrity...');
    const orphanedResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipo_financials f
      WHERE NOT EXISTS (
        SELECT 1 FROM ipos i WHERE i.id = f.ipo_id
      )
    `);
    const orphanCount = parseInt(orphanedResult.rows[0].count);
    const ac5Pass = orphanCount === 0;
    console.log(`  - Orphaned records: ${orphanCount}`);
    console.log(`  - Expected: 0`);
    console.log(`  - Status: ${ac5Pass ? 'PASS ✓' : 'FAIL ✗'}\n`);

    // AC-6: Test API response structure for specific IPO
    console.log('AC-6: Testing financial data presence...');
    const testIPOResult = await pool.query(`
      SELECT i.slug, i.company_name,
             f.revenue_fy1, f.revenue_fy2, f.revenue_fy3,
             f.profit_fy1, f.profit_fy2, f.profit_fy3,
             f.pe_ratio, f.roe_percentage, f.roce_percentage
      FROM ipos i
      LEFT JOIN ipo_financials f ON i.id = f.ipo_id
      WHERE i.slug = 'royal-technology-enterprises'
      LIMIT 1
    `);

    let ac6Pass = false;
    if (testIPOResult.rows.length > 0) {
      const row = testIPOResult.rows[0];
      const hasFinancials = row.revenue_fy1 !== null || row.profit_fy1 !== null;
      console.log(`  - IPO: ${row.company_name}`);
      console.log(`  - Slug: ${row.slug}`);
      console.log(`  - Has Financials: ${hasFinancials ? 'Yes' : 'No'}`);
      console.log(`  - Revenue FY1: ${row.revenue_fy1 || 'N/A'}`);
      console.log(`  - Profit FY1: ${row.profit_fy1 || 'N/A'}`);
      console.log(`  - PE Ratio: ${row.pe_ratio || 'N/A'}`);
      console.log(`  - ROE %: ${row.roe_percentage || 'N/A'}`);
      console.log(`  - ROCE %: ${row.roce_percentage || 'N/A'}`);
      ac6Pass = hasFinancials;
      console.log(`  - Status: ${ac6Pass ? 'PASS ✓' : 'FAIL ✗'}\n`);
    } else {
      console.log(`  - Status: FAIL ✗ (IPO not found)\n`);
    }

    // Additional Check: Sample of IPOs with financials
    console.log('Additional: Checking sample of IPOs with financial data...');
    const sampleResult = await pool.query(`
      SELECT i.company_name, f.revenue_fy1, f.profit_fy1
      FROM ipos i
      INNER JOIN ipo_financials f ON i.id = f.ipo_id
      WHERE f.revenue_fy1 IS NOT NULL
      LIMIT 5
    `);
    console.log(`  - Sample count: ${sampleResult.rows.length}`);
    sampleResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.company_name}: Revenue=${row.revenue_fy1}, Profit=${row.profit_fy1}`);
    });
    console.log('');

    // Summary
    console.log('=== VALIDATION SUMMARY ===');
    console.log(`AC-1 (Financial Data Count): ${ac1Pass ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`AC-5 (Foreign Key Integrity): ${ac5Pass ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`AC-6 (API Data Structure): ${ac6Pass ? 'PASS ✓' : 'FAIL ✗'}`);

    const allPass = ac1Pass && ac5Pass && ac6Pass;
    console.log(`\n=== OVERALL: ${allPass ? 'PASS ✓✓✓' : 'FAIL ✗✗✗'} ===`);

    await pool.end();
    process.exit(allPass ? 0 : 1);
  } catch (error) {
    console.error('Error during AC validation:', error.message);
    await pool.end();
    process.exit(1);
  }
}

runACValidation();
