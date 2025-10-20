const { Pool } = require('pg');

async function checkSchema() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan',
  });

  try {
    console.log('🔍 Checking "ipos" table schema in database...\n');

    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ipos'
      ORDER BY ordinal_position
    `);

    console.log(`Found ${result.rows.length} columns:\n`);
    result.rows.forEach((col, i) => {
      const num = (i + 1).toString().padStart(2);
      const name = col.column_name.padEnd(35);
      const type = col.data_type.padEnd(25);
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`  ${num}. ${name} ${type} ${nullable}`);
    });

    // Check if segment or offering_type exist (Story 11.8)
    const hasSegment = result.rows.some(r => r.column_name === 'segment');
    const hasOfferingType = result.rows.some(r => r.column_name === 'offering_type');
    const hasCategory = result.rows.some(r => r.column_name === 'category');

    console.log('\n📋 Story 11.8 Migration Status:');
    console.log(`  segment column:        ${hasSegment ? '✅ EXISTS' : '❌ NOT FOUND'}`);
    console.log(`  offering_type column:  ${hasOfferingType ? '✅ EXISTS' : '❌ NOT FOUND'}`);
    console.log(`  category column:       ${hasCategory ? '✅ EXISTS' : '❌ NOT FOUND (OLD SCHEMA)'}`);

    if (hasSegment && hasOfferingType && !hasCategory) {
      console.log('\n✅ Database has NEW schema (segment + offering_type)');
      console.log('⚠️  But code expects OLD schema (category column)');
      console.log('🔧 SOLUTION: Code needs to be updated to use segment + offering_type');
    } else if (hasCategory && !hasSegment && !hasOfferingType) {
      console.log('\n✅ Database has OLD schema (category column)');
      console.log('✅ Code matches database');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema().catch(console.error);
