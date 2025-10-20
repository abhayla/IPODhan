// Load environment variables if running from scripts (not Next.js)
// Next.js automatically loads .env files, but standalone scripts need this
if (typeof window === 'undefined' && !process.env.NEXT_RUNTIME) {
  try {
    const { config } = require('dotenv');
    const { resolve } = require('path');
    config({ path: resolve(process.cwd(), '.env.local') });
  } catch (error) {
    // Dotenv might not be available in all contexts, that's okay
  }
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Debug: Log environment variable status at module load time
const hasEnvVars = !!(process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD);
if (!hasEnvVars && !process.env.DATABASE_URL) {
  console.warn('⚠️  WARNING: No database configuration found in environment variables!');
  console.warn('Make sure DATABASE_URL or individual DATABASE_* vars are set');
  console.warn('Current directory:', process.cwd());
  console.warn('Available env keys:', Object.keys(process.env).filter(k => k.includes('DATABASE')).join(', '));
}

// Create PostgreSQL connection pool
// Use individual parameters if DATABASE_URL has special characters, otherwise use connectionString
const pool = new Pool(
  process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
    ? {
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT || '5432'),
        database: process.env.DATABASE_NAME || 'ipodhan',
        user: process.env.DATABASE_USER || 'postgres',
        password: process.env.DATABASE_PASSWORD,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // ✅ FIXED: Increased from 2s to 10s for VPS connection
        ssl: false, // ✅ ADDED: Explicitly disable SSL (VPS doesn't require it)
      }
    : {
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // ✅ FIXED: Increased from 2s to 10s for VPS connection
        ssl: false, // ✅ ADDED: Explicitly disable SSL
      }
);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Initialize Drizzle ORM with schema
export const db = drizzle(pool, { schema });

// Export the pool for direct access if needed
export { pool };

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('✓ PostgreSQL connection pool closed');
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    console.log('✓ Database connection successful:', result.rows[0].current_time);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}
