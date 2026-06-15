import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// Re-export db and all schema from drizzle setup for repositories
export { db } from './db/index';

// Re-export all schema tables, enums, and relations
export * from './db/index';

// Singleton pool instance
let pool: Pool | null = null;

/**
 * Get PostgreSQL connection pool
 * Creates a new pool if one doesn't exist (singleton pattern)
 */
export function getPool(): Pool {
  if (!pool) {
    // Prefer individual DATABASE_* vars; fall back to DATABASE_URL.
    // Production sets only DATABASE_URL — without this fallback the pool was
    // built with password=undefined, so every query threw
    // "SASL: client password must be a string" (GitHub #10: /api/health
    // falsely reported the database unhealthy).
    const hasDiscreteVars = !!(process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD);
    if (!hasDiscreteVars && !process.env.DATABASE_URL) {
      throw new Error(
        'Database configuration missing! Set DATABASE_URL or individual DATABASE_* environment variables.'
      );
    }

    pool = new Pool(
      hasDiscreteVars
        ? {
            host: process.env.DATABASE_HOST,
            port: parseInt(process.env.DATABASE_PORT || '5432'),
            database: process.env.DATABASE_NAME,
            user: process.env.DATABASE_USER,
            password: process.env.DATABASE_PASSWORD,
            options: '-c timezone=UTC', // Force session UTC (#28)
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
          }
        : {
            connectionString: process.env.DATABASE_URL,
            options: '-c timezone=UTC', // Force session UTC (#28)
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
          }
    );

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });

    console.log('✓ PostgreSQL connection pool created');
  }

  return pool;
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
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✓ PostgreSQL connection pool closed');
  }
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
