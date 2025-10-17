import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sharedSchema from '../../../packages/shared/src/db/schema';

// Lazy initialization: Pool and Drizzle DB are created only when first accessed
// This allows environment variables to be loaded before database connection
let poolInstance: Pool | null = null;
let dbInstance: NodePgDatabase<typeof sharedSchema> | null = null;

/**
 * Get or create the PostgreSQL connection pool
 * Uses lazy initialization to ensure environment variables are loaded first
 */
function getPool(): Pool {
  if (!poolInstance) {
    // Check for environment variables
    const hasEnvVars = !!(process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD);
    if (!hasEnvVars && !process.env.DATABASE_URL) {
      throw new Error(
        'Database configuration missing! Set DATABASE_URL or individual DATABASE_* environment variables.'
      );
    }

    // Create PostgreSQL connection pool
    // Use individual parameters if DATABASE_URL has special characters, otherwise use connectionString
    poolInstance = new Pool(
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
    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  return poolInstance;
}

/**
 * Get or create the Drizzle ORM database instance
 * Uses lazy initialization to ensure environment variables are loaded first
 */
function getDb(): NodePgDatabase<typeof sharedSchema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema: sharedSchema });
  }
  return dbInstance;
}

// Export the getter functions
export { getDb, getPool };

// For backward compatibility: export db and pool as getters
// IMPORTANT: Import as `import { db } from '@/lib/db'` will still work
// but the pool/db won't be initialized until first use
export const db = new Proxy({} as NodePgDatabase<typeof sharedSchema>, {
  get(_target, prop) {
    return getDb()[prop as keyof NodePgDatabase<typeof sharedSchema>];
  },
});

export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return getPool()[prop as keyof Pool];
  },
});

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  const currentPool = getPool();
  await currentPool.end();
  // Reset the pool after closing
  poolInstance = null;
  dbInstance = null;
  console.log('✓ PostgreSQL connection pool closed');
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const currentPool = getPool();
    const client = await currentPool.connect();
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
