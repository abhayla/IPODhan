// Direct check if tables exist in database
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function checkTables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔍 Checking database tables...\n');
    console.log(`Connected to: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

    // List all tables in public schema
    const result = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    if (result.rows.length === 0) {
      console.log('❌ NO TABLES FOUND in public schema\n');
      console.log('The database exists but is completely empty.');
    } else {
      console.log(`✅ Found ${result.rows.length} tables:\n`);
      result.rows.forEach((row, index) => {
        console.log(`  ${(index + 1).toString().padStart(2)}. ${row.tablename}`);
      });

      // Now check counts for each table
      console.log('\n📊 Record counts:');
      for (const row of result.rows) {
        try {
          const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${row.tablename}`);
          console.log(`  ${row.tablename.padEnd(30)} : ${countResult.rows[0].count} records`);
        } catch (err) {
          console.log(`  ${row.tablename.padEnd(30)} : ERROR - ${err.message}`);
        }
      }
    }

    // Check enums
    console.log('\n🔖 Checking enums:');
    const enumResult = await pool.query(`
      SELECT t.typname as enum_name
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      GROUP BY t.typname
      ORDER BY t.typname;
    `);

    if (enumResult.rows.length > 0) {
      console.log(`Found ${enumResult.rows.length} enums:`);
      enumResult.rows.forEach(row => {
        console.log(`  - ${row.enum_name}`);
      });
    } else {
      console.log('No enums found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTables().catch(console.error);
