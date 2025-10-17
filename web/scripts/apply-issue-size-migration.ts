import { config } from 'dotenv';
import { resolve } from 'path';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

async function applyMigration() {
  try {
    console.log('Applying migration: Increase issue_size precision...');

    // Step 1: Alter column type
    await db.execute(sql`ALTER TABLE ipos ALTER COLUMN issue_size TYPE NUMERIC(15, 2)`);
    console.log('✅ Column type changed from NUMERIC(10,2) to NUMERIC(15,2)');

    // Step 2: Add CHECK constraint (if it doesn't exist)
    try {
      await db.execute(sql`ALTER TABLE ipos ADD CONSTRAINT ipos_issue_size_positive CHECK (issue_size >= 0)`);
      console.log('✅ CHECK constraint added');
    } catch (error: any) {
      if (error.code === '42710') {
        console.log('⚠️ CHECK constraint already exists - skipping');
      } else {
        throw error;
      }
    }

    // Step 3: Verify the change
    const result = await db.execute(sql`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'ipos' AND column_name = 'issue_size'
    `);

    console.log('\n✅ Migration completed successfully!');
    console.log('Verification:', result);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
