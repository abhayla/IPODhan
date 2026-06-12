const { Pool } = require('pg');

async function checkIPODistribution() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check status and category distribution
    const distResult = await pool.query(`
      SELECT status, category, COUNT(*) as count
      FROM ipos
      GROUP BY status, category
      ORDER BY status, category
    `);

    console.log('📊 IPO Status & Category Distribution:\n');
    distResult.rows.forEach(row => {
      const status = (row.status || 'NULL').padEnd(10);
      const category = (row.category || 'NULL').padEnd(12);
      console.log(`  ${status} | ${category} : ${row.count} IPOs`);
    });

    // Test the exact query that the API is using
    console.log('\n🔍 Testing API query: status=OPEN, category=MAINBOARD, limit=10\n');

    const apiQuery = await pool.query(`
      SELECT id, company_name, status, category, slug
      FROM ipos
      WHERE status = 'OPEN' AND category = 'MAINBOARD'
      LIMIT 10
    `);

    if (apiQuery.rows.length === 0) {
      console.log('❌ NO RESULTS - This explains the API error!');
      console.log('   Query succeeded but returned 0 rows.');
    } else {
      console.log(`✅ Found ${apiQuery.rows.length} IPOs:`);
      apiQuery.rows.forEach((ipo, i) => {
        console.log(`  ${i+1}. ${ipo.company_name} (${ipo.status}/${ipo.category})`);
      });
    }

    // Check what statuses and categories actually exist
    console.log('\n📋 Actual distinct values in database:\n');
    const statusesResult = await pool.query(`SELECT DISTINCT status FROM ipos ORDER BY status`);
    console.log('Statuses:', statusesResult.rows.map(r => r.status).join(', '));

    const categoriesResult = await pool.query(`SELECT DISTINCT category FROM ipos ORDER BY category`);
    console.log('Categories:', categoriesResult.rows.map(r => r.category).join(', '));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkIPODistribution().catch(console.error);
