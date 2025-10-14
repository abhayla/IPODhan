import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sharedSchema from '../../../packages/shared/src/db/schema';

// Debug: Log environment variable status at module load time
const hasEnvVars = !!(process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD);
if (!hasEnvVars && !process.env.DATABASE_URL) {
  console.warn('⚠️  WARNING: No database configuration found in environment variables!');
  console.warn('Make sure DATABASE_URL or individual DATABASE_* vars are set');
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
        connectionTimeoutMillis: 2000,
      }
    : {
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Initialize Drizzle ORM with schema from shared package
export const db = drizzle(pool, { schema: sharedSchema });

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

// ==================== SCHEMA RE-EXPORTS ====================
// Re-export all tables, enums, and relations from shared schema
// This allows: import { ipos, ipoStatusEnum } from '@/lib/db'

// Re-export everything from shared schema
export * from '../../../packages/shared/src/db/schema';

// Also export the namespace for type compatibility
export { sharedSchema as schema };
