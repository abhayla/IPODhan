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

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sharedSchema from '../../../packages/shared/src/db/schema';
import {
  configureUtcTimestampParsing,
  assertSessionTimezoneUtc,
} from '../../../packages/shared/src/db/timezone-config';

// Read every `timestamp without time zone` value as UTC regardless of process tz (#28).
configureUtcTimestampParsing();

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
            options: '-c timezone=UTC', // Force session UTC (#28)
            // ==================== CONNECTION POOL OPTIMIZATION ====================
            // Phase 5 Performance: Optimized for production workload
            // Pool size increased from 20 → 50 → 100 to support test concurrency:
            // - Previous: ~800 concurrent users max (pool saturation at 20)
            // - Phase 5: ~2500 concurrent users (50 connections)
            // - Testing: ~5000 concurrent users (100 connections for Playwright tests)
            // Each connection can handle ~50 concurrent users with efficient query execution
            // 100 connections × 50 users/connection = 5000 concurrent users
            max: 100, // Maximum pool size - increased for test concurrency (was 50)
            min: 5, // Keep minimum connections ready (warm pool)
            idleTimeoutMillis: 30000, // Close idle connections after 30s
            connectionTimeoutMillis: 5000, // 5s timeout for new connections (reduced from 10s)
            // ==================== QUERY PERFORMANCE ====================
            // Prevent slow queries from blocking the application
            statement_timeout: 10000, // 10s max per query (prevents hanging)
            query_timeout: 10000, // Alternative query timeout (fallback)
            // ==================== CONNECTION HEALTH ====================
            ssl: false, // Disabled for VPS (internal network)
            allowExitOnIdle: false, // Keep pool alive
          }
        : {
            connectionString: process.env.DATABASE_URL,
            options: '-c timezone=UTC', // Force session UTC (#28)
            max: 100,
            min: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
            query_timeout: 10000,
            ssl: false,
            allowExitOnIdle: false,
          }
    );

    // Handle pool errors
    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });

    // ==================== POOL MONITORING ====================
    // Monitor pool health for performance optimization
    poolInstance.on('connect', () => {
      console.log('[DB Pool] New client connected');
    });

    poolInstance.on('acquire', () => {
      // Uncomment for detailed monitoring:
      // console.log('[DB Pool] Client acquired from pool');
    });

    poolInstance.on('remove', () => {
      console.log('[DB Pool] Client removed from pool');
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
    await assertSessionTimezoneUtc(currentPool);
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

/**
 * Get connection pool statistics for monitoring
 * Use this to monitor pool utilization and detect saturation
 *
 * Monitoring alerts:
 * - Alert if waiting > 5 (indicates pool saturation)
 * - Alert if total approaches max (consider horizontal scaling)
 */
export function getPoolStats() {
  const currentPool = getPool();
  return {
    total: currentPool.totalCount,     // Total connections (active + idle)
    idle: currentPool.idleCount,       // Idle connections available
    waiting: currentPool.waitingCount, // Requests waiting for connection
    max: 100                           // Maximum pool size
  };
}

// ==================== SCHEMA RE-EXPORTS ====================
// Re-export all tables, enums, and relations from shared schema
// This allows: import { ipos, ipoStatusEnum } from '@/lib/db'

// Re-export everything from shared schema
export * from '../../../packages/shared/src/db/schema';

// Explicit export for extractionLogs (TypeScript workaround for wildcard re-export issue)
export { extractionLogs } from '../../../packages/shared/src/db/schema';

// Also export the namespace for type compatibility
export { sharedSchema as schema };
