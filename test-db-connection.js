const { Client } = require('pg');

const client = new Client({
  host: '103.118.16.189',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'postgres',
  connectionTimeoutMillis: 10000,
});

async function testConnection() {
  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✓ Connected successfully!');

    // Check if ipodhan database exists
    const res = await client.query(
      "SELECT datname FROM pg_database WHERE datname = 'ipodhan'"
    );

    if (res.rows.length > 0) {
      console.log('✓ Database "ipodhan" already exists');
    } else {
      console.log('✗ Database "ipodhan" does not exist');
      console.log('  Creating database...');
      await client.query('CREATE DATABASE ipodhan');
      console.log('✓ Database "ipodhan" created successfully');
    }

    await client.end();
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
}

testConnection();
