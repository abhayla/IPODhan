const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkAffiliateClicks() {
  try {
    // Get latest 5 affiliate clicks
    const result = await pool.query(`
      SELECT
        id,
        broker,
        source,
        ipo_id,
        clicked_at
      FROM affiliate_clicks
      ORDER BY clicked_at DESC
      LIMIT 5
    `);

    console.log('Latest Affiliate Clicks:');
    console.log('========================');
    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. Broker: ${row.broker}`);
      console.log(`   Source: ${row.source}`);
      console.log(`   IPO ID: ${row.ipo_id || 'N/A'}`);
      console.log(`   Clicked At: ${row.clicked_at}`);
      console.log('');
    });

    // Count by broker
    const counts = await pool.query(`
      SELECT broker, COUNT(*) as click_count
      FROM affiliate_clicks
      GROUP BY broker
      ORDER BY broker
    `);

    console.log('Total Clicks by Broker:');
    console.log('=======================');
    counts.rows.forEach(row => {
      console.log(`${row.broker}: ${row.click_count} clicks`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkAffiliateClicks();
