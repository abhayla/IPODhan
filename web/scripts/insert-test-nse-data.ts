import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function insertTestData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('📝 Inserting test NSE data for Orkla India Limited...\n');

    // Get Orkla IPO ID
    const ipoQuery = await pool.query(`
      SELECT id FROM ipos WHERE slug = 'orkla-india-limited' LIMIT 1;
    `);

    if (ipoQuery.rows.length === 0) {
      console.error('❌ Orkla India Limited not found in database');
      process.exit(1);
    }

    const ipoId = ipoQuery.rows[0].id;
    console.log('✅ Found IPO ID:', ipoId);

    // Insert test ipo_details record
    const insertQuery = `
      INSERT INTO ipo_details (
        ipo_id,
        data_source,
        sponsor_banks,
        max_retail_subscription,
        max_employee_subscription,
        employee_discount,
        tick_size,
        ipo_market_timings,
        category_details,
        upi_cutoff_time
      ) VALUES (
        $1,
        'NSE',
        ARRAY['ICICI Bank', 'HDFC Bank', 'Kotak Mahindra Bank'],
        200000.00,
        500000.00,
        69.00,
        1.00,
        '10:00 AM - 5:00 PM',
        '{"retail": "IND", "employee": "EMP", "qib": "QIB", "nii": "NII"}'::jsonb,
        '5:00 PM on Close Date'
      )
      ON CONFLICT (ipo_id) DO UPDATE SET
        sponsor_banks = EXCLUDED.sponsor_banks,
        max_retail_subscription = EXCLUDED.max_retail_subscription,
        max_employee_subscription = EXCLUDED.max_employee_subscription,
        employee_discount = EXCLUDED.employee_discount,
        tick_size = EXCLUDED.tick_size,
        ipo_market_timings = EXCLUDED.ipo_market_timings,
        category_details = EXCLUDED.category_details,
        upi_cutoff_time = EXCLUDED.upi_cutoff_time,
        updated_at = NOW();
    `;

    await pool.query(insertQuery, [ipoId]);
    console.log('✅ Test data inserted successfully!');

    // Verify
    const verifyQuery = await pool.query(`
      SELECT sponsor_banks, max_retail_subscription, tick_size
      FROM ipo_details
      WHERE ipo_id = $1;
    `, [ipoId]);

    console.log('\n📊 Verification:');
    console.log('   Sponsor Banks:', verifyQuery.rows[0]?.sponsor_banks);
    console.log('   Max Retail Sub:', verifyQuery.rows[0]?.max_retail_subscription);
    console.log('   Tick Size:', verifyQuery.rows[0]?.tick_size);

    console.log('\n✅ Test data ready for UI verification!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

insertTestData();
