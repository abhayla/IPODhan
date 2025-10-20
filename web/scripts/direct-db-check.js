// Direct database check with hardcoded connection
const { Pool } = require('pg');

async function checkDatabase() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan',
  });

  try {
    console.log('🔍 Checking database tables at 103.118.16.189...\n');

    // Test connection
    const testResult = await pool.query('SELECT version()');
    console.log('✅ Connection successful!');
    console.log(`📍 PostgreSQL Version: ${testResult.rows[0].version.split(',')[0]}\n`);

    // List all tables
    const tablesResult = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    if (tablesResult.rows.length === 0) {
      console.log('❌ NO TABLES FOUND in public schema');
      console.log('The database "ipodhan" exists but contains NO TABLES.\n');
      return;
    }

    console.log(`✅ Found ${tablesResult.rows.length} tables in database:\n`);
    tablesResult.rows.forEach((row, index) => {
      console.log(`  ${(index + 1).toString().padStart(2)}. ${row.tablename}`);
    });

    // Check counts
    console.log('\n📊 Record counts:');
    for (const row of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${row.tablename}"`);
        const count = countResult.rows[0].count;
        console.log(`  ${row.tablename.padEnd(30)} : ${count.toString().padStart(6)} records`);
      } catch (err) {
        console.log(`  ${row.tablename.padEnd(30)} : ERROR`);
      }
    }

  } catch (error) {
    console.error('❌ Error connecting to database:');
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

checkDatabase().catch(console.error);
