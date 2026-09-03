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
 * Resolve the shared pool's max size from env, with a safe default.
 * Pure function (no Pool side effects) so T-242's pool-cap arithmetic
 * (web instances x pool + shared + calendar < 97 usable conns) is
 * unit-testable without opening a real connection. See T-241
 * 17-required-keys.md (POOL-SIZE P1) + 19-handoffs-m3.md H4.
 */
export function resolveSharedPoolSize(env: NodeJS.ProcessEnv = process.env): { max: number } {
  const max = parseInt(env.SHARED_DB_POOL_MAX || '15', 10);
  return { max: Number.isFinite(max) && max > 0 ? max : 15 };
}

/**
 * Resolve the pg `ssl` option from DATABASE_SSL (T-242 M3 handoff H6).
 * Default 'off' preserves current Windows-prod behavior — nothing changes
 * until the env var is set. The DSN's own `sslmode` (T-241 M1) still wins
 * over this when a connectionString is used.
 */
export function resolveDatabaseSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean } {
  const mode = (env.DATABASE_SSL || 'off').toLowerCase();
  if (mode === 'require') {
    return { rejectUnauthorized: false }; // self-signed origin cert (T-241 16-tls.md)
  }
  return false;
}

/**
 * Resolve the pg pool's connectionTimeoutMillis from PG_CONNECTION_TIMEOUT_MS
 * (T-433, revised W-20). Default is env-dependent: `NODE_ENV === 'production'`
 * keeps 2000 (prod behavior byte-for-byte unchanged); any other/unset
 * NODE_ENV (dev, test, local walks over the ipodhan_test SSH tunnel) defaults
 * to 20000, since a 52-row insert over the tunnel was killing the pool at
 * 2000ms unless PG_CONNECTION_TIMEOUT_MS was set by hand. An explicit
 * PG_CONNECTION_TIMEOUT_MS always wins over either default.
 */
export function resolvePgConnectionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const defaultMs = env.NODE_ENV === 'production' ? 2000 : 20000;
  const ms = parseInt(env.PG_CONNECTION_TIMEOUT_MS || String(defaultMs), 10);
  return Number.isFinite(ms) && ms > 0 ? ms : defaultMs;
}

/**
 * Resolve the pg pool's keepAlive flag from PG_KEEPALIVE (T-433). Default
 * false (pg's own default) preserves current prod behavior unchanged.
 */
export function resolvePgKeepAlive(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PG_KEEPALIVE || '').toLowerCase() === 'true';
}

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
  const { max } = resolveSharedPoolSize();
  const ssl = resolveDatabaseSsl();
  const connectionTimeoutMillis = resolvePgConnectionTimeoutMs();
  const keepAlive = resolvePgKeepAlive();
  _pool = new Pool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          options: '-c timezone=UTC',
          max,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis,
          keepAlive,
          ssl,
        }
      : {
          connectionString: process.env.DATABASE_URL,
          options: '-c timezone=UTC',
          max,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis,
          keepAlive,
          ssl,
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
