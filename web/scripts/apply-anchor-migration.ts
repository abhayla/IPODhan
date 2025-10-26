import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';
import { readFileSync } from 'fs';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

async function applyMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Applying anchor_investors migration...');

    const sql = readFileSync(
      resolve(process.cwd(), 'drizzle/migrations/0022_add_anchor_investors.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ Migration applied successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
