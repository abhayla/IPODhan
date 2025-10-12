import { db } from '../lib/db/index';
import { sql } from 'drizzle-orm';

async function verifyMigration() {
  try {
    console.log('Verifying migration 0006...\n');

    // Check FPO category exists
    console.log('1. Checking IPO categories enum:');
    const categories = await db.execute(
      sql`SELECT unnest(enum_range(NULL::ipo_category)) as category`
    );
    console.log('   Categories:', categories.rows.map((r: any) => r.category).join(', '));
    const hasFPO = categories.rows.some((r: any) => r.category === 'FPO');
    console.log('   FPO exists:', hasFPO ? '✓ YES' : '✗ NO\n');

    // Check listing_performance columns
    console.log('\n2. Checking listing_performance table columns:');
    const columns = await db.execute(
      sql`SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = 'listing_performance'
          AND column_name IN ('current_price', 'current_price_bse', 'current_price_nse')
          ORDER BY ordinal_position`
    );

    columns.rows.forEach((col: any) => {
      console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    const hasBSE = columns.rows.some((r: any) => r.column_name === 'current_price_bse');
    const hasNSE = columns.rows.some((r: any) => r.column_name === 'current_price_nse');
    console.log('\n   current_price_bse exists:', hasBSE ? '✓ YES' : '✗ NO');
    console.log('   current_price_nse exists:', hasNSE ? '✓ YES' : '✗ NO');

    // Check column comments
    console.log('\n3. Checking column comments:');
    const comments = await db.execute(
      sql`SELECT
            a.attname AS column_name,
            d.description AS comment
          FROM pg_class c
          JOIN pg_attribute a ON a.attrelid = c.oid
          LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
          WHERE c.relname = 'listing_performance'
          AND a.attname IN ('current_price', 'current_price_bse', 'current_price_nse')
          AND d.description IS NOT NULL`
    );

    if (comments.rows.length > 0) {
      comments.rows.forEach((comment: any) => {
        console.log(`   - ${comment.column_name}: ${comment.comment}`);
      });
    } else {
      console.log('   No comments found (comments may be optional)');
    }

    // Check data migration
    console.log('\n4. Checking data migration:');
    const dataCheck = await db.execute(
      sql`SELECT
            COUNT(*) as total_records,
            COUNT(current_price) as has_current_price,
            COUNT(current_price_bse) as has_bse,
            COUNT(current_price_nse) as has_nse
          FROM listing_performance`
    );

    const stats = dataCheck.rows[0] as any;
    console.log(`   Total records: ${stats.total_records}`);
    console.log(`   Records with current_price: ${stats.has_current_price}`);
    console.log(`   Records with current_price_bse: ${stats.has_bse}`);
    console.log(`   Records with current_price_nse: ${stats.has_nse}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('MIGRATION VERIFICATION SUMMARY:');
    console.log('='.repeat(60));
    const allChecks = hasFPO && hasBSE && hasNSE;
    if (allChecks) {
      console.log('✓ ALL CHECKS PASSED - Migration successful!');
    } else {
      console.log('✗ SOME CHECKS FAILED - Migration incomplete');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('Error verifying migration:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

verifyMigration();
