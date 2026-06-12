const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: '103.118.16.189',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'ipodhan',
  connectionTimeoutMillis: 10000,
});

async function createSchema() {
  try {
    console.log('Connecting to ipodhan database...');
    await client.connect();
    console.log('✓ Connected successfully!');

    // Read schema SQL file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('\nExecuting schema creation...');
    await client.query(schemaSql);
    console.log('✓ Schema created successfully!');

    // Verify tables created
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log('\n✓ Tables created:');
    res.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify views created
    const viewsRes = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('\n✓ Views created:');
    viewsRes.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    await client.end();
    console.log('\n✓ Database schema setup complete!');
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

createSchema();
