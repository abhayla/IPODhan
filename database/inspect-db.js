const { Client } = require('pg');

const client = new Client({
  host: '103.118.16.189',
  port: 5432,
  user: 'postgres',
  password: 'Papa3Monu@1234',
  database: 'ipodhan',
  connectionTimeoutMillis: 10000,
});

async function inspectDatabase() {
  try {
    await client.connect();
    console.log('Connected to ipodhan database\n');

    // Get all tables
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    if (tablesRes.rows.length === 0) {
      console.log('No tables found in database.');
    } else {
      console.log('Existing tables:');
      for (const row of tablesRes.rows) {
        console.log(`\n=== ${row.table_name} ===`);

        // Get columns for this table
        const columnsRes = await client.query(`
          SELECT column_name, data_type, character_maximum_length, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [row.table_name]);

        columnsRes.rows.forEach(col => {
          const type = col.character_maximum_length
            ? `${col.data_type}(${col.character_maximum_length})`
            : col.data_type;
          console.log(`  ${col.column_name}: ${type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
        });
      }
    }

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

inspectDatabase();
