import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool as sharedPool } from './db/index';

// Re-export db from drizzle setup for repositories
export { db } from './db/index';

/**
 * Get PostgreSQL connection pool.
 *
 * T-242 M3 (Linux deploy pipeline) fix: this used to construct its OWN
 * second `new Pool(...)` from DISCRETE `DATABASE_HOST`/`DATABASE_USER`/
 * `DATABASE_PASSWORD` vars only — no `DATABASE_URL` fallback at all. On
 * the Linux deploy the env files are DSN-only (T-241 17-required-keys.md,
 * H5: "Do NOT set DATABASE_HOST / DATABASE_PASSWORD"), so this pool would
 * have connected with `password: undefined` and failed every query (the
 * exact GitHub #10 class of bug `web/lib/db.ts` was already patched for).
 * It was ALSO a duplicate connection budget on top of `./db/index`'s pool
 * (T-241 17-required-keys.md POOL-SIZE P1 listed it as "same pool
 * family"). Delegating to the SAME pool as `./db/index` fixes both: no
 * more DSN-blind duplicate pool, and `SHARED_DB_POOL_MAX`/`DATABASE_SSL`
 * (see `db/index.ts`) become the single source of truth for pool sizing.
 */
export function getPool() {
  return sharedPool;
}

/**
 * Execute a query using the connection pool
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();

  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  await getPool().end();
  console.log('✓ PostgreSQL connection pool closed');
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() as current_time');
    console.log('✓ Database connection successful:', result.rows[0].current_time);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}
