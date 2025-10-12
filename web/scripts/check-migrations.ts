import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function checkMigrations() {
  try {
    const result = await pool.query(
      'SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 10'
    );

    console.log('Applied migrations:');
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.hash} (created: ${row.created_at})`);
    });

    // Check for migration 0006
    const hasMigration6 = result.rows.some(row => row.hash.includes('0006'));
    console.log(`\nMigration 0006 applied: ${hasMigration6 ? 'YES' : 'NO'}`);

  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  } finally {
    await pool.end();
  }
}

checkMigrations();
