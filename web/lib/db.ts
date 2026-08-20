import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getPool as getSharedWebPool } from './db/index';

// Re-export db and all schema from drizzle setup for repositories
export { db } from './db/index';

// Re-export all schema tables, enums, and relations
export * from './db/index';

/**
 * Get PostgreSQL connection pool.
 *
 * T-242 M3 (Linux deploy pipeline) fix: this used to construct its OWN
 * second `new Pool(...)` (max:20) independent of `./db/index`'s pool, so a
 * process that only called `query()`/`getClient()` here (e.g.
 * `web/app/api/health/route.ts`) could open a whole extra pool's worth of
 * connections on top of the primary one — undercounting the real
 * connection budget in the pool-cap arithmetic. Delegating to the SAME
 * pool as `./db/index` removes that duplicate entirely (root cause, not a
 * lower cap) and keeps `DB_POOL_MAX`/`DATABASE_SSL` as the single source
 * of truth for pool sizing (see `web/lib/db/index.ts`).
 */
export function getPool() {
  return getSharedWebPool();
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
