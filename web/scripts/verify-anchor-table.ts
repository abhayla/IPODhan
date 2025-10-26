import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

async function verifyTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Verifying anchor_investors table...');

    // Check table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'anchor_investors'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('❌ Table anchor_investors does not exist');
      process.exit(1);
    }

    // Get columns
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'anchor_investors'
      ORDER BY ordinal_position;
    `);

    console.log('\n✅ Table anchor_investors exists with columns:');
    columns.rows.forEach((col) => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'anchor_investors';
    `);

    console.log('\n✅ Indexes:');
    indexes.rows.forEach((idx) => {
      console.log(`  - ${idx.indexname}`);
    });

    // Check foreign key
    const fks = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'anchor_investors';
    `);

    console.log('\n✅ Foreign Keys:');
    fks.rows.forEach((fk) => {
      console.log(`  - ${fk.constraint_name}: ${fk.column_name} -> ${fk.foreign_table_name}(${fk.foreign_column_name})`);
    });

    console.log('\n✅ All verifications passed!');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyTable();
