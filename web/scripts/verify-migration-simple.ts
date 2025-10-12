import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function verifyMigration() {
  const client = await pool.connect();

  try {
    console.log('Verifying migration 0006...\n');

    // Check FPO enum value
    const enumCheck = await client.query(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'ipo_category'
      ORDER BY e.enumsortorder
    `);

    console.log('1. IPO Categories:');
    enumCheck.rows.forEach(row => console.log(`   - ${row.enumlabel}`));
    const hasFPO = enumCheck.rows.some(r => r.enumlabel === 'FPO');
    console.log(`   ✅ FPO present: ${hasFPO ? 'YES' : 'NO'}\n`);

    // Check columns
    const colCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'listing_performance'
      AND column_name IN ('current_price', 'current_price_bse', 'current_price_nse')
      ORDER BY column_name
    `);

    console.log('2. Listing Performance Columns:');
    colCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    const hasBS = colCheck.rows.some(r => r.column_name === 'current_price_bse');
    const hasNSE = colCheck.rows.some(r => r.column_name === 'current_price_nse');
    console.log(`   ✅ current_price_bse present: ${hasBS ? 'YES' : 'NO'}`);
    console.log(`   ✅ current_price_nse present: ${hasNSE ? 'YES' : 'NO'}\n`);

    // Check comments
    const commentCheck = await client.query(`
      SELECT col_description(
        (SELECT oid FROM pg_class WHERE relname = 'listing_performance'),
        (SELECT ordinal_position FROM information_schema.columns
         WHERE table_name = 'listing_performance' AND column_name = $1)
      ) as comment
    `, ['current_price_bse']);

    console.log('3. Column Comments:');
    console.log(`   - current_price_bse: ${commentCheck.rows[0]?.comment || 'none'}`);

    console.log('\n✅ Migration verification complete!');

  } catch (err) {
    console.error('\n❌ Verification failed:', err instanceof Error ? err.message : err);
  } finally {
    client.release();
    await pool.end();
  }
}

verifyMigration();
