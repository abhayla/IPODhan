/**
 * Test Database Connection
 * Story 10.5: Verify database credentials and connection
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

// Load .env.local explicitly
const envPath = resolve(__dirname, '../.env.local');
const result = config({ path: envPath });

console.log('='.repeat(70));
console.log('DATABASE CONNECTION TEST');
console.log('='.repeat(70));
console.log('');

console.log('Environment file:', envPath);
console.log('dotenv result:', result.parsed ? 'Loaded' : 'Not found');
console.log('');

console.log('Database Configuration:');
console.log('-'.repeat(50));
console.log('DATABASE_HOST:', process.env.DATABASE_HOST || 'NOT SET');
console.log('DATABASE_PORT:', process.env.DATABASE_PORT || 'NOT SET');
console.log('DATABASE_NAME:', process.env.DATABASE_NAME || 'NOT SET');
console.log('DATABASE_USER:', process.env.DATABASE_USER || 'NOT SET');
console.log('DATABASE_PASSWORD:', process.env.DATABASE_PASSWORD ? '***' + process.env.DATABASE_PASSWORD.slice(-4) : 'NOT SET');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '***' : 'NOT SET');
console.log('-'.repeat(50));
console.log('');

// Test connection with individual parameters
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  connectionTimeoutMillis: 5000,
});

async function testConnection() {
  try {
    console.log('Attempting database connection...');
    const client = await pool.connect();
    console.log('✓ Connection successful!');

    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✓ Query successful!');
    console.log('');
    console.log('Database Info:');
    console.log('  Current Time:', result.rows[0].current_time);
    console.log('  PostgreSQL Version:', result.rows[0].pg_version.split(',')[0]);

    client.release();
    await pool.end();

    console.log('');
    console.log('✓ Database connection test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('✗ Database connection test FAILED:');
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

testConnection();
