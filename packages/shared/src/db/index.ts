import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { configureUtcTimestampParsing, assertSessionTimezoneUtc } from './timezone-config';

// Read every `timestamp without time zone` value as UTC regardless of process tz (#28).
configureUtcTimestampParsing();

// Lazy initialization to ensure environment variables are loaded first
let _pool: Pool | undefined;
let _db: NodePgDatabase<typeof schema> | undefined;

/**
 * Initialize the database pool lazily
 */
function initPool(): Pool {
  if (_pool) {
    return _pool;
  }

  // Create PostgreSQL connection pool
  // Use individual parameters if DATABASE_HOST is set, otherwise use DATABASE_URL
  // `-c timezone=UTC` forces the session to UTC so now()/defaultNow() write
  // UTC-naive and naive<->timestamptz comparisons treat naive values as UTC (#28).
  _pool = new Pool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          options: '-c timezone=UTC',
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        }
      : {
          connectionString: process.env.DATABASE_URL,
          options: '-c timezone=UTC',
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        }
  );

  // Handle pool errors
  _pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  return _pool;
}

// Create Proxy for pool to enable lazy initialization
export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    const realPool = initPool();
    const value = (realPool as any)[prop];
    return typeof value === 'function' ? value.bind(realPool) : value;
  }
});

// Create Proxy for db to enable lazy initialization
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_, prop) {
    if (!_db) {
      _db = drizzle(initPool(), { schema });
    }
    const value = (_db as any)[prop];
    return typeof value === 'function' ? value.bind(_db) : value;
  }
});

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    console.log('✓ PostgreSQL connection pool closed');
  }
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const realPool = initPool();
    await assertSessionTimezoneUtc(realPool);
    const client = await realPool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    console.log('✓ Database connection successful:', result.rows[0].current_time);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}

// Re-export all schema tables, enums, and relations for convenient imports
export * from './schema';

// Timezone normalization helpers (#28)
export {
  parseNaiveTimestampAsUtc,
  configureUtcTimestampParsing,
  assertSessionTimezoneUtc,
} from './timezone-config';
