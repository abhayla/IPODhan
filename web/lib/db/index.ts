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
 * Resolve the web pool's max/min size from env, with a safe default.
 * Extracted as a pure function (no Pool side effects) so T-242's pool-cap
 * arithmetic (web instances x pool + shared + calendar < 97 usable conns)
 * is unit-testable without opening a real connection.
 */
export function resolveWebPoolSize(env: NodeJS.ProcessEnv = process.env): { max: number; min: number } {
  const max = parseInt(env.DB_POOL_MAX || '15', 10);
  const min = parseInt(env.DB_POOL_MIN || '2', 10);
  return {
    max: Number.isFinite(max) && max > 0 ? max : 15,
    min: Number.isFinite(min) && min >= 0 ? min : 2,
  };
}

/**
 * Resolve the pg `ssl` option from DATABASE_SSL (T-242 M3 handoff H6).
 * Default 'off' preserves current Windows-prod behavior (ssl:false) — nothing
 * changes until the env var is set. The DSN's own `sslmode` (T-241 M1) still
 * wins over this when a connectionString is used; this only matters for the
 * discrete DATABASE_HOST branch and for hygiene/explicitness.
 */
export function resolveDatabaseSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean } {
  const mode = (env.DATABASE_SSL || 'off').toLowerCase();
  if (mode === 'require') {
    return { rejectUnauthorized: false }; // self-signed origin cert (T-241 16-tls.md)
  }
  return false;
}

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
    const { max: poolMax, min: poolMin } = resolveWebPoolSize();
    const ssl = resolveDatabaseSsl();
    poolInstance = new Pool(
      process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
        ? {
            host: process.env.DATABASE_HOST,
            port: parseInt(process.env.DATABASE_PORT || '5432'),
            database: process.env.DATABASE_NAME || 'ipodhan',
            user: process.env.DATABASE_USER || 'postgres',
            password: process.env.DATABASE_PASSWORD,
            options: '-c timezone=UTC', // Force session UTC (#28)
            // ==================== CONNECTION POOL SIZE (T-242 M3) ====================
            // Env-driven so the Linux deploy's worst-case connection count (web
            // instances x pool + shared + calendar) can be capped under the
            // server's usable max_connections. See T-241 17-required-keys.md
            // (POOL-SIZE P1) + 19-handoffs-m3.md H4. Defaults: DB_POOL_MAX=15,
            // DB_POOL_MIN=2 (was a hardcoded max:100/min:5 — 5x oversized for
            // this workload; see PR description for the arithmetic).
            max: poolMax,
            min: poolMin,
            idleTimeoutMillis: 30000, // Close idle connections after 30s
            connectionTimeoutMillis: 5000, // 5s timeout for new connections (reduced from 10s)
            // ==================== QUERY PERFORMANCE ====================
            // Prevent slow queries from blocking the application
            statement_timeout: 10000, // 10s max per query (prevents hanging)
            query_timeout: 10000, // Alternative query timeout (fallback)
            // ==================== CONNECTION HEALTH ====================
            ssl, // DATABASE_SSL=require|off (default off — see resolveDatabaseSsl)
            allowExitOnIdle: false, // Keep pool alive
          }
        : {
            connectionString: process.env.DATABASE_URL,
            options: '-c timezone=UTC', // Force session UTC (#28)
            max: poolMax,
            min: poolMin,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
            query_timeout: 10000,
            ssl,
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
    max: resolveWebPoolSize().max,     // Maximum pool size (env-driven, see resolveWebPoolSize)
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
