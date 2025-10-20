/**
 * Phase 1 - Test 2: Schema Verification
 * Runs queries from APPENDIX-B Schema Verification section
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function runSchemaVerification() {
  console.log('🔍 Phase 1 - Test 2: Schema Verification\n');
  console.log('⚠️  Running against VPS database: 103.118.16.189:5432/ipodhan\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Query 1: Verify Indexes and Foreign Keys
    console.log('📊 Query 1: Verify Indexes and Foreign Keys');
    console.log('='.repeat(60));
    const indexes = await pool.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);
    console.log(`Found ${indexes.rows.length} indexes:\n`);

    // Group by table
    const indexesByTable = {};
    indexes.rows.forEach(row => {
      if (!indexesByTable[row.tablename]) {
        indexesByTable[row.tablename] = [];
      }
      indexesByTable[row.tablename].push(row.indexname);
    });

    Object.entries(indexesByTable).forEach(([table, idxs]) => {
      console.log(`  ${table}:`);
      idxs.forEach(idx => console.log(`    - ${idx}`));
    });

    // Query 2: Check indexes are used
    console.log('\n📊 Query 2: Index Usage Statistics');
    console.log('='.repeat(60));
    const indexUsage = await pool.query(`
      SELECT
        schemaname,
        relname as tablename,
        indexrelname as indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE relname IN ('ipos', 'subscriptions', 'gmp_records')
      ORDER BY idx_scan DESC;
    `);

    if (indexUsage.rows.length === 0) {
      console.log('⚠️  No index usage stats found for ipos, subscriptions, gmp_records');
    } else {
      console.log('Index usage (sorted by scan count):');
      indexUsage.rows.forEach(row => {
        console.log(`  ${row.tablename}.${row.indexname}: ${row.idx_scan} scans, ${row.idx_tup_read} tuples read`);
      });
    }

    // Query 3: Schema Validation - Segment & Offering Type
    console.log('\n📊 Query 3: Segment & Offering Type Validation');
    console.log('='.repeat(60));

    const segments = await pool.query(`
      SELECT DISTINCT segment FROM ipos ORDER BY segment;
    `);

    console.log('Segments found in database:');
    segments.rows.forEach(row => {
      console.log(`  - ${row.segment || 'NULL'}`);
    });

    const offeringTypes = await pool.query(`
      SELECT DISTINCT offering_type FROM ipos ORDER BY offering_type;
    `);

    console.log('\nOffering Types found in database:');
    offeringTypes.rows.forEach(row => {
      console.log(`  - ${row.offering_type || 'NULL'}`);
    });

    // Check for expected values
    const expectedSegments = ['MAINBOARD', 'SME'];
    const foundSegments = segments.rows.map(r => r.segment).filter(Boolean);
    const missingSegments = expectedSegments.filter(s => !foundSegments.includes(s));

    const expectedOfferingTypes = ['IPO', 'RIGHTS', 'NCD', 'FPO', 'OFS'];
    const foundOfferingTypes = offeringTypes.rows.map(r => r.offering_type).filter(Boolean);
    const missingOfferingTypes = expectedOfferingTypes.filter(t => !foundOfferingTypes.includes(t));

    if (missingSegments.length > 0) {
      console.log(`\n⚠️  Missing segments: ${missingSegments.join(', ')}`);
    }
    if (missingOfferingTypes.length > 0) {
      console.log(`⚠️  Missing offering types: ${missingOfferingTypes.join(', ')}`);
      console.log('   Note: These may need to be added to schema enum if required');
    }
    if (missingSegments.length === 0 && missingOfferingTypes.length === 0) {
      console.log('\n✅ All expected segments and offering types found');
    }

    // Additional: Check critical indexes exist
    console.log('\n📊 Critical Index Validation');
    console.log('='.repeat(60));
    const criticalIndexes = await pool.query(`
      SELECT
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('ipos', 'subscriptions', 'gmp_records')
      AND indexname IN ('ipos_slug_idx', 'ipos_status_category_idx', 'subscriptions_ipo_id_idx', 'gmp_records_ipo_id_idx')
      ORDER BY tablename, indexname;
    `);

    const expectedIndexes = {
      'ipos': ['ipos_slug_idx', 'ipos_status_category_idx'],
      'subscriptions': ['subscriptions_ipo_id_idx'],
      'gmp_records': ['gmp_records_ipo_id_idx']
    };

    console.log('Critical indexes check:');
    Object.entries(expectedIndexes).forEach(([table, expectedIdxs]) => {
      expectedIdxs.forEach(idx => {
        const found = criticalIndexes.rows.find(r => r.indexname === idx);
        if (found) {
          console.log(`  ✅ ${table}.${idx} - EXISTS`);
        } else {
          console.log(`  ❌ ${table}.${idx} - MISSING`);
        }
      });
    });

    console.log('\n✅ Schema verification complete\n');

  } catch (error) {
    console.error('❌ Error during schema verification:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSchemaVerification().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
